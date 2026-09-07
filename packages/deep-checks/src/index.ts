import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Finding, Severity } from "@ship-check/schemas";

const TOOL_TIMEOUT_MS = 120_000;
const MIRROR_MAX_BYTES = 5 * 1024 * 1024;

export const PINNED_GITLEAKS_VERSION = "8.30.1";
export const PINNED_OSV_VERSION = "2.5.1";

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function finding(input: {
  checkId: string;
  pack: Finding["pack"];
  suffix: string;
  title: string;
  summary: string;
  severity: Severity;
  confidence?: Finding["confidence"];
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: input.pack,
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    confidence: input.confidence ?? "high",
    evidence: input.evidence,
    remediation: {
      why: input.why,
      fix: input.fix,
      verify: input.verify,
      agentPrompt: input.agentPrompt
    }
  };
}

function gap(input: {
  checkId: string;
  pack: AssessmentGap["pack"];
  area: AssessmentGap["area"];
  suffix: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: input.pack,
    area: input.area,
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runProcess(command: string, args: string[], cwd?: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TOOL_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${path.basename(command)} exceeded the ${TOOL_TIMEOUT_MS / 1000}s Ship Check timeout.`));
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function toolFilename(name: "gitleaks" | "osv-scanner"): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function locateTool(name: "gitleaks" | "osv-scanner", envName: string): Promise<string | null> {
  const configured = process.env[envName]?.trim();
  if (configured) {
    if (await isFile(configured)) return configured;
    return null;
  }

  const filename = toolFilename(name);
  const executableDir = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDir, filename),
    path.join(executableDir, "resources", filename),
    path.resolve("apps/desktop/src-tauri/resources", filename)
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }

  try {
    const probe = await runProcess(filename, ["--version"]);
    if (probe.code === 0) return filename;
  } catch {
    // PATH lookup is optional. A missing mature scanner becomes an explicit gap.
  }
  return null;
}

async function toolVersion(tool: string): Promise<string> {
  const result = await runProcess(tool, ["--version"]);
  if (result.code !== 0) return "unknown";
  return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || "unknown";
}

function normaliseRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

async function copyInventory(
  context: ProjectContext,
  destination: string,
  include: (relativePath: string) => boolean = () => true
): Promise<number> {
  let copied = 0;
  for (const relativePath of context.files) {
    if (!include(relativePath)) continue;
    const source = path.resolve(context.root, relativePath);
    const target = path.resolve(destination, relativePath);
    if (!source.startsWith(`${context.root}${path.sep}`) || !target.startsWith(`${destination}${path.sep}`)) continue;
    try {
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MIRROR_MAX_BYTES) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      copied += 1;
    } catch {
      // Individual unreadable files are already outside the deterministic text-reading boundary.
    }
  }
  return copied;
}

const fallbackSecretPatterns = [
  { label: "OpenAI-style API key", regex: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
  { label: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{24,}\b/g },
  { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "Private key material", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: "Supabase service-role assignment", regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?[A-Za-z0-9._-]{24,}/g }
];

async function fallbackSecretScan(context: ProjectContext, checkId: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const candidateFiles = context.files.filter((file) => /\.(?:cjs|env|go|js|json|jsx|mjs|py|rb|rs|toml|ts|tsx|ya?ml)$/i.test(file));
  for (const file of candidateFiles) {
    const text = await context.readText(file);
    if (!text) continue;
    for (const pattern of fallbackSecretPatterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(text);
      if (!match) continue;
      findings.push(finding({
        checkId,
        pack: "secure-build",
        suffix: `${file}:${lineNumber(text, match.index)}:${pattern.label}`,
        title: "Possible live credential in source",
        summary: `${pattern.label} detected in ${file}. Ship Check deliberately does not echo the matched value.`,
        severity: "critical",
        evidence: [{
          kind: "file-match",
          path: file,
          line: lineNumber(text, match.index),
          excerpt: `${pattern.label} pattern detected; value redacted`,
          detail: "Ship Check's built-in fallback secret detector matched a known credential shape."
        }],
        why: "A committed credential can grant direct access to data, infrastructure or paid APIs.",
        fix: "Revoke or rotate the credential first, then remove it from source and history where appropriate and load the replacement from a secret store.",
        verify: "Confirm the old credential is revoked, then rerun Ship Check with Gitleaks available.",
        agentPrompt: `A ${pattern.label} pattern is present in ${file}. Do not reveal or repeat it. Remove the credential from source, replace usage with environment/secret-store loading, and give me a rotation and verification checklist.`
      }));
    }
  }
  return findings;
}

export type GitleaksRecord = {
  Description?: unknown;
  StartLine?: unknown;
  File?: unknown;
  RuleID?: unknown;
  Fingerprint?: unknown;
};

function gitleaksPath(file: string, mirrorRoot: string): string {
  const normalFile = file.replaceAll("\\", "/");
  const normalRoot = mirrorRoot.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalFile.startsWith(`${normalRoot}/`)) return normalFile.slice(normalRoot.length + 1);
  return normaliseRelative(file);
}

export function parseGitleaksReport(raw: unknown, mirrorRoot: string, version: string): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as GitleaksRecord;
    const file = typeof item.File === "string" ? gitleaksPath(item.File, mirrorRoot) : "unknown-file";
    const line = typeof item.StartLine === "number" && item.StartLine > 0 ? Math.floor(item.StartLine) : undefined;
    const ruleId = typeof item.RuleID === "string" && item.RuleID ? item.RuleID : "unknown-rule";
    const description = typeof item.Description === "string" && item.Description ? item.Description : "Secret-like value";
    const fingerprint = typeof item.Fingerprint === "string" && item.Fingerprint
      ? item.Fingerprint.replace(/[^A-Za-z0-9:_-]/g, "").slice(-80)
      : `${file}:${line ?? index}:${ruleId}`;

    return [finding({
      checkId: "secure.secret-pattern",
      pack: "secure-build",
      suffix: `gitleaks:${fingerprint}`,
      title: "Potential credential detected by Gitleaks",
      summary: `${description} matched Gitleaks rule ${ruleId} in ${file}. The matched secret is never copied into the Ship Check report.`,
      severity: "high",
      evidence: [{
        kind: "file-match",
        path: file,
        line,
        excerpt: `Gitleaks ${ruleId}; secret value redacted`,
        detail: `Gitleaks ${version} matched a mature secret-detection rule against the tracked Ship Check source mirror.`
      }],
      why: "Credential-shaped values in repository source may provide direct access to production data, infrastructure or paid services.",
      fix: "Treat the value as potentially live: verify and rotate it first, remove it from source/history where appropriate, and use the deployment secret store instead.",
      verify: "Confirm any exposed credential is revoked, then rerun Ship Check and confirm the Gitleaks rule no longer fires.",
      agentPrompt: `Gitleaks rule ${ruleId} matched ${file}${line ? `:${line}` : ""}. Do not reveal the value. Determine whether it is live, rotate/revoke if needed, remove the credential safely, use a secret store, and rerun the scanner.`
    })];
  });
}

export const gitleaksSecretCheck: CheckDefinition = {
  id: "secure.secret-pattern",
  pack: "secure-build",
  title: "Mature credential scanning",
  description: "Use bundled/pinned Gitleaks against a privacy-preserving mirror of the scanned repository inventory, falling back to narrow built-in patterns when unavailable.",
  principles: ["practice.preserve-safety"],
  async run(context): Promise<CheckExecution> {
    const tool = await locateTool("gitleaks", "SHIP_CHECK_GITLEAKS_PATH");
    if (!tool) {
      return {
        findings: await fallbackSecretScan(context, this.id),
        gaps: [gap({
          checkId: this.id,
          pack: this.pack,
          area: "secrets",
          suffix: "gitleaks-unavailable",
          title: "Deep secret scanning is unavailable",
          summary: "Ship Check could not find its bundled Gitleaks binary or a compatible Gitleaks installation. Narrow fallback credential patterns still ran.",
          evidence: [{ kind: "configuration", detail: "Gitleaks executable was not found in the bundled resources, configured override or PATH." }],
          verify: "Use a desktop build that bundles Gitleaks or set SHIP_CHECK_GITLEAKS_PATH to a trusted compatible binary, then rerun the scan."
        })],
        coverage: [{ area: "secrets", status: "partial" }]
      };
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-gitleaks-"));
    const mirror = path.join(root, "source");
    const reportPath = path.join(root, "gitleaks.json");
    try {
      await fs.mkdir(mirror, { recursive: true });
      const copied = await copyInventory(context, mirror);
      if (copied === 0) {
        return {
          gaps: [gap({
            checkId: this.id,
            pack: this.pack,
            area: "secrets",
            suffix: "empty-mirror",
            title: "Deep secret scan had no eligible files",
            summary: "Ship Check could not create a text/file mirror suitable for Gitleaks from the selected repository inventory.",
            evidence: [{ kind: "repository", detail: "No regular tracked files under the 5 MB per-file alpha limit were copied into the temporary scanner mirror." }],
            verify: "Inspect the repository inventory and rerun after confirming source files are readable."
          })],
          coverage: [{ area: "secrets", status: "partial" }]
        };
      }
      const version = await toolVersion(tool);
      const result = await runProcess(tool, [
        "dir",
        "--no-banner",
        "--no-color",
        "--redact=100",
        "--exit-code=0",
        "--report-format=json",
        `--report-path=${reportPath}`,
        "--max-target-megabytes=5",
        mirror
      ]);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Gitleaks exited with ${result.code}.`);
      const raw = JSON.parse(await fs.readFile(reportPath, "utf8"));
      return {
        findings: parseGitleaksReport(raw, mirror, version),
        coverage: [{ area: "secrets", status: "assessed" }]
      };
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
};

const manifestNames = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "requirements.txt",
  "poetry.lock",
  "pyproject.toml",
  "Pipfile",
  "Pipfile.lock",
  "composer.json",
  "composer.lock",
  "Gemfile",
  "Gemfile.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gradle.lockfile"
]);

