#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { parseArgs } from "node:util";
import {
  buildProjectHistoryTimeline,
  evaluateAssuranceGate,
  toOrganisationalAssuranceSummary,
  toProjectHistoryMetadata,
  toRackStepResult
} from "@ship-check/adapters";
import { checksForPacks } from "@ship-check/checks";
import { breadthChecks } from "@ship-check/checks/breadth";
import { serverSurfaceInventoryCheck } from "@ship-check/checks/inventory";
import { calibratedPaidEndpointCheck } from "@ship-check/checks/paid";
import { importAwareSurfaceChecks, replacedSurfaceCheckIds } from "@ship-check/checks/surface";
import { scanProject, type CheckDefinition } from "@ship-check/core";
import { discoverAIProject } from "@ship-check/core/ai-discovery";
import { combineScanReports } from "@ship-check/core/multiSource";
import { parseRuntimeTargetUrl, scanRuntimeTarget } from "@ship-check/core/runtime";
import { costAwareChecks } from "@ship-check/cost-checks";
import { databaseSourceChecks } from "@ship-check/database-checks";
import { deepChecksForPacks } from "@ship-check/deep-checks";
import { semgrepLocalCheck } from "@ship-check/deep-checks/semgrep";
import { runtimeHttpChecks } from "@ship-check/runtime-checks";
import {
  AssuranceGateIdSchema,
  CheckPackSchema,
  CloudHistoryRetentionSchema,
  ProjectHistoryMetadataSchema,
  type AssessmentArea,
  type AssuranceGateId,
  type CheckPack,
  type ProjectEvidenceSource,
  type ProjectHistoryMetadata,
  type ScanReport,
  type Severity
} from "@ship-check/schemas";
import { resolveDatabaseInspection, scanConfiguredDatabase } from "./databaseInspection.js";
import {
  createCloudHistoryClient,
  resolveCloudClientConfig
} from "./cloud.js";
import {
  parseGithubRepository,
  prepareRepositorySource,
  sourceExecutionContextFromEnvironment
} from "./repositorySource.js";

const version = "0.0.0-alpha.8";
const severityRank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const areaNames: Record<AssessmentArea, string> = {
  secrets: "Secrets",
  "access-control": "Access control",
  configuration: "Configuration",
  "supply-chain": "Supply chain",
  cost: "Cost",
  "code-security": "Code security",
  database: "Database",
  runtime: "Runtime"
};

