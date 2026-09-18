import {
  type AssessmentArea,
  type CoverageEntry,
  type Finding,
  type ScanReport
} from "@ship-check/schemas";
import {
  MultiSourceScanReportSchema,
  type MultiSourceScanReport
} from "@ship-check/schemas/multiSource";

const areas: AssessmentArea[] = [
  "secrets",
  "access-control",
  "configuration",
  "supply-chain",
  "cost",
  "code-security",
  "database",
  "runtime"
];

const statusRank = {
  "not-assessed": 0,
  partial: 1,
  assessed: 2
} as const;

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(item);
  }
  return output;
}

function mergeCoverage(reports: ScanReport[]): CoverageEntry[] {
  return areas.map((area) => {
    const entries = reports.flatMap((report) => report.coverage.filter((entry) => entry.area === area));
    const best = entries.reduce<CoverageEntry["status"]>(
      (current, entry) => statusRank[entry.status] > statusRank[current] ? entry.status : current,
      "not-assessed"
    );
    const checkIds = [...new Set(entries.flatMap((entry) => entry.checkIds))].sort();
    const sourceCount = entries.filter((entry) => entry.status !== "not-assessed").length;
    return {
      area,
      status: best,
      checkIds,
      detail: best === "not-assessed"
        ? "This area was not assessed by any of the combined project evidence sources."
        : best === "assessed"
          ? `Combined project evidence includes deterministic assessment for this area across ${sourceCount} contributing evidence source${sourceCount === 1 ? "" : "s"}.`
          : `Combined project evidence partially assessed this area across ${sourceCount} contributing evidence source${sourceCount === 1 ? "" : "s"}; this is not full verification.`
    };
  });
}

function summarise(findings: Finding[], suppressed: number): ScanReport["summary"] {
  const summary = { total: findings.length, suppressed, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}

export function combineScanReports(
  primary: ScanReport,
  ...additional: ScanReport[]
): MultiSourceScanReport {
  const reports = [primary, ...additional];
  if (reports.length < 2) throw new Error("A multi-source project report needs at least two scan reports.");

  const versions = new Set(reports.map((report) => report.tool.version));
  if (versions.size !== 1) {
    throw new Error("Ship Check can only combine reports produced by the same engine version.");
  }

  const evidenceSources = uniqueBy(
    reports.flatMap((report) => report.project.snapshot?.source ? [report.project.snapshot.source] : []),
    (source) => source.id
  );
  if (evidenceSources.length < 2) {
    throw new Error("Combined project reports need at least two distinct evidence sources with recorded provenance.");
  }

  const checks = uniqueBy(reports.flatMap((report) => report.checks), (check) => check.checkId);
  const findings = uniqueBy(reports.flatMap((report) => report.findings), (finding) => finding.id)
    .sort((a, b) => `${a.severity}:${a.id}`.localeCompare(`${b.severity}:${b.id}`));
  const suppressedFindings = uniqueBy(
    reports.flatMap((report) => report.suppressedFindings ?? []),
    (entry) => entry.finding.id
  ).sort((a, b) => a.finding.id.localeCompare(b.finding.id));
  const gaps = uniqueBy(reports.flatMap((report) => report.gaps ?? []), (gap) => gap.id)
    .sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`));
  const observations = uniqueBy(reports.flatMap((report) => report.observations ?? []), (observation) => observation.id)
    .sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`));

  return MultiSourceScanReportSchema.parse({
    ...primary,
    project: {
      ...primary.project,
      evidenceSources
    },
    packs: [...new Set(reports.flatMap((report) => report.packs))],
    checks,
    findings,
    suppressedFindings,
    gaps,
    observations,
    coverage: mergeCoverage(reports),
    summary: summarise(findings, suppressedFindings.length),
    generatedAt: new Date().toISOString()
  });
}
