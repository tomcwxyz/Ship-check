import {
  ScanReportSchema,
  type AssessmentArea,
  type AssessmentGap,
  type CheckPack,
  type CheckResult,
  type CheckVersion,
  type CoverageEntry,
  type Finding,
  type Observation,
  type PracticePrincipleId,
  type ProjectEvidenceCapability,
  type ScanReport
} from "@ship-check/schemas";
import {
  DatabaseMetadataSnapshotSchema,
  type DatabaseMetadataSnapshot
} from "@ship-check/schemas/databaseEvidence";
import { createProjectSnapshot } from "./projectEvidence.js";

const DEFAULT_CHECK_VERSION: CheckVersion = "1";

const ASSESSMENT_AREAS: AssessmentArea[] = [
  "secrets",
  "access-control",
  "configuration",
  "supply-chain",
  "cost",
  "code-security",
  "database",
  "runtime"
];

const areaLabels: Record<AssessmentArea, string> = {
  secrets: "Secrets and credential exposure",
  "access-control": "Access control and exposed server boundaries",
  configuration: "Application and platform configuration",
  "supply-chain": "Dependency and supply-chain risk",
  cost: "Cost and background-work boundaries",
  "code-security": "Static code security",
  database: "Database permissions and data boundaries",
  runtime: "Deployed runtime behaviour"
};

export type SourceCheckDescriptor = {
  id: string;
  version?: CheckVersion;
  pack: CheckPack;
  principles?: PracticePrincipleId[];
  requiresEvidence?: ProjectEvidenceCapability[];
};

export type DatabaseContext = {
  source: DatabaseMetadataSnapshot["source"];
  metadata: DatabaseMetadataSnapshot;
};

export type DatabaseCoverageContribution = {
  area: AssessmentArea;
  status: "assessed" | "partial";
};

export type DatabaseCheckExecution = {
  findings?: Finding[];
  gaps?: AssessmentGap[];
  observations?: Observation[];
  coverage?: DatabaseCoverageContribution[];
};

export type DatabaseCheckDefinition = {
  id: string;
  version?: CheckVersion;
  pack: CheckPack;
  title: string;
  description: string;
  principles?: PracticePrincipleId[];
  requiresEvidence?: ProjectEvidenceCapability[];
  coverage?: DatabaseCoverageContribution[];
  appliesTo?(context: DatabaseContext): boolean | Promise<boolean>;
  run(context: DatabaseContext): Promise<Finding[] | DatabaseCheckExecution>;
};

function normaliseExecution(
  execution: Finding[] | DatabaseCheckExecution
): Required<DatabaseCheckExecution> {
  if (Array.isArray(execution)) {
    return { findings: execution, gaps: [], observations: [], coverage: [] };
  }
  return {
    findings: execution.findings ?? [],
    gaps: execution.gaps ?? [],
    observations: execution.observations ?? [],
    coverage: execution.coverage ?? []
  };
}