function usage(): string {
  return `Ship Check ${version}\n\nUsage:\n  ship-check scan [project-source] [--deployment-url url] [--inspect-database] [--database-url-env ENV_NAME] [--database-platform postgres|supabase|neon] [--database-table-limit 1000] [--ref branch-or-tag] [--pack secure-build] [--pack production-ready] [--pack cost-aware] [--local-semgrep-scan] [--networked-dependency-scan] [--format pretty|json|metadata|rack|oos] [--fail-on critical|high|medium|low|never]\n\nCloud history (metadata only):\n  ship-check cloud connect <metadata.json> [--cloud-url https://...] [--display-name name] [--retention 30-days|90-days|180-days|365-days|until-deleted]\n  ship-check cloud sync <project-id> <metadata.json> [--cloud-url https://...]\n  ship-check cloud projects [--cloud-url https://...]\n  ship-check cloud timeline <project-id> [--cloud-url https://...]\n    Uses SHIP_CHECK_CLOUD_TOKEN for bearer authentication and sends only the source-free assurance metadata envelope. SHIP_CHECK_CLOUD_URL may provide the endpoint instead of --cloud-url.\n\nAI discovery:\n  ship-check discover-ai [project-source] [--ref branch-or-tag]\n    Emits a metadata-only crux-discovery/0.1 report. Discovery identifies technical AI/workflow signals only; it does not declare organisational purpose or authority.\n\nProject sources:\n  Local folder: . or C:\\path\\to\\project\n  GitHub: owner/repository or https://github.com/owner/repository\n  Exported project: C:\\path\\to\\project.zip\n  Deployment URL only: https://example.com\n  Source + deployment: add --deployment-url https://example.com\n  --ref <branch-or-tag> clones that Git ref for a GitHub source\n\nRuntime URL checks:\n  Deployment URLs use a bounded, non-mutating GET probe with manual redirect following. Ship Check records transport, selected browser security headers, cookie flags and a synthetic CORS Origin response. It does not retain response bodies or cookie values. A URL-only run leaves source/database checks not assessed; --deployment-url combines runtime evidence with the supplied source in one project report.\n\nDatabase metadata checks:\n  --inspect-database explicitly opts into a local read-only Postgres metadata inspection and requires Production Ready. The connection URL is read from SHIP_CHECK_DATABASE_URL by default; use --database-url-env NAME to select another environment variable. Do not put a database URL on the command line. Ship Check opens a read-only transaction, runs only its fixed system-catalog metadata queries, reads no application rows, rolls the transaction back and does not retain the connection URL or database role name. --database-platform labels provider-specific evidence; --database-table-limit bounds the table inventory from 1 to 5000 (default 1000).\n\nDeep checks:\n  Secure Build uses Gitleaks when available, against a temporary mirror of the scanned repository inventory.\n  Server-boundary checks trace a bounded local import graph so auth, webhook verification, paid work, object-level authorisation questions and outbound-request questions can include shared helpers.\n  Production Ready records positive server-surface observations separately from findings and checks selected GitHub Actions supply-chain boundaries.\n  --local-semgrep-scan opts into Ship Check's small pinned local Semgrep ruleset and requires Secure Build. It stays offline, disables Semgrep metrics/version checks and never uses Registry/auto rules. Semgrep itself is not bundled in the alpha desktop; use a compatible local CLI or SHIP_CHECK_SEMGREP_PATH.\n  --networked-dependency-scan opts into OSV-Scanner and requires Production Ready. Only dependency manifests/lockfiles are mirrored; package identifiers and versions may be sent to the OSV service.\n\nAccepted exceptions:\n  A tracked .ship-check.json may suppress an exact finding ID only when it also names the matching rule version and a substantive rationale. Suppressed findings remain visible in the report and rule-version changes invalidate old suppressions. Runtime-only URL scans do not load repository suppression configuration.\n\nRACK/OOS options:\n  --gate ship-check|ship-check-secure-build|ship-check-production-ready|ship-check-cost-aware\n  --step-id <rack verification step id>   Required with --format rack\n\nExamples:\n  ship-check scan .\n  ship-check discover-ai .\n  ship-check discover-ai tomcwxyz/open-recs-local --ref master\n  ship-check scan tomcwxyz/Ship-check\n  ship-check scan ./lovable-export.zip\n  ship-check scan https://example.com\n  ship-check scan ./lovable-export.zip --deployment-url https://example.com\n  ship-check scan tomcwxyz/Ship-check --deployment-url https://ship-check.example\n  SHIP_CHECK_DATABASE_URL=postgresql://... ship-check scan . --inspect-database --database-platform supabase\n  ship-check scan . --inspect-database --database-url-env MY_READONLY_DATABASE_URL --database-platform neon\n  ship-check scan . --pack secure-build --local-semgrep-scan\n  ship-check scan . --networked-dependency-scan\n  ship-check scan https://github.com/tomcwxyz/Ship-check --ref main --pack secure-build\n  ship-check scan . --pack cost-aware\n  ship-check scan . --format rack --gate ship-check-secure-build --step-id release-security --fail-on high\n  ship-check scan . --format oos --gate ship-check\n  SHIP_CHECK_CLOUD_URL=https://cloud.example SHIP_CHECK_CLOUD_TOKEN=shipcheck_... ship-check cloud connect ./ship-check-metadata.json --display-name "My project"\n`;
}

function checkVersionFor(report: ScanReport, checkId: string): string {
  return report.checks.find((check) => check.checkId === checkId)?.checkVersion ?? "1";
}

function evidenceSourcesFor(report: ScanReport): ProjectEvidenceSource[] {
  const combined = (report.project as ScanReport["project"] & { evidenceSources?: ProjectEvidenceSource[] }).evidenceSources;
  if (combined?.length) return combined;
  return report.project.snapshot?.source ? [report.project.snapshot.source] : [];
}

