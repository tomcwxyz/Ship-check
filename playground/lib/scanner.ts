import { Sandbox } from "@vercel/sandbox";
import type { ScanReport } from "./types";
import type { ParsedSource } from "./sourceTypes";
import { scanEgressPolicy } from "./egress.mjs";

export class ScanStageError extends Error {
  constructor(readonly stage: "github-preflight" | "sandbox-startup" | "scanner-run" | "scanner-output", cause?: unknown) {
    super("A playground infrastructure check failed.", { cause });
    this.name = "ScanStageError";
  }
}

const MAX_REPO_KB = 20_000;
const MAX_REPORT_CHARS = 1_200_000;

async function checkPublicGithubSource(target: string): Promise<void> {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(target);
  if (!match) throw new Error("Invalid repository.");
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "Ship-Check-Playground" },
      signal: AbortSignal.timeout(7000), cache: "no-store" }
  );
  if (response.status === 404) throw new Error("Repository not found or not public.");
  if (!response.ok) throw new Error("GitHub repository could not be checked just now.");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error("Invalid repository response.");
  const repo = data as { size?: number; private?: boolean; archived?: boolean };
  if (repo.private) throw new Error("Private repositories are not supported in this playground.");
  if (typeof repo.size !== "number" || repo.size > MAX_REPO_KB)
    throw new Error("This repository is larger than the playground's 20 MB allowance.");
}

function checkScanReport(value: unknown): asserts value is ScanReport {
  if (!value || typeof value !== "object") throw new Error("No valid report was returned.");
  const report = value as Partial<ScanReport>;
  if (report.schemaVersion !== "0.1" || report.tool?.name !== "ship-check" ||
      !Array.isArray(report.findings) || !Array.isArray(report.gaps) ||
      !Array.isArray(report.coverage) || !Array.isArray(report.checks) ||
      typeof report.summary?.total !== "number")
    throw new Error("The scanner returned an incompatible report.");
}

export async function scanInSandbox(source: ParsedSource): Promise<ScanReport> {
  if (source.kind === "github") {
    try { await checkPublicGithubSource(source.target); }
    catch (cause) {
      if (cause instanceof Error && /Invalid repository|Repository not found|larger than|Private repositories|GitHub repository could not/.test(cause.message)) throw cause;
      throw new ScanStageError("github-preflight", cause);
    }
  }
  const version = process.env.SHIP_CHECK_PLAYGROUND_SCANNER_VERSION || "0.0.0-alpha.11";
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version))
    throw new Error("A pinned Ship-check alpha version must be configured.");
  let sandbox: Awaited<ReturnType<typeof Sandbox.create>>;
  try {
    sandbox = await Sandbox.create({
      persistent: false,
      resources: { vcpus: 1 },
      timeout: 150_000,
      networkPolicy: scanEgressPolicy(source)
    });
  } catch (cause) {
    throw new ScanStageError("sandbox-startup", cause);
  }
  try {
    const spec = `@good-ship/ship-check@${version}`;
    let run: Awaited<ReturnType<typeof sandbox.runCommand>>;
    try {
      run = await sandbox.runCommand({
        cmd: "npm",
        args: ["exec", "--yes", `--package=${spec}`, "--", "ship-check", "scan",
          source.target, "--format", "json", "--fail-on", "never"]
      });
    } catch (cause) {
      throw new ScanStageError("scanner-run", cause);
    }
    if (run.exitCode !== 0) {
      // Do not reflect potentially sensitive or untrusted runner stderr to the browser.
      throw new ScanStageError("scanner-run");
    }
    const stdout = await run.stdout().catch((cause) => { throw new ScanStageError("scanner-output", cause); });
    if (!stdout || stdout.length > MAX_REPORT_CHARS) throw new Error("The resulting report exceeded the playground limit.");
    let parsed: unknown;
    try { parsed = JSON.parse(stdout); } catch { throw new Error("The scanner did not return a complete JSON report."); }
    checkScanReport(parsed);
    // CLI alpha.9 assumes local execution; annotate only the hosted provenance
    // (not finding/evidence content) until the next canonical CLI release supports it.
    if (parsed.project.snapshot?.source) {
      parsed.project.snapshot.source.executionLocation = "ship-check-managed";
    }
    return parsed;
  } finally {
    await sandbox.stop();
  }
}
