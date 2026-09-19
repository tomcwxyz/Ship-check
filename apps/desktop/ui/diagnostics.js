const STORAGE_KEY = "ship-check.diagnostics.v1";
const MAX_ENTRIES = 100;
const MAX_ERROR_LENGTH = 500;
const HASH_RE = /^[a-f0-9]{64}$/;

function truncate(value, limit = MAX_ERROR_LENGTH) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function redactSensitiveShapes(value) {
  return truncate(value)
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted-openai-key]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-github-token]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-aws-key]")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "[redacted-database-url]")
    .replace(/https:\/\/[^/@\s]+@github\.com/gi, "https://[redacted]@github.com");
}

function localLeaf(value) {
  const parts = String(value ?? "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "local-project";
}

function githubLabel(value) {
  const input = String(value ?? "").trim();
  const cleaned = input
    .replace(/^https:\/\/[^/@]+@github\.com\//i, "")
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts.at(-2)}/${parts.at(-1)}`;
  return "github-repository";
}

function runtimeLabel(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return "live-site";
  }
}

export function safeSourceLabel(sourceMode, value) {
  if (sourceMode === "github") return githubLabel(value);
  if (sourceMode === "runtime") return runtimeLabel(value);
  return localLeaf(value);
}

function sourceIdentityValue(sourceMode, value) {
  if (sourceMode === "github") return `github:${githubLabel(value).toLowerCase()}`;
  if (sourceMode === "runtime") {
    try {
      const url = new URL(String(value ?? ""));
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `runtime:${url.protocol}//${url.host.toLowerCase()}${pathname}`;
    } catch {
      return "runtime:live-site";
    }
  }
  return `${sourceMode}:${String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "")}`;
}