function printPretty(report: ScanReport): void {
  const gaps = report.gaps ?? [];
  const observations = report.observations ?? [];
  const suppressions = report.suppressedFindings ?? [];
  const notAssessed = report.checks.filter((check) => check.status === "not-assessed");
  const sources = evidenceSourcesFor(report);
  console.log(`Ship Check · ${report.project.path}`);
  if (sources.length === 1) {
    const source = sources[0]!;
    console.log(`Source: ${source.type} · ${source.provider} · ${source.acquisition} · ${source.executionLocation}`);
  } else if (sources.length > 1) {
    console.log("Evidence sources:");
    for (const source of sources) {
      console.log(`- ${source.type} · ${source.provider} · ${source.acquisition} · ${source.label}`);
    }
  }
  console.log(`${report.checks.length} checks · ${report.summary.total} findings · ${suppressions.length} suppressed · ${gaps.length} unverified · ${notAssessed.length} not assessed · ${observations.length} observed · ${report.summary.critical} critical · ${report.summary.high} high · ${report.summary.medium} medium`);

  if (report.findings.length === 0) {
    console.log("\nNo active findings in assessed areas. This does not mean the project has been fully assessed or has no accepted exceptions.");
  } else {
    for (const finding of report.findings) {
      console.log(`\n[${finding.severity.toUpperCase()}] ${finding.title}`);
      console.log(finding.summary);
      console.log(`Finding ID: ${finding.id}`);
      console.log(`Rule: ${finding.checkId}@${checkVersionFor(report, finding.checkId)}`);
      const evidence = finding.evidence[0];
      if (evidence.path) console.log(`Evidence: ${evidence.path}${evidence.line ? `:${evidence.line}` : ""} — ${evidence.detail}`);
      else console.log(`Evidence: ${evidence.detail}`);
      console.log(`Fix: ${finding.remediation.fix}`);
      console.log(`Verify: ${finding.remediation.verify}`);
      console.log(`Agent prompt: ${finding.remediation.agentPrompt}`);
    }
  }

  if (suppressions.length > 0) {
    console.log("\nAccepted exceptions");
    for (const suppression of suppressions) {
      const finding = suppression.finding;
      console.log(`- [${finding.severity.toUpperCase()}] ${finding.title}`);
      console.log(`  Finding ID: ${finding.id}`);
      console.log(`  Rule: ${finding.checkId}@${suppression.checkVersion}`);
      console.log(`  Rationale: ${suppression.rationale}`);
      console.log(`  Declared in ${suppression.configPath}; a rule-version change invalidates this suppression.`);
    }
  }

  if (observations.length > 0) {
    console.log("\nObserved evidence");
    for (const observation of observations) {
      console.log(`- ${observation.title} [${areaNames[observation.area]}]`);
      console.log(`  ${observation.summary}`);
      const first = observation.evidence[0];
      if (first?.path) console.log(`  Example: ${first.path} — ${first.detail}`);
      else if (first) console.log(`  Evidence: ${first.detail}`);
    }
  }

  if (gaps.length > 0) {
    console.log("\nUnverified controls");
    for (const assessmentGap of gaps) {
      const evidence = assessmentGap.evidence[0];
      console.log(`- ${assessmentGap.title} [${areaNames[assessmentGap.area]}]`);
      console.log(`  ${assessmentGap.summary}`);
      if (evidence.path) console.log(`  Evidence: ${evidence.path}${evidence.line ? `:${evidence.line}` : ""} — ${evidence.detail}`);
      else console.log(`  Evidence: ${evidence.detail}`);
      console.log(`  Verify: ${assessmentGap.verify}`);
    }
  }

  if (notAssessed.length > 0) {
    console.log("\nChecks not assessed with available evidence");
    for (const check of notAssessed) {
      console.log(`- ${check.checkId}: missing ${check.missingEvidence.join(", ") || "required evidence"}`);
    }
  }

  if (report.coverage?.length) {
    console.log("\nAssessment coverage");
    for (const coverage of report.coverage) {
      console.log(`- ${areaNames[coverage.area]}: ${coverage.status}`);
    }
  }

  console.log("\nShip Check reports bounded project evidence, not security or compliance certification.");
}

function checksForRequestedPacks(
  packs: CheckPack[],
  options: { networkedDependencyScan: boolean; localSemgrepScan: boolean }
): CheckDefinition[] {
  const standard = packs.filter(
    (pack): pack is "secure-build" | "production-ready" => pack !== "cost-aware"
  );
  const nativeChecks = checksForPacks(standard).filter(
    (check) => check.id !== "secure.secret-pattern" && !replacedSurfaceCheckIds.has(check.id)
  );
  const selectedBreadthChecks = breadthChecks.filter((check) => packs.includes(check.pack));
  const remainingSurfaceChecks = importAwareSurfaceChecks.filter(
    (check) => check.id !== "secure.paid-endpoint-abuse-control"
  );
  return [
    ...nativeChecks,
    ...(packs.includes("secure-build") ? [calibratedPaidEndpointCheck, ...remainingSurfaceChecks] : []),
    ...selectedBreadthChecks,
    ...(packs.includes("production-ready") ? [serverSurfaceInventoryCheck] : []),
    ...(packs.includes("cost-aware") ? costAwareChecks : []),
    ...databaseSourceChecks.filter((check) => packs.includes(check.pack)),
    ...deepChecksForPacks(packs, { networkedDependencyScan: options.networkedDependencyScan }),
    ...(packs.includes("secure-build") && options.localSemgrepScan ? [semgrepLocalCheck] : [])
  ];
}

