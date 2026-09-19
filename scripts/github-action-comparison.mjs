const severityRank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function mapById(items, selector = (item) => item?.id) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = selector(item);
    if (typeof id === "string" && id) map.set(id, item);
  }
  return map;
}

function sortedValues(map) {
  return [...map.values()].sort((left, right) => {
    const severity = (severityRank[right?.severity] ?? 0) - (severityRank[left?.severity] ?? 0);
    if (severity !== 0) return severity;
    return String(left?.title ?? left?.id ?? "").localeCompare(String(right?.title ?? right?.id ?? ""));
  });
}

function findingTransitions(baseReport, currentReport) {
  const baseActive = mapById(baseReport?.findings);
  const currentActive = mapById(currentReport?.findings);
  const baseAccepted = mapById(baseReport?.suppressedFindings, (entry) => entry?.finding?.id);
  const currentAccepted = mapById(currentReport?.suppressedFindings, (entry) => entry?.finding?.id);

  const introduced = new Map();
  const persistent = new Map();
  const reactivated = new Map();
  const accepted = new Map();
  const noLongerActive = new Map();

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
    noLongerActive: sortedValues(noLongerActive),
  };
}

function simpleTransitions(baseItems, currentItems) {
  const base = mapById(baseItems);
  const current = mapById(currentItems);
  const introduced = new Map();
  const persistent = new Map();
  const noLongerActive = new Map();

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
    noLongerActive: sortedValues(noLongerActive),
  };
}

function fingerprintComparison(baseReport, currentReport) {
  const base = baseReport?.project?.snapshot?.inventory?.fingerprint;
  const current = currentReport?.project?.snapshot?.inventory?.fingerprint;
  if (!base || !current) return "unknown";
  if (base.value !== current.value) return "changed";
  if (base.completeness === "complete" && current.completeness === "complete") return "unchanged";
  return "uncertain";
}

function rulesetValue(report) {
  const ruleset = report?.ruleset;
  if (
    ruleset?.algorithm === "sha256" &&
    ruleset?.scope === "check-ruleset-v1" &&
    /^[a-f0-9]{64}$/.test(ruleset?.value ?? "")
  ) {
    return ruleset.value;
  }
  return null;
}

function comparableChecks(report) {
  return (Array.isArray(report?.checks) ? report.checks : [])
    .map((check) => `${check.checkId}@${check.checkVersion ?? "1"}`)
    .sort();
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function inventoryObservations(report) {
  return (Array.isArray(report?.observations) ? report.observations : [])
    .filter((observation) => observation?.kind === "inventory");
}

export function compareReports(baseReport, currentReport) {
  const baseRuleset = rulesetValue(baseReport);
  const currentRuleset = rulesetValue(currentReport);
  const baseChecks = comparableChecks(baseReport);
  const currentChecks = comparableChecks(currentReport);
  const basePacks = [...(baseReport?.packs ?? [])].sort();
  const currentPacks = [...(currentReport?.packs ?? [])].sort();
  const sameRuleset = baseRuleset && currentRuleset
    ? baseRuleset === currentRuleset
    : sameStringSet(baseChecks, currentChecks) && sameStringSet(basePacks, currentPacks);

  if (!sameRuleset) {
    return {
      comparable: false,
      reason: "The base and current scans did not use the same ruleset.",
    };
  }

  return {
    comparable: true,
    sourceSnapshot: fingerprintComparison(baseReport, currentReport),
    findings: findingTransitions(baseReport, currentReport),
    gaps: simpleTransitions(baseReport?.gaps, currentReport?.gaps),
    surfaces: simpleTransitions(inventoryObservations(baseReport), inventoryObservations(currentReport)),
  };
}

function cleanTitle(value) {
  return String(value ?? "Untitled")
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 180);
}

function listItems(items, formatter, limit = 6) {
  const shown = items.slice(0, limit);
  const lines = shown.map((item) => `- ${formatter(item)}`);
  if (items.length > limit) lines.push(`- …and ${items.length - limit} more`);
  return lines;
}

function findingLabel(finding) {
  return `**${String(finding?.severity ?? "info").toUpperCase()}** · ${cleanTitle(finding?.title)}`;
}

function areaLabel(item) {
  return `**${cleanTitle(item?.area ?? "project")}** · ${cleanTitle(item?.title)}`;
}

export function formatPullRequestComparison(comparison, context = {}) {
  if (!comparison?.comparable) {
    return [
      "### Pull request change",
      "",
      `Comparison unavailable: ${cleanTitle(comparison?.reason ?? "the scans were not comparable")}.`,
      "",
    ].join("\n");
  }

  const findings = comparison.findings;
  const gaps = comparison.gaps;
  const surfaces = comparison.surfaces;
  const baseLabel = context.baseRef
    ? "`" + cleanTitle(context.baseRef) + "`" + (context.baseSha ? " at `" + cleanTitle(context.baseSha).slice(0, 8) + "`" : "")
    : "the pull request base";

  const snapshotLabels = {
    changed: "source snapshot changed",
    unchanged: "same complete source snapshot",
    uncertain: "source fingerprint matched but is partial",
    unknown: "source snapshot comparison unavailable",
  };

  const lines = [
    "### Pull request change",
    "",
    `Compared the PR source with ${baseLabel} using the same Ship Check revision and ruleset.`,
    "",
    `**Findings:** ${findings.introduced.length} new · ${findings.persistent.length} persistent · ${findings.reactivated.length} reactivated · ${findings.accepted.length} newly accepted · ${findings.noLongerActive.length} no longer active`,
    `**Unanswered controls:** ${gaps.introduced.length} new · ${gaps.persistent.length} persistent · ${gaps.noLongerActive.length} no longer active`,
    `**Observed surfaces:** ${surfaces.introduced.length} newly observed · ${surfaces.persistent.length} persistent · ${surfaces.noLongerActive.length} no longer observed`,
    `**Snapshot:** ${snapshotLabels[comparison.sourceSnapshot] ?? snapshotLabels.unknown}`,
    "",
  ];

  const sections = [
    ["New findings", findings.introduced, findingLabel],
    ["Reactivated findings", findings.reactivated, findingLabel],
    ["Newly accepted exceptions", findings.accepted, findingLabel],
    ["Findings no longer active", findings.noLongerActive, findingLabel],
    ["New unanswered controls", gaps.introduced, areaLabel],
    ["Unanswered controls no longer active", gaps.noLongerActive, areaLabel],
    ["Newly observed surfaces", surfaces.introduced, areaLabel],
  ];

  for (const [title, items, formatter] of sections) {
    if (!items.length) continue;
    lines.push(`#### ${title}`, "", ...listItems(items, formatter), "");
  }

  lines.push(
    "_“No longer active” is a scan-state change, not automatically proof that the underlying control was fixed._",
    "",
  );
  return lines.join("\n");
}