async function opaqueDigest(value) {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(String(value ?? ""));
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function opaqueIdentities(items) {
  const hashes = await Promise.all(
    (Array.isArray(items) ? items : []).map((item) => opaqueDigest(item?.id)),
  );
  return hashes.filter((value) => typeof value === "string" && HASH_RE.test(value)).sort();
}

function safeFingerprint(report) {
  const fingerprint = report?.project?.snapshot?.inventory?.fingerprint;
  if (
    !fingerprint ||
    fingerprint.algorithm !== "sha256" ||
    fingerprint.scope !== "source-inventory-v1" ||
    !HASH_RE.test(fingerprint.value)
  ) {
    return null;
  }
  return {
    algorithm: "sha256",
    scope: "source-inventory-v1",
    value: fingerprint.value,
    completeness: fingerprint.completeness === "complete" ? "complete" : "partial",
    entryCount: Math.max(0, Number(fingerprint.entryCount) || 0),
    hashedEntryCount: Math.max(0, Number(fingerprint.hashedEntryCount) || 0),
    skippedEntryCount: Math.max(0, Number(fingerprint.skippedEntryCount) || 0),
  };
}

function safeRuleset(report) {
  const ruleset = report?.ruleset;
  if (
    !ruleset ||
    ruleset.algorithm !== "sha256" ||
    ruleset.scope !== "check-ruleset-v1" ||
    !HASH_RE.test(ruleset.value)
  ) {
    return null;
  }
  return {
    algorithm: "sha256",
    scope: "check-ruleset-v1",
    value: ruleset.value,
    checkCount: Math.max(0, Number(ruleset.checkCount) || 0),
  };
}

function comparableRuleset(left, right) {
  const leftRuleset = left?.ruleset?.value;
  const rightRuleset = right?.ruleset?.value;
  if (HASH_RE.test(leftRuleset ?? "") && HASH_RE.test(rightRuleset ?? "")) {
    return leftRuleset === rightRuleset;
  }
  return samePacks(left, right) && checkSignature(left) === checkSignature(right);
}

function checkSignature(entry) {
  return (entry?.checks ?? [])
    .map((check) => `${check.checkId}@${check.checkVersion ?? "1"}`)
    .sort()
    .join("|");
}

function samePacks(left, right) {
  return [...(left?.packs ?? [])].sort().join("|") === [...(right?.packs ?? [])].sort().join("|");
}

function setComparison(currentValues, previousValues) {
  const current = new Set(currentValues ?? []);
  const previous = new Set(previousValues ?? []);
  let introduced = 0;
  let persistent = 0;
  let resolved = 0;
  for (const value of current) {
    if (previous.has(value)) persistent += 1;
    else introduced += 1;
  }
  for (const value of previous) {
    if (!current.has(value)) resolved += 1;
  }
  return { introduced, persistent, resolved };
}

function snapshotComparison(current, previous) {
  const currentFingerprint = current?.source?.fingerprint;
  const previousFingerprint = previous?.source?.fingerprint;
  if (!currentFingerprint || !previousFingerprint) return "unknown";
  if (currentFingerprint.value !== previousFingerprint.value) return "changed";
  if (
    currentFingerprint.completeness === "complete" &&
    previousFingerprint.completeness === "complete"
  ) {
    return "unchanged";
  }
  return "uncertain";
}

export function compareWithPreviousDiagnostics(entries, current) {
  if (
    current?.event !== "scan-completed" ||
    !current?.source?.identity ||
    !Array.isArray(current.findingIdentities) ||
    !Array.isArray(current.gapIdentities)
  ) {
    return null;
  }

  const previous = [...(entries ?? [])].reverse().find((entry) =>
    entry?.event === "scan-completed" &&
    entry?.source?.identity === current.source.identity &&
    comparableRuleset(entry, current) &&
    Array.isArray(entry.findingIdentities) &&
    Array.isArray(entry.gapIdentities)
  );
  if (!previous) return null;

  return {
    baselineTimestamp: previous.timestamp,
    snapshot: snapshotComparison(current, previous),
    findings: setComparison(current.findingIdentities, previous.findingIdentities),
    gaps: setComparison(current.gapIdentities, previous.gapIdentities),
  };
}

export function formatComparison(comparison) {
  if (!comparison) return "";
  const snapshotLabels = {
    unchanged: "same complete source snapshot",
    changed: "source snapshot changed",
    uncertain: "source fingerprint matched but is partial",
    unknown: "source snapshot comparison unavailable",
  };
  return [
    `${comparison.findings.introduced} new · ${comparison.findings.persistent} persistent · ${comparison.findings.resolved} resolved findings`,
    `${comparison.gaps.introduced} new · ${comparison.gaps.persistent} persistent · ${comparison.gaps.resolved} resolved unanswered questions`,
    snapshotLabels[comparison.snapshot] ?? snapshotLabels.unknown,
  ].join(" · ");
}

function safeCheck(check) {
  return {
    checkId: check.checkId,
    ...(check.scannerVersion ? { scannerVersion: check.scannerVersion } : {}),
    checkVersion: check.checkVersion ?? "1",
    pack: check.pack,
    status: check.status,
    findingCount: check.findingCount,
    suppressedCount: check.suppressedCount ?? 0,
    gapCount: check.gapCount ?? 0,
    resolvedGapCount: check.resolvedGapCount ?? 0,
    observationCount: check.observationCount ?? 0,
    missingEvidence: Array.isArray(check.missingEvidence) ? [...check.missingEvidence] : [],
    durationMs: check.durationMs,
    ...(check.error ? { error: redactSensitiveShapes(check.error) } : {}),
  };
}

function safeCoverage(entry) {
  return {
    area: entry.area,
    status: entry.status,
    checkCount: Array.isArray(entry.checkIds) ? entry.checkIds.length : 0,
  };
}

function safeOptions(options) {
  const databasePlatform = ["postgres", "supabase", "neon"].includes(options?.databasePlatform)
    ? options.databasePlatform
    : "postgres";
  const requestedLimit = Number(options?.databaseTableLimit);
  const databaseTableLimit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 5000
    ? requestedLimit
    : 1000;
  return {
    localSemgrepScan: Boolean(options?.localSemgrepScan),
    networkedDependencyScan: Boolean(options?.networkedDependencyScan),
    deploymentEvidence: Boolean(options?.deploymentUrl),
    databaseInspection: Boolean(options?.databaseInspection),
    ...(options?.databaseInspection ? { databasePlatform, databaseTableLimit } : {}),
  };
}

export async function createSuccessDiagnostic({ report, sourceMode, sourceValue, gitRef, packs, options, elapsedMs }) {
  const [sourceIdentity, findingIdentities, gapIdentities] = await Promise.all([
    opaqueDigest(sourceIdentityValue(sourceMode, sourceValue)),
    opaqueIdentities(report?.findings),
    opaqueIdentities(report?.gaps),
  ]);
  const fingerprint = safeFingerprint(report);
  const ruleset = safeRuleset(report);
  return {
    schemaVersion: "1",
    event: "scan-completed",
    timestamp: report.generatedAt || new Date().toISOString(),
    toolVersion: report.tool?.version ?? "unknown",
    source: {
      kind: sourceMode,
      label: safeSourceLabel(sourceMode, sourceValue),
      ...(sourceIdentity ? { identity: sourceIdentity } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      ...(typeof report?.project?.commit === "string" ? { commit: report.project.commit } : {}),
      ...(sourceMode === "github" && gitRef ? { ref: truncate(gitRef, 200) } : {}),
      evidenceSourceCount: Array.isArray(report?.project?.evidenceSources)
        ? report.project.evidenceSources.length
        : report?.project?.snapshot?.source
          ? 1
          : 0,
    },
    inventorySource:
      report.project?.inventorySource ?? (report.project?.gitRepository ? "git-tracked" : "filesystem"),
    fileCount: report.project?.fileCount ?? 0,
    packs: [...packs],
    options: safeOptions(options),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    summary: { ...report.summary },
    suppressedCount: report.suppressedFindings?.length ?? report.summary?.suppressed ?? 0,
    unverifiedCount: report.gaps?.length ?? 0,
    resolvedCount: report.resolvedGaps?.length ?? 0,
    observedCount: report.observations?.length ?? 0,
    notAssessedCount: report.checks?.filter((check) => check.status === "not-assessed").length ?? 0,
    coverage: (report.coverage ?? []).map(safeCoverage),
    checks: report.checks.map(safeCheck),
    ...(ruleset ? { ruleset } : {}),
    findingIdentities,
    gapIdentities,
  };
}

export function createFailureDiagnostic({ sourceMode, sourceValue, gitRef, packs, options, elapsedMs, engineVersion, error }) {
  return {
    schemaVersion: "1",
    event: "scan-failed",
    timestamp: new Date().toISOString(),
    toolVersion: engineVersion || "unknown",
    source: {
      kind: sourceMode,
      label: safeSourceLabel(sourceMode, sourceValue),
      ...(sourceMode === "github" && gitRef ? { ref: truncate(gitRef, 200) } : {}),
    },
    packs: [...packs],
    options: safeOptions(options),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    error: redactSensitiveShapes(error),
  };
}

export function readDiagnostics(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendDiagnostic(storage, entry) {
  const entries = [...readDiagnostics(storage), entry].slice(-MAX_ENTRIES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics must never block a scan if storage is unavailable.
  }
  return entries;
}

export function clearDiagnostics(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

function optionLines(entry) {
  const lines = [
    `live deployment evidence: ${entry.options?.deploymentEvidence ? "on" : "off"}`,
    `database metadata inspection: ${entry.options?.databaseInspection ? "on" : "off"}`,
  ];
  if (entry.options?.databaseInspection) {
    lines.push(`database platform: ${entry.options.databasePlatform} · table limit: ${entry.options.databaseTableLimit}`);
  }
  lines.push(
    `local Semgrep scan: ${entry.options?.localSemgrepScan ? "on" : "off"}`,
    `dependency network scan: ${entry.options?.networkedDependencyScan ? "on" : "off"}`,
  );
  return lines;
}

export function formatReceipt(entry) {
  if (!entry) return "No scan receipt yet.";
  if (entry.event === "scan-failed") {
    return [
      "Scan failed",
      `${entry.source.kind} · ${entry.source.label}`,
      ...optionLines(entry),
      `engine ${entry.toolVersion} · ${entry.elapsedMs} ms`,
      `error: ${entry.error}`,
    ].join("\n");
  }

  const passed = entry.checks.filter((check) => check.status === "passed").length;
  const findings = entry.checks.filter((check) => check.status === "findings").length;
  const suppressedChecks = entry.checks.filter((check) => check.status === "suppressed").length;
  const unverified = entry.checks.filter((check) => check.status === "unverified").length;
  const resolved = entry.checks.filter((check) => check.status === "resolved").length;
  const notAssessed = entry.checks.filter((check) => check.status === "not-assessed").length;
  const errors = entry.checks.filter((check) => check.status === "error").length;
  const lines = [
    "Scan completed",
    `${entry.source.kind} · ${entry.source.label}${entry.source.ref ? ` · ${entry.source.ref}` : ""}`,
    `${entry.source.evidenceSourceCount ?? 1} evidence source${entry.source.evidenceSourceCount === 1 ? "" : "s"} · ${entry.fileCount} files · ${entry.checks.length} checks · ${entry.inventorySource}`,
    ...optionLines(entry),
    `${passed} passed · ${findings} with findings · ${suppressedChecks} suppression-only · ${entry.suppressedCount ?? 0} suppressed findings · ${unverified} unverified · ${resolved} resolved by other evidence · ${entry.resolvedCount ?? 0} resolved questions · ${notAssessed} not assessed · ${entry.observedCount ?? 0} observed · ${errors} errors · ${entry.elapsedMs} ms`,
    `engine ${entry.toolVersion}`,
    ...(entry.ruleset ? [`ruleset ${entry.ruleset.value.slice(0, 12)} · ${entry.ruleset.checkCount} checks`] : []),
    "",
    ...entry.checks.map(
      (check) => `${check.status.padEnd(12)} ${check.checkId}@${check.checkVersion ?? "1"} · ${check.findingCount} findings · ${check.suppressedCount ?? 0} suppressed · ${check.gapCount ?? 0} gaps · ${check.resolvedGapCount ?? 0} resolved gaps · ${check.observationCount ?? 0} observed · ${check.durationMs} ms${check.missingEvidence?.length ? ` · missing ${check.missingEvidence.join(",")}` : ""}`,
    ),
  ];
  if (entry.comparison) {
    lines.push("", "since previous comparable scan", formatComparison(entry.comparison));
  }
  if (entry.coverage?.length) {
    lines.push("", "coverage", ...entry.coverage.map((item) => `${item.status.padEnd(12)} ${item.area} · ${item.checkCount} checks`));
  }
  return lines.join("\n");
}

export function formatDiagnostics(entries) {
  return JSON.stringify(
    {
      schemaVersion: "1",
      exportedAt: new Date().toISOString(),
      note: "Ship Check diagnostics contain scan metadata only: no source contents, raw finding/gap IDs, suppression rationales/finding details, resolved-question details, observation paths/details, evidence excerpts, local source paths, deployment URL paths/query strings, database connection URLs/credentials, cookie values or matched secret values. Regression identities, source locators and ruleset provenance are stored only as SHA-256 digests.",
      entries,
    },
    null,
    2,
  );
}
