import type { Finding, Observation, ScanReport } from "@ship-check/schemas";

type TransitionSet<T> = {
  introduced: T[];
  persistent: T[];
  noLongerActive: T[];
};

export type ReportComparison = {
  comparable: true;
  sourceSnapshot: "changed" | "unchanged" | "uncertain" | "unknown";
  findings: TransitionSet<Finding> & {
    reactivated: Finding[];
    accepted: Finding[];
  };
  gaps: TransitionSet<ScanReport["gaps"][number]>;
  surfaces: TransitionSet<Observation>;
} | {
  comparable: false;
  reason: string;
};

const severityRank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 } as const;

function mapById<T>(items: T[] | undefined, selector: (item: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items ?? []) {
    const id = selector(item);
    if (id) map.set(id, item);
  }
  return map;
}

function sortedValues<T extends { title?: string; severity?: keyof typeof severityRank; id?: string }>(
  map: Map<string, T>
): T[] {
  return [...map.values()].sort((left, right) => {
    const severity = (severityRank[right.severity ?? "info"] ?? 0) -
      (severityRank[left.severity ?? "info"] ?? 0);
    if (severity !== 0) return severity;
    return String(left.title ?? left.id ?? "").localeCompare(String(right.title ?? right.id ?? ""));
  });
}

function findingTransitions(baseReport: ScanReport, currentReport: ScanReport) {
  const baseActive = mapById(baseReport.findings, (item) => item.id);
  const currentActive = mapById(currentReport.findings, (item) => item.id);
  const baseAccepted = mapById(baseReport.suppressedFindings, (entry) => entry.finding.id);
  const currentAccepted = mapById(currentReport.suppressedFindings, (entry) => entry.finding.id);

  const introduced = new Map<string, Finding>();
  const persistent = new Map<string, Finding>();
  const reactivated = new Map<string, Finding>();
  const accepted = new Map<string, Finding>();
  const noLongerActive = new Map<string, Finding>();

  for (const [id, finding] of currentActive) {
    if (baseActive.has(id)) persistent.set(id, finding);
    else if (baseAccepted.has(id)) reactivated.set(id, finding);
    else introduced.set(id, finding);
  }

  for (const [id, finding] of baseActive) {
    if (currentAccepted.has(id)) accepted.set(id, currentAccepted.get(id)?.finding ?? finding);
    else if (!currentActive.has(id)) noLongerActive.set(id, finding);
  }

  return {
    introduced: sortedValues(introduced),
    persistent: sortedValues(persistent),
    reactivated: sortedValues(reactivated),
    accepted: sortedValues(accepted),
    noLongerActive: sortedValues(noLongerActive)
  };
}

function simpleTransitions<T extends { id: string; title?: string }>(
  baseItems: T[],
  currentItems: T[]
): TransitionSet<T> {
  const base = mapById(baseItems, (item) => item.id);
  const current = mapById(currentItems, (item) => item.id);
  const introduced = new Map<string, T>();
  const persistent = new Map<string, T>();
  const noLongerActive = new Map<string, T>();

  for (const [id, item] of current) {
    if (base.has(id)) persistent.set(id, item);
    else introduced.set(id, item);
  }
  for (const [id, item] of base) {
    if (!current.has(id)) noLongerActive.set(id, item);
  }

  return {
    introduced: sortedValues(introduced),
    persistent: sortedValues(persistent),
    noLongerActive: sortedValues(noLongerActive)
  };
}

function fingerprintComparison(
  baseReport: ScanReport,
  currentReport: ScanReport
): "changed" | "unchanged" | "uncertain" | "unknown" {
  const base = baseReport.project.snapshot?.inventory.fingerprint;
  const current = currentReport.project.snapshot?.inventory.fingerprint;
  if (!base || !current) return "unknown";
  if (base.value !== current.value) return "changed";
  if (base.completeness === "complete" && current.completeness === "complete") return "unchanged";
  return "uncertain";
}

function comparableChecks(report: ScanReport): string[] {
  return report.checks
    .map((check) => `${check.checkId}@${check.checkVersion ?? "1"}`)
    .sort();
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function inventoryObservations(report: ScanReport): Observation[] {
  return report.observations.filter((observation) => observation.kind === "inventory");
}

export function compareScanReports(
  baseReport: ScanReport,
  currentReport: ScanReport
): ReportComparison {
  const baseRuleset = baseReport.ruleset?.value ?? null;
  const currentRuleset = currentReport.ruleset?.value ?? null;
  const sameRuleset = baseRuleset && currentRuleset
    ? baseRuleset === currentRuleset
    : sameStringSet(comparableChecks(baseReport), comparableChecks(currentReport)) &&
      sameStringSet([...baseReport.packs].sort(), [...currentReport.packs].sort());

  if (!sameRuleset) {
    return {
      comparable: false,
      reason: "The base and current scans did not use the same ruleset."
    };
  }

  return {
    comparable: true,
    sourceSnapshot: fingerprintComparison(baseReport, currentReport),
    findings: findingTransitions(baseReport, currentReport),
    gaps: simpleTransitions(baseReport.gaps, currentReport.gaps),
    surfaces: simpleTransitions(inventoryObservations(baseReport), inventoryObservations(currentReport))
  };
}

function itemLine(prefix: string, item: { id: string; title?: string; severity?: string }): string {
  const severity = item.severity ? ` [${item.severity.toUpperCase()}]` : "";
  return `- ${prefix}${severity} ${item.title ?? item.id} — \`${item.id}\``;
}

export function renderComparisonMarkdown(comparison: ReportComparison): string {
  if (!comparison.comparable) {
    return [
      "# Ship Check comparison",
      "",
      `Comparison unavailable: ${comparison.reason}`,
      ""
    ].join("\n");
  }

  const { findings, gaps, surfaces } = comparison;
  const lines = [
    "# Ship Check comparison",
    "",
    `**Findings:** ${findings.introduced.length} introduced · ${findings.persistent.length} persistent · ${findings.reactivated.length} reactivated · ${findings.accepted.length} newly accepted · ${findings.noLongerActive.length} no longer active`,
    `**Unanswered controls:** ${gaps.introduced.length} introduced · ${gaps.persistent.length} persistent · ${gaps.noLongerActive.length} no longer active`,
    `**Observed surfaces:** ${surfaces.introduced.length} introduced · ${surfaces.persistent.length} persistent · ${surfaces.noLongerActive.length} no longer observed`,
    `**Source snapshot:** ${comparison.sourceSnapshot}`,
    ""
  ];

  const sections: Array<[string, string, Array<{ id: string; title?: string; severity?: string }>]> = [
    ["Introduced findings", "NEW", findings.introduced],
    ["Reactivated findings", "REACTIVATED", findings.reactivated],
    ["Persistent findings", "PERSISTENT", findings.persistent],
    ["Newly accepted exceptions", "ACCEPTED", findings.accepted],
    ["Findings no longer active", "NO LONGER ACTIVE", findings.noLongerActive],
    ["Introduced unanswered controls", "VERIFY NEW", gaps.introduced],
    ["Persistent unanswered controls", "VERIFY", gaps.persistent],
    ["Unanswered controls no longer active", "NO LONGER ACTIVE", gaps.noLongerActive]
  ];

  for (const [title, prefix, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`## ${title}`, "");
    for (const item of items) lines.push(itemLine(prefix, item));
    lines.push("");
  }

  lines.push(
    "A finding or unanswered control becoming “no longer active” is a scan-state change, not proof that the underlying issue was remediated.",
    "",
    "For repairs, run relevant project tests and rerun Ship Check before treating the work as verified."
  );

  return lines.join("\n");
}
