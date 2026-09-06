const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

function stableHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableFindingBasis(finding) {
  const paths = [...new Set((finding.evidence ?? []).map((item) => item.path).filter(Boolean))]
    .sort()
    .join("|");
  return [finding.checkId ?? "unknown-check", finding.title ?? "untitled", paths].join("\n");
}

export function fingerprintFinding(finding) {
  return `f1:${stableHash(stableFindingBasis(finding))}`;
}

function higherSeverity(left, right) {
  return SEVERITY_ORDER.indexOf(right) > SEVERITY_ORDER.indexOf(left) ? right : left;
}

export function createFindingFingerprintSummary(report) {
  const byFingerprint = new Map();
  for (const finding of report?.findings ?? []) {
    const fingerprint = fingerprintFinding(finding);
    const current = byFingerprint.get(fingerprint);
    if (current) {
      current.count += 1;
      current.severity = higherSeverity(current.severity, finding.severity);
      continue;
    }
    byFingerprint.set(fingerprint, {
      fingerprint,
      checkId: finding.checkId,
      severity: finding.severity,
      count: 1,
    });
  }
  return [...byFingerprint.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

function normalisedPacks(entry) {
  return [...(entry?.packs ?? [])].sort().join("|");
}

function sameSource(left, right) {
  return Boolean(
    left?.source &&
      right?.source &&
      left.source.kind === right.source.kind &&
      left.source.label === right.source.label &&
      (left.source.ref ?? "") === (right.source.ref ?? ""),
  );
}

export function isComparableCompletedScan(left, right) {
  return Boolean(
    left?.event === "scan-completed" &&
      right?.event === "scan-completed" &&
      sameSource(left, right) &&
      normalisedPacks(left) === normalisedPacks(right),
  );
}

export function findPreviousComparableScan(entries, current) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index];
    if (isComparableCompletedScan(candidate, current)) return candidate;
  }
  return null;
}

function countMap(items) {
  const counts = new Map();
  for (const item of items ?? []) {
    counts.set(item.fingerprint, (counts.get(item.fingerprint) ?? 0) + (item.count ?? 1));
  }
  return counts;
}

export function compareFindingFingerprints(current, previous) {
  if (!previous) {
    return {
      status: "no-baseline",
      newCount: current?.summary?.total ?? 0,
      resolvedCount: 0,
      unchangedCount: 0,
    };
  }

  const currentCounts = countMap(current.findingFingerprints);
  const previousCounts = countMap(previous.findingFingerprints);
  const fingerprints = new Set([...currentCounts.keys(), ...previousCounts.keys()]);
  let newCount = 0;
  let resolvedCount = 0;
  let unchangedCount = 0;

  for (const fingerprint of fingerprints) {
    const now = currentCounts.get(fingerprint) ?? 0;
    const before = previousCounts.get(fingerprint) ?? 0;
    unchangedCount += Math.min(now, before);
    if (now > before) newCount += now - before;
    if (before > now) resolvedCount += before - now;
  }

  return {
    status: previous.summary?.total === 0 ? "previous-clean" : "previous-scan",
    baselineTimestamp: previous.timestamp,
    newCount,
    resolvedCount,
    unchangedCount,
  };
}