function isDependencyManifest(relativePath: string): boolean {
  return manifestNames.has(path.basename(relativePath));
}

export type OsvVulnerability = {
  id?: unknown;
  aliases?: unknown;
  database_specific?: unknown;
  severity?: unknown;
};

export type OsvPackageEntry = {
  package?: unknown;
  vulnerabilities?: unknown;
};

function severityFromText(value: unknown): Severity | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper.includes("CRITICAL")) return "critical";
  if (upper.includes("HIGH")) return "high";
  if (upper.includes("MODERATE") || upper.includes("MEDIUM")) return "medium";
  if (upper.includes("LOW")) return "low";
  return null;
}

function vulnerabilitySeverity(vulnerability: OsvVulnerability): Severity {
  if (vulnerability.database_specific && typeof vulnerability.database_specific === "object") {
    const explicit = severityFromText((vulnerability.database_specific as { severity?: unknown }).severity);
    if (explicit) return explicit;
  }
  if (Array.isArray(vulnerability.severity)) {
    for (const entry of vulnerability.severity) {
      if (entry && typeof entry === "object") {
        const explicit = severityFromText((entry as { score?: unknown }).score);
        if (explicit) return explicit;
      }
    }
  }
  return "medium";
}

const severityRank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function highestSeverity(vulnerabilities: OsvVulnerability[]): Severity {
  return vulnerabilities.reduce<Severity>((current, vulnerability) => {
    const candidate = vulnerabilitySeverity(vulnerability);
    return severityRank[candidate] > severityRank[current] ? candidate : current;
  }, "low");
}

