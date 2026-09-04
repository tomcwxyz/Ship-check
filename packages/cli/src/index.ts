#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checksForPacks } from "@ship-check/checks";
import { scanProject } from "@ship-check/core";
import type { CheckPack, Severity } from "@ship-check/schemas";

const version = "0.0.0-alpha.1";
const severityRank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function usage(): string {
  return `Ship Check ${version}\n\nUsage:\n  ship-check scan [project] [--pack secure-build] [--pack production-ready] [--format pretty|json] [--fail-on critical|high|medium|low|never]\n\nExamples:\n  ship-check scan .\n  ship-check scan . --pack secure-build --format json\n  ship-check scan . --fail-on high\n`;
}

function printPretty(report: Awaited<ReturnType<typeof scanProject>>): void {
  console.log(`Ship Check · ${report.project.path}`);
  console.log(`${report.checks.length} checks · ${report.summary.total} findings · ${report.summary.critical} critical · ${report.summary.high} high · ${report.summary.medium} medium`);
  if (report.findings.length === 0) {
    console.log("\nNo findings from the selected checks. This is not a security or compliance certification.");
    return;
  }
  for (const finding of report.findings) {
    console.log(`\n[${finding.severity.toUpperCase()}] ${finding.title}`);
    console.log(finding.summary);
    const evidence = finding.evidence[0];
    if (evidence.path) console.log(`Evidence: ${evidence.path}${evidence.line ? `:${evidence.line}` : ""} — ${evidence.detail}`);
    else console.log(`Evidence: ${evidence.detail}`);
    console.log(`Fix: ${finding.remediation.fix}`);
    console.log(`Verify: ${finding.remediation.verify}`);
    console.log(`Agent prompt: ${finding.remediation.agentPrompt}`);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: "string", default: "pretty" },
      pack: { type: "string", multiple: true },
      "fail-on": { type: "string", default: "never" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" }
    }
  });

  if (values.version) {
    console.log(version);
    return;
  }
  if (values.help || positionals[0] !== "scan") {
    console.log(usage());
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const requestedPacks = values.pack?.length ? values.pack : ["secure-build", "production-ready"];
  const allowedPacks = new Set(["secure-build", "production-ready"]);
  if (requestedPacks.some((pack) => !allowedPacks.has(pack))) throw new Error(`Unknown check pack: ${requestedPacks.find((pack) => !allowedPacks.has(pack))}`);
  if (!new Set(["pretty", "json"]).has(values.format)) throw new Error(`Unknown format: ${values.format}`);

  const report = await scanProject(positionals[1] ?? ".", checksForPacks(requestedPacks as CheckPack[]), version);
  if (values.format === "json") console.log(JSON.stringify(report, null, 2));
  else printPretty(report);

  const failOn = values["fail-on"];
  if (failOn !== "never") {
    if (!new Set(["critical", "high", "medium", "low", "info"]).has(failOn)) throw new Error(`Unknown --fail-on severity: ${failOn}`);
    const threshold = severityRank[failOn as Severity];
    if (report.findings.some((finding) => severityRank[finding.severity] >= threshold)) process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`Ship Check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
