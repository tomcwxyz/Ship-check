#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  evaluateAssuranceGate,
  toOrganisationalAssuranceSummary,
  toRackStepResult
} from "@ship-check/adapters";
import { checksForPacks } from "@ship-check/checks";
import { scanProject, type CheckDefinition } from "@ship-check/core";
import { costAwareChecks } from "@ship-check/cost-checks";
import {
  AssuranceGateIdSchema,
  CheckPackSchema,
  type AssuranceGateId,
  type CheckPack,
  type ScanReport,
  type Severity
} from "@ship-check/schemas";
import { prepareRepositorySource } from "./repositorySource.js";

const version = "0.0.0-alpha.1";
const severityRank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

function usage(): string {
  return `Ship Check ${version}\n\nUsage:\n  ship-check scan [project-or-github-repo] [--ref branch-or-tag] [--pack secure-build] [--pack production-ready] [--pack cost-aware] [--format pretty|json|rack|oos] [--fail-on critical|high|medium|low|never]\n\nRepository sources:\n  Local folder: . or C:\\path\\to\\project\n  GitHub: owner/repository or https://github.com/owner/repository\n  --ref <branch-or-tag> clones that Git ref for a GitHub source\n\nRACK/OOS options:\n  --gate ship-check|ship-check-secure-build|ship-check-production-ready|ship-check-cost-aware\n  --step-id <rack verification step id>   Required with --format rack\n\nExamples:\n  ship-check scan .\n  ship-check scan tomcwxyz/Ship-check\n  ship-check scan https://github.com/tomcwxyz/Ship-check --ref main --pack secure-build\n  ship-check scan . --pack cost-aware\n  ship-check scan . --format rack --gate ship-check-secure-build --step-id release-security --fail-on high\n  ship-check scan . --format oos --gate ship-check\n`;
}

function printPretty(report: ScanReport): void {
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

function checksForRequestedPacks(packs: CheckPack[]): CheckDefinition[] {
  const standard = packs.filter(
    (pack): pack is "secure-build" | "production-ready" => pack !== "cost-aware"
  );
  return [
    ...checksForPacks(standard),
    ...(packs.includes("cost-aware") ? costAwareChecks : [])
  ];
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: "string", default: "pretty" },
      pack: { type: "string", multiple: true },
      "fail-on": { type: "string", default: "never" },
      gate: { type: "string", default: "ship-check" },
      "step-id": { type: "string" },
      ref: { type: "string" },
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

  const requestedPacksRaw = values.pack?.length
    ? values.pack
    : ["secure-build", "production-ready", "cost-aware"];
  const requestedPacks = requestedPacksRaw.map((pack) => CheckPackSchema.parse(pack));
  if (!new Set(["pretty", "json", "rack", "oos"]).has(values.format)) {
    throw new Error(`Unknown format: ${values.format}`);
  }

  const gateId = AssuranceGateIdSchema.parse(values.gate) as AssuranceGateId;
  const failOn = values["fail-on"];
  if (failOn !== "never" && !new Set(["critical", "high", "medium", "low", "info"]).has(failOn)) {
    throw new Error(`Unknown --fail-on severity: ${failOn}`);
  }
  const gateThreshold = (failOn === "never" ? "high" : failOn) as Severity;

  const source = await prepareRepositorySource(positionals[1] ?? ".", { ref: values.ref });
  try {
    const scanned = await scanProject(
      source.projectPath,
      checksForRequestedPacks(requestedPacks),
      version
    );
    const report: ScanReport = source.kind === "github"
      ? { ...scanned, project: { ...scanned.project, path: source.displayName } }
      : scanned;

    if (values.format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else if (values.format === "rack") {
      if (!values["step-id"]) throw new Error("--format rack requires --step-id.");
      const gate = evaluateAssuranceGate(report, { gateId, threshold: gateThreshold });
      console.log(JSON.stringify(toRackStepResult(values["step-id"], gate), null, 2));
      if (gate.outcome === "fail") process.exitCode = 2;
      else if (gate.outcome === "incomplete") process.exitCode = 3;
    } else if (values.format === "oos") {
      const gate = evaluateAssuranceGate(report, { gateId, threshold: gateThreshold });
      console.log(JSON.stringify(toOrganisationalAssuranceSummary(report, gate), null, 2));
    } else {
      printPretty(report);
    }

    if (values.format !== "rack" && failOn !== "never") {
      const threshold = severityRank[failOn as Severity];
      if (report.findings.some((finding) => severityRank[finding.severity] >= threshold)) {
        process.exitCode = 2;
      }
    }
  } finally {
    await source.cleanup();
  }
}

main().catch((error) => {
  console.error(`Ship Check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});