function summarise(findings: Finding[]): ScanReport["summary"] {
  const summary = { total: findings.length, suppressed: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}

function summariseCoverage(
  contributions: Array<DatabaseCoverageContribution & { checkId: string }>
): CoverageEntry[] {
  return ASSESSMENT_AREAS.map((area) => {
    const matches = contributions.filter((entry) => entry.area === area);
    const checkIds = [...new Set(matches.map((entry) => entry.checkId))].sort();
    if (matches.length === 0) {
      return {
        area,
        status: "not-assessed" as const,
        checkIds,
        detail: `${areaLabels[area]} was not assessed by the available database metadata evidence.`
      };
    }
    const status = matches.some((entry) => entry.status === "assessed") ? "assessed" as const : "partial" as const;
    return {
      area,
      status,
      checkIds,
      detail: status === "assessed"
        ? `${areaLabels[area]} has deterministic database metadata evidence from ${checkIds.length} check${checkIds.length === 1 ? "" : "s"}.`
        : `${areaLabels[area]} was partially assessed from bounded database metadata; this is not full verification.`
    };
  });
}

export async function scanDatabaseMetadata(
  snapshotValue: DatabaseMetadataSnapshot,
  sourceChecks: SourceCheckDescriptor[],
  databaseChecks: DatabaseCheckDefinition[],
  version = "0.0.0-alpha.7"
): Promise<ScanReport> {
  const metadata = DatabaseMetadataSnapshotSchema.parse(snapshotValue);
  const source = metadata.source;
  const snapshot = createProjectSnapshot({
    source,
    inventorySource: "filesystem",
    fileCount: 0
  });
  const context: DatabaseContext = { source, metadata };
  const findings: Finding[] = [];
  const gaps: AssessmentGap[] = [];
  const observations: Observation[] = [];
  const results: CheckResult[] = [];
  const coverageContributions: Array<DatabaseCoverageContribution & { checkId: string }> = [];

  for (const check of sourceChecks) {
    const requiredEvidence = check.requiresEvidence ?? ["source-files"];
    const missingEvidence = requiredEvidence.filter(
      (capability) => !source.capabilities.includes(capability)
    );
    results.push({
      checkId: check.id,
      checkVersion: check.version ?? DEFAULT_CHECK_VERSION,
      pack: check.pack,
      principles: check.principles ?? [],
      status: "not-assessed",
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : ["source-files"],
      findingCount: 0,
      suppressedCount: 0,
      gapCount: 0,
      observationCount: 0,
      durationMs: 0
    });
  }

  for (const check of databaseChecks) {
    const started = performance.now();
    const checkVersion = check.version ?? DEFAULT_CHECK_VERSION;
    const requiredEvidence = check.requiresEvidence ?? ["database-metadata"];
    const missingEvidence = requiredEvidence.filter(
      (capability) => !source.capabilities.includes(capability)
    );
    if (missingEvidence.length > 0) {
      results.push({
        checkId: check.id,
        checkVersion,
        pack: check.pack,
        principles: check.principles ?? [],
        status: "not-assessed",
        missingEvidence,
        findingCount: 0,
        suppressedCount: 0,
        gapCount: 0,
        observationCount: 0,
        durationMs: Math.max(0, Math.round(performance.now() - started))
      });
      continue;
    }

    try {
      if (check.appliesTo && !(await check.appliesTo(context))) {
        results.push({
          checkId: check.id,
          checkVersion,
          pack: check.pack,
          principles: check.principles ?? [],
          status: "not-applicable",
          missingEvidence: [],
          findingCount: 0,
          suppressedCount: 0,
          gapCount: 0,
          observationCount: 0,
          durationMs: Math.max(0, Math.round(performance.now() - started))
        });
        continue;
      }

      const execution = normaliseExecution(await check.run(context));
      findings.push(...execution.findings);
      gaps.push(...execution.gaps);
      observations.push(...execution.observations);
      for (const contribution of [...(check.coverage ?? []), ...execution.coverage]) {
        coverageContributions.push({ ...contribution, checkId: check.id });
      }
      results.push({
        checkId: check.id,
        checkVersion,
        pack: check.pack,
        principles: check.principles ?? [],
        status: execution.findings.length > 0
          ? "findings"
          : execution.gaps.length > 0
            ? "unverified"
            : "passed",
        missingEvidence: [],
        findingCount: execution.findings.length,
        suppressedCount: 0,
        gapCount: execution.gaps.length,
        observationCount: execution.observations.length,
        durationMs: Math.max(0, Math.round(performance.now() - started))
      });
    } catch (error) {
      results.push({
        checkId: check.id,
        checkVersion,
        pack: check.pack,
        principles: check.principles ?? [],
        status: "error",
        missingEvidence: [],
        findingCount: 0,
        suppressedCount: 0,
        gapCount: 0,
        observationCount: 0,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return ScanReportSchema.parse({
    schemaVersion: "0.1",
    tool: { name: "ship-check", version },
    project: {
      path: source.label,
      gitRepository: false,
      inventorySource: "filesystem",
      fileCount: 0,
      snapshot
    },
    packs: [...new Set([...sourceChecks, ...databaseChecks].map((check) => check.pack))],
    checks: results,
    findings: findings.sort((a, b) => `${a.severity}:${a.id}`.localeCompare(`${b.severity}:${b.id}`)),
    suppressedFindings: [],
    gaps: gaps.sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`)),
    observations: observations.sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`)),
    coverage: summariseCoverage(coverageContributions),
    summary: summarise(findings),
    generatedAt: new Date().toISOString()
  });
}
