import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Finding, Observation, Severity } from "@ship-check/schemas";
import {
  SEMGREP_RULE_GUIDANCE,
  SEMGREP_RULESET_SHA256,
  SEMGREP_RULESET_VERSION,
  SEMGREP_RULESET_YAML,
  SEMGREP_SUPPORTED_MAJOR_MINOR,
  SEMGREP_TESTED_VERSION
} from "./semgrepRules.js";

const SEMGREP_TIMEOUT_MS = 120_000;
const MIRROR_MAX_BYTES = 5 * 1024 * 1024;
const CHECK_ID = "secure.semgrep-local-rules";

function finding(input: {
  suffix: string;
  title: string;
  summary: string;
  severity: Severity;
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: `${CHECK_ID}:${input.suffix}`,
    checkId: CHECK_ID,
    pack: "secure-build",
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    confidence: "high",
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
  suffix: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: `${CHECK_ID}:${input.suffix}`,
    checkId: CHECK_ID,
    pack: "secure-build",
    area: "code-security",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

function observation(input: {
  version: string;
  fileCount: number;
}): Observation {
  return {
    id: `${CHECK_ID}:ruleset-run`,
    checkId: CHECK_ID,
    pack: "secure-build",
    area: "code-security",
    kind: "inventory",
    title: "Pinned local Semgrep ruleset completed",
    summary: `Semgrep CE ${input.version} ran Ship Check local ruleset v${SEMGREP_RULESET_VERSION} (${SEMGREP_RULESET_SHA256.slice(0, 12)}…) against ${input.fileCount} mirrored repository file${input.fileCount === 1 ? "" : "s"}. This is a deliberately small static ruleset, not broad code-security verification.`,
    evidence: [{
      kind: "configuration",
      detail: `Local-only Semgrep scan; ruleset SHA-256 ${SEMGREP_RULESET_SHA256}; metrics and version checks disabled; no Registry configuration used.`
    }]
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
    }, SEMGREP_TIMEOUT_MS);

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
        reject(new Error(`Semgrep exceeded the ${SEMGREP_TIMEOUT_MS / 1000}s Ship Check timeout.`));
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function semgrepFilename(): string {
  return process.platform === "win32" ? "semgrep.exe" : "semgrep";
}

export async function locateSemgrep(): Promise<string | null> {
  const configured = process.env.SHIP_CHECK_SEMGREP_PATH?.trim();
  if (configured) return await isFile(configured) ? configured : null;

  const filename = semgrepFilename();
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
    // An explicitly requested scan reports an evidence gap below when unavailable.
  }
  return null;
}

async function semgrepVersion(tool: string): Promise<string> {
  const result = await runProcess(tool, ["--version"]);
  if (result.code !== 0) return "unknown";
  return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || "unknown";
}

export function semgrepVersionSupported(rawVersion: string): boolean {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(rawVersion);
  if (!match) return false;
  return `${match[1]}.${match[2]}` === SEMGREP_SUPPORTED_MAJOR_MINOR;
}

function rulesetHash(): string {
  return createHash("sha256").update(SEMGREP_RULESET_YAML, "utf8").digest("hex");
}

async function copyInventory(context: ProjectContext, destination: string): Promise<number> {
  let copied = 0;
  for (const relativePath of context.files) {
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
      // Keep the mirror bounded to readable regular files from Ship Check's inventory.
    }
  }
  return copied;
}

export type SemgrepResultRecord = {
  check_id?: unknown;
  path?: unknown;
  start?: unknown;
  extra?: unknown;
};

function semgrepPath(rawPath: unknown, mirrorRoot: string): string {
  if (typeof rawPath !== "string") return "unknown-file";
  const normal = rawPath.replaceAll("\\", "/");
  const root = mirrorRoot.replaceAll("\\", "/").replace(/\/$/, "");
  if (normal.startsWith(`${root}/`)) return normal.slice(root.length + 1);
  return normal.replace(/^\.\//, "");
}

function severityFromSemgrep(raw: unknown): Severity {
  if (typeof raw !== "string") return "medium";
  const severity = raw.toUpperCase();
  if (severity === "ERROR") return "high";
  if (severity === "WARNING") return "medium";
  if (severity === "INFO") return "low";
  return "medium";
}

export function parseSemgrepReport(raw: unknown, mirrorRoot: string, semgrepToolVersion: string): Finding[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { results?: unknown }).results)) return [];
  const findings: Finding[] = [];

  for (const entry of (raw as { results: unknown[] }).results) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as SemgrepResultRecord;
    const ruleId = typeof record.check_id === "string" ? record.check_id : "unknown-rule";
    if (!ruleId.startsWith("ship-check.")) continue;
    const file = semgrepPath(record.path, mirrorRoot);
    const start = record.start && typeof record.start === "object"
      ? record.start as { line?: unknown }
      : {};
    const line = typeof start.line === "number" && start.line > 0 ? Math.floor(start.line) : undefined;
    const extra = record.extra && typeof record.extra === "object"
      ? record.extra as { message?: unknown; severity?: unknown }
      : {};
    const guidance = SEMGREP_RULE_GUIDANCE[ruleId];
    const title = guidance?.title ?? "Pinned Semgrep rule matched";
    const message = typeof extra.message === "string" && extra.message.trim()
      ? extra.message.trim()
      : title;

    findings.push(finding({
      suffix: `semgrep:${ruleId}:${file}:${line ?? 0}`,
      title,
      summary: `${message} Semgrep rule ${ruleId} matched ${file}${line ? `:${line}` : ""}.`,
      severity: severityFromSemgrep(extra.severity),
      evidence: [{
        kind: "file-match",
        path: file,
        line,
        excerpt: `Semgrep rule ${ruleId}; matched source omitted`,
        detail: `Semgrep CE ${semgrepToolVersion} matched Ship Check local ruleset v${SEMGREP_RULESET_VERSION} (${SEMGREP_RULESET_SHA256.slice(0, 12)}…). Ship Check does not retain Semgrep's matched source text.`
      }],
      why: guidance?.why ?? "The repository matched a deliberately narrow local static-analysis rule that requires review.",
      fix: guidance?.fix ?? "Review the matched API usage and replace it with the narrowest safe alternative while preserving intended behaviour.",
      verify: guidance?.verify ?? "Exercise the affected path, then rerun the local Semgrep scan and confirm the rule no longer matches.",
      agentPrompt: `Review ${file}${line ? ` around line ${line}` : ""} for Ship Check Semgrep rule ${ruleId}. ${guidance?.fix ?? "Replace the matched risky pattern with the narrowest safe alternative."} Preserve intended behaviour, add a focused regression test, and rerun the local Semgrep check.`
    }));
  }

  return findings;
}