function osvSourcePath(raw: unknown, mirrorRoot: string): string {
  if (typeof raw !== "string") return "dependency manifest";
  const normal = raw.replaceAll("\\", "/");
  const root = mirrorRoot.replaceAll("\\", "/").replace(/\/$/, "");
  return normal.startsWith(`${root}/`) ? normal.slice(root.length + 1) : normaliseRelative(raw);
}

export function parseOsvReport(raw: unknown, mirrorRoot: string, version: string): Finding[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { results?: unknown }).results)) return [];
  const findings: Finding[] = [];
  for (const result of (raw as { results: unknown[] }).results) {
    if (!result || typeof result !== "object") continue;
    const resultRecord = result as { source?: unknown; packages?: unknown };
    const source = resultRecord.source && typeof resultRecord.source === "object"
      ? osvSourcePath((resultRecord.source as { path?: unknown }).path, mirrorRoot)
      : "dependency manifest";
    if (!Array.isArray(resultRecord.packages)) continue;
    for (const packageEntry of resultRecord.packages) {
      if (!packageEntry || typeof packageEntry !== "object") continue;
      const record = packageEntry as OsvPackageEntry;
      const packageInfo = record.package && typeof record.package === "object"
        ? record.package as { name?: unknown; version?: unknown; ecosystem?: unknown }
        : {};
      const name = typeof packageInfo.name === "string" ? packageInfo.name : "unknown package";
      const packageVersion = typeof packageInfo.version === "string" ? packageInfo.version : "unknown version";
      const ecosystem = typeof packageInfo.ecosystem === "string" ? packageInfo.ecosystem : "unknown ecosystem";
      const vulnerabilities = Array.isArray(record.vulnerabilities)
        ? record.vulnerabilities.filter((item): item is OsvVulnerability => Boolean(item && typeof item === "object"))
        : [];
      if (vulnerabilities.length === 0) continue;
      const ids = [...new Set(vulnerabilities.flatMap((item) => {
        const id = typeof item.id === "string" ? [item.id] : [];
        const aliases = Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === "string") : [];
        return [...id, ...aliases];
      }))].slice(0, 6);
      const severity = highestSeverity(vulnerabilities);
      findings.push(finding({
        checkId: "production.osv-vulnerabilities",
        pack: "production-ready",
        suffix: `${source}:${ecosystem}:${name}:${packageVersion}`,
        title: `Known vulnerable dependency: ${name}`,
        summary: `${name} ${packageVersion} (${ecosystem}) is associated with ${vulnerabilities.length} OSV vulnerability record${vulnerabilities.length === 1 ? "" : "s"}${ids.length ? `: ${ids.join(", ")}` : ""}.`,
        severity,
        evidence: [{
          kind: "configuration",
          path: source,
          excerpt: `${name}@${packageVersion}${ids.length ? ` · ${ids.join(", ")}` : ""}`.slice(0, 300),
          detail: `OSV-Scanner ${version} matched this dependency version against known vulnerability data.`
        }],
        why: "Known vulnerable dependencies can expose the application through code paths that appear otherwise correct and are difficult to identify by repository heuristics alone.",
        fix: "Review the linked OSV advisory IDs, upgrade to the narrowest fixed compatible version where one exists, and avoid broad unrelated dependency churn.",
        verify: "Run the relevant application tests, then rerun the opt-in OSV dependency scan and confirm the affected package/version no longer appears.",
        agentPrompt: `Review the known vulnerability records ${ids.join(", ") || "reported by OSV"} for ${name} ${packageVersion} from ${source}. Upgrade only as far as needed to a fixed compatible version, preserve behaviour, run relevant tests, and rerun Ship Check's dependency scan.`
      }));
    }
  }
  return findings;
}

