// Local review decisions are separate from canonical scan findings and suppressions.
// Only opaque project/finding digests, a non-sensitive rule ID, a decision and an
// optional user-written rationale are persisted. Scanned source/evidence is never
// automatically copied into this store. Warn users not to paste sensitive data.
const STORE_KEY = "ship-check.finding-reviews.v1";
const MAX_RECORDS = 2000;
const MAX_NOTE_LENGTH = 500;
const DECISIONS = new Set(["useful", "not-relevant", "fixed", "accepted"]);
const REVIEW_STATUSES = new Set(["pending", "still-found", "not-detected", "not-rechecked"]);
const DIGEST = /^[a-f0-9]{64}$/;

export const reviewLabels = Object.freeze({
  useful: "Useful",
  "not-relevant": "Not relevant",
  fixed: "Fixed · recheck needed",
  accepted: "Risk accepted locally",
});

export const verificationLabels = Object.freeze({
  pending: "Not rechecked yet",
  "still-found": "Still found in the latest scan",
  "not-detected": "Not detected by the same check on the latest scan",
  "not-rechecked": "This concern was not assessed on the latest scan",
});

export async function opaqueKey(value) {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(String(value));
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export function projectIdentity(mode, sourceValue, relativePath = "") {
  // Estate projects share identities with standalone folder scans of the same
  // project. Sibling directories still have distinct identities.
  const source = String(sourceValue ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  const child = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const localPath = mode === "estate" && child && child !== "." ? source + "/" + child : source;
  return JSON.stringify(["ship-check-project-v1", mode === "estate" ? "local" : mode, localPath]);
}

export async function projectKey(mode, sourceValue, relativePath = "") {
  return opaqueKey(projectIdentity(mode, sourceValue, relativePath));
}

export async function findingKey(finding, checkVersion = "1") {
  if (!finding?.id || !finding?.checkId) return null;
  return opaqueKey(JSON.stringify(["ship-check-finding-v1", finding.checkId, finding.id, checkVersion]));
}

export async function checkKey(checkId, checkVersion = "1") {
  if (!checkId) return null;
  return opaqueKey(JSON.stringify(["ship-check-rule-v1", checkId, checkVersion]));
}

export function readReviews(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORE_KEY) ?? "null");
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed?.entries)) return [];
    return parsed.entries.filter(item =>
      item && DIGEST.test(item.projectKey) && DIGEST.test(item.findingKey) &&
      DIGEST.test(item.checkKey) && DECISIONS.has(item.decision) &&
      typeof item.ruleId === "string" && /^[\w.-]{1,120}$/.test(item.ruleId) &&
      typeof item.updatedAt === "string" &&
      REVIEW_STATUSES.has(item.verification) &&
      (typeof item.note === "undefined" || (typeof item.note === "string" && item.note.length <= MAX_NOTE_LENGTH))
    ).slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

export function writeReviews(storage, records) {
  const clean = records.slice(-MAX_RECORDS);
  try {
    if (typeof storage?.setItem !== "function") return false;
    storage.setItem(STORE_KEY, JSON.stringify({ schemaVersion: 1, entries: clean }));
    return true;
  } catch {
    return false;
  }
}

export function saveReview(storage, record, now = new Date().toISOString()) {
  if (!DIGEST.test(record?.projectKey ?? "") || !DIGEST.test(record?.findingKey ?? "") ||
      !DIGEST.test(record?.checkKey ?? "") || !DECISIONS.has(record?.decision)) {
    throw new Error("This review cannot be saved without a valid project, finding and decision.");
  }
  const note = record.decision === "accepted"
    ? String(record.note ?? "").trim().slice(0, MAX_NOTE_LENGTH)
    : "";
  if (record.decision === "accepted" && note.length < 10) {
    throw new Error("Explain why this risk is accepted (at least 10 characters).");
  }
  // This is explicitly a local review judgement, NOT a .ship-check.json suppression.
  const entry = {
    projectKey: record.projectKey,
    findingKey: record.findingKey,
    checkKey: record.checkKey,
    ruleId: String(record.ruleId ?? "").slice(0, 120),
    decision: record.decision,
    verification: "pending",
    updatedAt: now,
    ...(note ? { note } : {}),
  };
  if (!/^[\w.-]{1,120}$/.test(entry.ruleId)) {
    throw new Error("Invalid check identifier.");
  }
  const next = readReviews(storage).filter(item =>
    item.projectKey !== entry.projectKey || item.findingKey !== entry.findingKey
  );
  next.push(entry);
  if (!writeReviews(storage, next)) throw new Error("Local review storage is unavailable.");
  return entry;
}

export function clearReview(storage, projectId, findingId) {
  const entries = readReviews(storage);
  const next = entries.filter(item => item.projectKey !== projectId || item.findingKey !== findingId);
  if (next.length === entries.length) return true;
  return writeReviews(storage, next);
}

export function reviewsForProject(storage, key) {
  return readReviews(storage).filter(item => item.projectKey === key);
}

export function reviewForFinding(storage, key, findingId) {
  return reviewsForProject(storage, key).find(item => item.findingKey === findingId) ?? null;
}

/**
 * Update prior review verdicts after scanning. Presence always wins.
 * Absence alone cannot establish a fix: require the SAME rule+version to have
 * completed with evidence. A check error, scope omission or rule upgrade is
 * "not rechecked", not "resolved". Suppressed findings still count as present.
 */
export function reconcileReviews(records, key, checks, currentFindings, suppressedFindings = [], timestamp) {
  // An unanswered/unverified check has not demonstrated sufficient coverage
  // to rule out the prior finding. "Not detected" is only meaningful when
  // the same rule actually completed an assessment.
  const validStatuses = new Set(["passed", "findings", "resolved", "suppressed"]);
  const seen = new Set([...currentFindings, ...suppressedFindings]);
  const available = new Set(checks.filter(check => validStatuses.has(check.status)).map(check => check.key));
  return records.map(record => {
    if (record.projectKey !== key) return record;
    const verification = seen.has(record.findingKey)
      ? "still-found"
      : available.has(record.checkKey) ? "not-detected" : "not-rechecked";
    return { ...record, verification, ...(timestamp ? { lastScanAt: timestamp } : {}) };
  });
}

export async function indexScan(report) {
  const checks = await Promise.all((report.checks ?? []).map(async check => ({
    ...check, key: await checkKey(check.checkId, check.checkVersion ?? "1")
  })));
  const versions = new Map(checks.map(check => [check.checkId, check.checkVersion ?? "1"]));
  const withKeys = async findings => Promise.all((findings ?? []).map(item =>
    findingKey(item, versions.get(item.checkId) ?? "1")
  ));
  return {
    checks,
    findingKeys: await withKeys(report.findings),
    suppressedKeys: await withKeys((report.suppressedFindings ?? []).map(entry => entry.finding)),
  };
}

export async function updateReviewsFromScan(storage, projectId, report) {
  if (!projectId) return [];
  const current = readReviews(storage);
  if (!current.some(record => record.projectKey === projectId)) return [];
  const indexed = await indexScan(report);
  const next = reconcileReviews(
    current, projectId, indexed.checks,
    indexed.findingKeys.filter(Boolean),
    indexed.suppressedKeys.filter(Boolean),
    report.generatedAt ?? new Date().toISOString()
  );
  writeReviews(storage, next);
  return next.filter(item => item.projectKey === projectId);
}