function isRuntimeUrlSource(value: string): boolean {
  if (parseGithubRepository(value)) return false;
  return parseRuntimeTargetUrl(value) !== null;
}

function renderReport(
  report: ScanReport,
  values: Record<string, string | boolean | string[] | undefined>,
  gateId: AssuranceGateId,
  gateThreshold: Severity,
  failOn: string
): void {
  if (values.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else if (values.format === "metadata") {
    console.log(JSON.stringify(toProjectHistoryMetadata(report), null, 2));
  } else if (values.format === "rack") {
    if (!values["step-id"]) throw new Error("--format rack requires --step-id.");
    const gate = evaluateAssuranceGate(report, { gateId, threshold: gateThreshold });
    console.log(JSON.stringify(toRackStepResult(String(values["step-id"]), gate), null, 2));
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
}

async function readProjectHistoryMetadataFile(file: string): Promise<ProjectHistoryMetadata> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read project history metadata from ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return ProjectHistoryMetadataSchema.parse(parsed);
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
      "deployment-url": { type: "string" },
      "inspect-database": { type: "boolean", default: false },
      "database-url-env": { type: "string" },
      "database-platform": { type: "string" },
      "database-table-limit": { type: "string" },
      "local-semgrep-scan": { type: "boolean", default: false },
      "networked-dependency-scan": { type: "boolean", default: false },
      "cloud-url": { type: "string" },
      "display-name": { type: "string" },
      retention: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" }
    }
  });

  if (values.version) {
    console.log(version);
    return;
  }
  const command = positionals[0];
  if (
    values.help ||
    (command !== "scan" &&
      command !== "discover-ai" &&
      command !== "timeline" &&
      command !== "cloud")
  ) {
    console.log(usage());
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  if (command === "cloud") {
    const action = positionals[1];
    if (!action || !new Set(["connect", "sync", "projects", "timeline"]).has(action)) {
      throw new Error(
        "ship-check cloud requires connect, sync, projects or timeline."
      );
    }

    const config = resolveCloudClientConfig({
      cloudUrl: values["cloud-url"]
    });
    const client = createCloudHistoryClient(config);

    if (action === "connect") {
      const metadataFile = positionals[2];
      if (!metadataFile) {
        throw new Error("ship-check cloud connect requires a metadata JSON file.");
      }
      const event = await readProjectHistoryMetadataFile(metadataFile);
      const retention = CloudHistoryRetentionSchema.parse(
        values.retention ?? "90-days"
      );
      const result = await client.connectProject({
        event,
        retention,
        ...(values["display-name"]
          ? { displayName: String(values["display-name"]) }
          : {})
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (action === "sync") {
      const projectId = positionals[2];
      const metadataFile = positionals[3];
      if (!projectId || !metadataFile) {
        throw new Error(
          "ship-check cloud sync requires a project id and metadata JSON file."
        );
      }
      const event = await readProjectHistoryMetadataFile(metadataFile);
      console.log(
        JSON.stringify(await client.syncProject(projectId, event), null, 2)
      );
      return;
    }

    if (action === "projects") {
      console.log(JSON.stringify(await client.listProjects(), null, 2));
      return;
    }

    const projectId = positionals[2];
    if (!projectId) {
      throw new Error("ship-check cloud timeline requires a project id.");
    }
    console.log(JSON.stringify(await client.getTimeline(projectId), null, 2));
    return;
  }

  if (command === "timeline") {
    const metadataFiles = positionals.slice(1);
    if (metadataFiles.length === 0) {
      throw new Error("ship-check timeline requires at least one metadata JSON file.");
    }

    const events: ProjectHistoryMetadata[] = [];
    for (const file of metadataFiles) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await fs.readFile(file, "utf8"));
      } catch (error) {
        throw new Error(
          `Could not read project history metadata from ${file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        events.push(ProjectHistoryMetadataSchema.parse(candidate));
      }
    }

    console.log(JSON.stringify(buildProjectHistoryTimeline(events), null, 2));
    return;
  }

  if (command === "discover-ai") {
    const sourceValue = positionals[1] ?? ".";
    if (isRuntimeUrlSource(sourceValue)) {
      throw new Error("AI discovery currently requires source code, a GitHub repository or an exported project rather than a live URL.");
    }
    const source = await prepareRepositorySource(sourceValue, {
      ref: values.ref,
      executionContext: sourceExecutionContextFromEnvironment()
    });
    try {
      const report = await discoverAIProject(source.projectPath, source.sourceInput);
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await source.cleanup();
    }
    return;
  }

  const requestedPacksRaw = values.pack?.length
    ? values.pack
    : ["secure-build", "production-ready", "cost-aware"];
  const requestedPacks = requestedPacksRaw.map((pack) => CheckPackSchema.parse(pack));
  if (!new Set(["pretty", "json", "metadata", "rack", "oos"]).has(values.format)) {
    throw new Error(`Unknown format: ${values.format}`);
  }

  const gateId = AssuranceGateIdSchema.parse(values.gate) as AssuranceGateId;
  const failOn = values["fail-on"];
  if (failOn !== "never" && !new Set(["critical", "high", "medium", "low", "info"]).has(failOn)) {
    throw new Error(`Unknown --fail-on severity: ${failOn}`);
  }
  const gateThreshold = (failOn === "never" ? "high" : failOn) as Severity;
  const localSemgrepScan = Boolean(values["local-semgrep-scan"]);
  const networkedDependencyScan = Boolean(values["networked-dependency-scan"]);
  if (localSemgrepScan && !requestedPacks.includes("secure-build")) {
    throw new Error("--local-semgrep-scan requires the secure-build pack because the pinned static-analysis rules belong to Secure Build.");
  }
  if (networkedDependencyScan && !requestedPacks.includes("production-ready")) {
    throw new Error("--networked-dependency-scan requires the production-ready pack because OSV findings belong to Production Ready.");
  }

  const databaseInspection = resolveDatabaseInspection({
    inspectDatabase: Boolean(values["inspect-database"]),
    databaseUrlEnv: values["database-url-env"],
    databasePlatform: values["database-platform"],
    databaseTableLimit: values["database-table-limit"]
  });
  if (databaseInspection && !requestedPacks.includes("production-ready")) {
    throw new Error("--inspect-database requires the production-ready pack because the current live database metadata checks belong to Production Ready.");
  }

  const sourceValue = positionals[1] ?? ".";
  const deploymentUrl = values["deployment-url"];
  const sourceChecks = checksForRequestedPacks(requestedPacks, { networkedDependencyScan, localSemgrepScan });
  const selectedRuntimeChecks = runtimeHttpChecks.filter((check) => requestedPacks.includes(check.pack));

  if (isRuntimeUrlSource(sourceValue)) {
    if (deploymentUrl) throw new Error("Use either a deployment URL as the project source or --deployment-url with source code, not both.");
    if (values.ref) throw new Error("--ref applies to GitHub repository sources, not deployment URLs.");
    if (localSemgrepScan) throw new Error("--local-semgrep-scan requires source files and cannot run against a deployment URL alone.");
    if (networkedDependencyScan) throw new Error("--networked-dependency-scan requires dependency manifests and cannot run against a deployment URL alone.");
    const runtimeReport = await scanRuntimeTarget(
      sourceValue,
      sourceChecks,
      selectedRuntimeChecks,
      version
    );
    const report = databaseInspection
      ? combineScanReports(
          runtimeReport,
          await scanConfiguredDatabase({
            inspection: databaseInspection,
            sourceChecks,
            packs: requestedPacks,
            version
          })
        )
      : runtimeReport;
    renderReport(report, values, gateId, gateThreshold, failOn);
    return;
  }

  const source = await prepareRepositorySource(sourceValue, {
    ref: values.ref,
    executionContext: sourceExecutionContextFromEnvironment()
  });
  try {
    const sourceReport = await scanProject(
      source.projectPath,
      sourceChecks,
      version,
      source.sourceInput
    );
    const additionalReports: ScanReport[] = [];
    if (deploymentUrl) {
      additionalReports.push(await scanRuntimeTarget(
        deploymentUrl,
        sourceChecks,
        selectedRuntimeChecks,
        version
      ));
    }
    if (databaseInspection) {
      additionalReports.push(await scanConfiguredDatabase({
        inspection: databaseInspection,
        sourceChecks,
        packs: requestedPacks,
        version
      }));
    }
    const report: ScanReport = additionalReports.length > 0
      ? combineScanReports(sourceReport, ...additionalReports)
      : sourceReport;
    renderReport(report, values, gateId, gateThreshold, failOn);
  } finally {
    await source.cleanup();
  }
}

main().catch((error) => {
  console.error(`Ship Check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});