export const osvDependencyCheck: CheckDefinition = {
  id: "production.osv-vulnerabilities",
  pack: "production-ready",
  title: "Known dependency vulnerabilities",
  description: "Opt-in networked OSV-Scanner check over a temporary mirror containing dependency manifests only.",
  principles: ["practice.preserve-safety", "practice.dependency-restraint"],
  async run(context): Promise<CheckExecution> {
    const manifests = context.files.filter(isDependencyManifest);
    if (manifests.length === 0) {
      return {
        gaps: [gap({
          checkId: this.id,
          pack: this.pack,
          area: "supply-chain",
          suffix: "no-supported-manifests",
          title: "No supported dependency manifests found",
          summary: "The opt-in OSV scan ran as requested, but Ship Check could not identify a supported dependency manifest in the scanned repository inventory.",
          evidence: [{ kind: "repository", detail: "No recognised npm/pnpm/Yarn/Bun, Rust, Go, Python, Composer, Ruby or common JVM dependency manifest was found." }],
          verify: "Confirm the project dependency format and add an OSV-supported manifest/lockfile or extend Ship Check's manifest mirror list."
        })],
        coverage: [{ area: "supply-chain", status: "partial" }]
      };
    }

    const tool = await locateTool("osv-scanner", "SHIP_CHECK_OSV_PATH");
    if (!tool) {
      return {
        gaps: [gap({
          checkId: this.id,
          pack: this.pack,
          area: "supply-chain",
          suffix: "osv-unavailable",
          title: "OSV dependency scanner is unavailable",
          summary: "The networked dependency scan was explicitly requested, but Ship Check could not find its bundled OSV-Scanner binary or a configured compatible installation.",
          evidence: [{ kind: "configuration", detail: "OSV-Scanner executable was not found in bundled resources, configured override or PATH." }],
          verify: "Use a desktop build that bundles OSV-Scanner or set SHIP_CHECK_OSV_PATH to a trusted compatible binary, then rerun with networked dependency scanning enabled."
        })],
        coverage: [{ area: "supply-chain", status: "partial" }]
      };
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-osv-"));
    const mirror = path.join(root, "manifests");
    try {
      await fs.mkdir(mirror, { recursive: true });
      await copyInventory(context, mirror, isDependencyManifest);
      const version = await toolVersion(tool);
      const result = await runProcess(tool, ["scan", "source", "-r", mirror, "--format", "json"]);
      if (![0, 1].includes(result.code)) throw new Error(result.stderr.trim() || `OSV-Scanner exited with ${result.code}.`);
      const raw = JSON.parse(result.stdout || "{}");
      return {
        findings: parseOsvReport(raw, mirror, version),
        coverage: [{ area: "supply-chain", status: "assessed" }]
      };
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
};

export type DeepCheckOptions = {
  networkedDependencyScan?: boolean;
};

export function deepChecksForPacks(
  packs: Array<"secure-build" | "production-ready" | "cost-aware">,
  options: DeepCheckOptions = {}
): CheckDefinition[] {
  const checks: CheckDefinition[] = [];
  if (packs.includes("secure-build")) checks.push(gitleaksSecretCheck);
  if (packs.includes("production-ready") && options.networkedDependencyScan) checks.push(osvDependencyCheck);
  return checks;
}
