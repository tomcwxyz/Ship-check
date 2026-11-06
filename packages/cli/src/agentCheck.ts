import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ScanReport, Severity } from "@ship-check/schemas";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MANIFESTS = 120;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const EXCLUDED_DIRS = new Set([
  ".git", "node_modules", ".next", ".turbo", "dist", "build", "coverage", ".venv", "venv", "vendor"
]);
const NAMES = new Set([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
  "requirements.txt", "poetry.lock", "uv.lock", "pyproject.toml", "Pipfile.lock",
  "composer.json", "composer.lock", "go.mod", "go.sum", "Cargo.lock", "Gemfile.lock",
  "pom.xml", "gradle.lockfile", "packages.lock.json", ".nvmrc", ".node-version",
  ".php-version", ".tool-versions", "Dockerfile"
]);
const SEVERITY: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export type DailySecuritySummary = {
  checkedAt: string;
  networked: boolean;
  total: number;
  critical: number;
  high: number;
  unverified: number;
  errors: number;
  top: Array<{ title: string; severity: Severity; knownExploited: boolean }>;
};

export type DailyCheckResult = {
  status: "checked" | "cached";
  summary: DailySecuritySummary;
};

/** Only selected dependency/runtime manifests enter the digest. Never hash .env or source code. */
export async function dependencyFingerprint(root: string): Promise<string | null> {
  const realRoot = await fs.realpath(root);
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5 || files.length > MAX_MANIFESTS) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const item of entries) {
      if (item.isDirectory() && !EXCLUDED_DIRS.has(item.name)) {
        await visit(path.join(directory, item.name), depth + 1);
      } else if (item.isFile() && (NAMES.has(item.name) || /^requirements[-_.].*\.txt$/i.test(item.name))) {
        files.push(path.join(directory, item.name));
      }
      if (files.length > MAX_MANIFESTS) return;
    }
  }
  await visit(realRoot, 0);
  if (files.length > MAX_MANIFESTS) return null; // No caching if we couldn't inventory bounded inputs.
  const digest = createHash("sha256");
  for (const file of files.sort()) {
    const stats = await fs.lstat(file);
    if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) return null;
    const realFile = await fs.realpath(file);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
    digest.update(path.relative(realRoot, file));
    digest.update("\0");
    digest.update(createHash("sha256").update(await fs.readFile(realFile)).digest("hex"));
    digest.update("\n");
  }
  return digest.digest("hex");
}

function localCacheDirectory(): string {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "ship-check", "agent");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "ShipCheck", "Cache", "agent");
  }
  return path.join(os.homedir(), ".cache", "ship-check", "agent");
}

function isSummary(value: unknown): value is DailySecuritySummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<DailySecuritySummary>;
  return typeof summary.checkedAt === "string" &&
    typeof summary.networked === "boolean" &&
    [summary.total, summary.critical, summary.high, summary.unverified, summary.errors]
      .every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) &&
    Array.isArray(summary.top) && summary.top.length <= 3 &&
    summary.top.every((item) => item && typeof item.title === "string" &&
      item.title.length <= 200 && typeof item.knownExploited === "boolean" &&
      typeof item.severity === "string" && item.severity in SEVERITY);
}

function summarise(report: ScanReport, networked: boolean, now: Date): DailySecuritySummary {
  const sorted = [...report.findings].sort((a, b) => {
    const kev = (finding: typeof a) => finding.summary.includes("CISA KEV: known exploited");
    return Number(kev(b)) - Number(kev(a)) ||
      SEVERITY[b.severity] - SEVERITY[a.severity];
  });
  return {
    checkedAt: now.toISOString(),
    networked,
    total: report.findings.length,
    critical: report.summary.critical,
    high: report.summary.high,
    unverified: report.gaps.length,
    errors: report.checks.filter((check) => check.status === "error").length,
    top: sorted.slice(0, 3).map((item) => ({
      title: item.title.slice(0, 200),
      severity: item.severity,
      knownExploited: item.summary.includes("CISA KEV: known exploited")
    }))
  };
}

/** Explicit invocation only. Network use still requires the caller's opt-in flag. */
export async function runDailyAgentCheck(
  root: string,
  networked: boolean,
  scan: () => Promise<ScanReport>,
  options: { force?: boolean; now?: Date } = {}
): Promise<DailyCheckResult> {
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const fingerprint = await dependencyFingerprint(resolvedRoot);
  const cachePath = path.join(localCacheDirectory(),
    `${createHash("sha256").update(`${resolvedRoot}\0${networked}`).digest("hex")}.json`);
  const now = options.now ?? new Date();

  if (!options.force && fingerprint !== null) {
    try {
      const stats = await fs.stat(cachePath);
      if (stats.size < 16 * 1024) {
        const cached = JSON.parse(await fs.readFile(cachePath, "utf8")) as {
          fingerprint?: unknown; summary?: unknown
        };
        const summary = cached.summary;
        const checked = isSummary(summary) ? Date.parse(summary.checkedAt) : NaN;
        if (cached.fingerprint === fingerprint && isSummary(summary) &&
            Number.isFinite(checked) && checked <= now.getTime() &&
            now.getTime() - checked < DAY_MS) {
          return { status: "cached", summary };
        }
      }
    } catch {
      // Missing or invalid cache is never interpreted as completed coverage.
    }
  }

  const summary = summarise(await scan(), networked, now);
  if (fingerprint !== null) {
    try {
      const directory = path.dirname(cachePath);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = `${cachePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ fingerprint, summary }), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, cachePath);
    } catch {
      // A read-only cache directory must not prevent the scan or falsify its results.
    }
  }
  return { status: "checked", summary };
}

export function renderDailyAgentCheck(result: DailyCheckResult): string {
  const { summary } = result;
  const lines = [
    `Ship Check agent security: ${result.status === "cached" ? "using last assessment" : "assessment completed"} (${summary.checkedAt}).`,
    `${summary.total} active finding(s): ${summary.critical} critical, ${summary.high} high; ${summary.unverified} unanswered control(s); ${summary.errors} scan error(s).`,
    ...summary.top.map((item) => `- ${item.knownExploited ? "[CISA KEV] " : ""}${item.severity.toUpperCase()}: ${item.title}`),
    summary.networked
      ? "OSV, CISA KEV and FIRST EPSS were requested. Confirm coverage and intelligence gaps in a full report."
      : "Offline only: dependency vulnerability/advisory lookups were NOT run. Opt in with --networked-dependency-scan.",
    "This is a scoped assessment, not a declaration that the project is safe. Use ship-check scan . for full evidence."
  ];
  return lines.join("\n");
}