export const semgrepLocalCheck: CheckDefinition = {
  id: CHECK_ID,
  version: SEMGREP_RULESET_VERSION,
  pack: "secure-build",
  title: "Pinned local Semgrep rules",
  description: "Opt-in offline Semgrep CE scan using only Ship Check-owned rules compiled into the engine; no Registry/auto configuration or metrics.",
  principles: ["practice.preserve-safety"],
  async run(context): Promise<CheckExecution> {
    if (rulesetHash() !== SEMGREP_RULESET_SHA256) {
      throw new Error("Ship Check's embedded Semgrep ruleset does not match its pinned SHA-256 provenance.");
    }

    const tool = await locateSemgrep();
    if (!tool) {
      return {
        gaps: [gap({
          suffix: "semgrep-unavailable",
          title: "Local Semgrep scan is unavailable",
          summary: `The local Semgrep scan was explicitly requested, but Ship Check could not find a Semgrep CLI. Semgrep is not bundled in the alpha desktop because its current release does not provide reproducible per-platform binary assets.`,
          evidence: [{ kind: "configuration", detail: "Semgrep executable was not found via SHIP_CHECK_SEMGREP_PATH, local resources or PATH." }],
          verify: `Install Semgrep CE ${SEMGREP_SUPPORTED_MAJOR_MINOR}.x using a trusted method, or set SHIP_CHECK_SEMGREP_PATH to that executable, then rerun the local Semgrep scan.`
        })],
        coverage: [{ area: "code-security", status: "partial" }]
      };
    }

    const version = await semgrepVersion(tool);
    if (!semgrepVersionSupported(version)) {
      return {
        gaps: [gap({
          suffix: "semgrep-version-unsupported",
          title: "Installed Semgrep version is outside the tested compatibility line",
          summary: `Ship Check found Semgrep ${version}, but local ruleset v${SEMGREP_RULESET_VERSION} is currently tested against Semgrep ${SEMGREP_TESTED_VERSION} and accepts the ${SEMGREP_SUPPORTED_MAJOR_MINOR}.x line only. The scan was not run rather than silently changing analysis semantics.`,
          evidence: [{ kind: "configuration", detail: `Detected Semgrep version: ${version}; accepted line: ${SEMGREP_SUPPORTED_MAJOR_MINOR}.x.` }],
          verify: `Use Semgrep ${SEMGREP_SUPPORTED_MAJOR_MINOR}.x or update and revalidate Ship Check's compatibility contract before rerunning.`
        })],
        coverage: [{ area: "code-security", status: "partial" }]
      };
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-semgrep-"));
    const mirror = path.join(root, "source");
    const rulesPath = path.join(root, `ship-check-semgrep-v${SEMGREP_RULESET_VERSION}.yml`);
    try {
      await fs.mkdir(mirror, { recursive: true });
      const copied = await copyInventory(context, mirror);
      if (copied === 0) {
        return {
          gaps: [gap({
            suffix: "empty-mirror",
            title: "Local Semgrep scan had no eligible files",
            summary: "Ship Check could not create a regular-file mirror suitable for the local Semgrep scan from the selected repository inventory.",
            evidence: [{ kind: "repository", detail: "No regular inventory files under the 5 MB per-file alpha limit were copied into the temporary scanner mirror." }],
            verify: "Inspect the repository inventory and rerun after confirming source files are readable."
          })],
          coverage: [{ area: "code-security", status: "partial" }]
        };
      }

      await fs.writeFile(rulesPath, SEMGREP_RULESET_YAML, "utf8");
      const result = await runProcess(tool, [
        "scan",
        "--config", rulesPath,
        "--json",
        "--metrics=off",
        "--disable-version-check",
        "--no-git-ignore",
        mirror
      ]);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `Semgrep exited with ${result.code}.`);
      }
      const raw = JSON.parse(result.stdout || "{}");
      return {
        findings: parseSemgrepReport(raw, mirror, version),
        observations: [observation({ version, fileCount: copied })],
        coverage: [{ area: "code-security", status: "partial" }]
      };
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
};
