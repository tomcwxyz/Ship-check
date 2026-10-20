import { Sandbox } from "@vercel/sandbox";
import type { ScanReport } from "./types";
import type { ParsedSource } from "./sourceTypes";

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
  if (source.kind === "github") await checkPublicGithubSource(source.target);
  const version = process.env.SHIP_CHECK_PLAYGROUND_SCANNER_VERSION || "0.0.0-alpha.10";
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version))
    throw new Error("A pinned Ship-check alpha version must be configured.");
  const sandbox = await Sandbox.create({ runtime: "node24", persistent: false, timeout: 150_000 });
  try {
    const spec = `@good-ship/ship-check@${version}`;
    const run = await sandbox.runCommand({
      cmd: "npm",
      args: ["exec", "--yes", `--package=${spec}`, "--", "ship-check", "scan",
        source.target, "--format", "json", "--fail-on", "never"]
    });
    if (run.exitCode !== 0) {
      // Do not reflect potentially sensitive or untrusted runner stderr to the browser.
      throw new Error("The scan could not complete. Please try a smaller or different public target.");
    }
    const stdout = await run.stdout();
    if (!stdout || stdout.length > MAX_REPORT_CHARS) throw new Error("The resulting report exceeded the playground limit.");
    let parsed: unknown;
    try { parsed = JSON.parse(stdout); } catch { throw new Error("The scanner did not return a complete JSON report."); }
    checkScanReport(parsed);
    return parsed;
  } finally {
    await sandbox.stop();
  }
}
