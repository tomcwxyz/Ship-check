const STORAGE_KEY = "ship-check.diagnostics.v1";
const MAX_ENTRIES = 100;
const MAX_ERROR_LENGTH = 500;

function truncate(value, limit = MAX_ERROR_LENGTH) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function redactSensitiveShapes(value) {
  return truncate(value)
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted-openai-key]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-github-token]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-aws-key]")
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

export function safeSourceLabel(sourceMode, value) {
  return sourceMode === "github" ? githubLabel(value) : localLeaf(value);
}

function safeCheck(check) {
  return {
    checkId: check.checkId,
    pack: check.pack,
    status: check.status,
    findingCount: check.findingCount,
    durationMs: check.durationMs,
    ...(check.error ? { error: redactSensitiveShapes(check.error) } : {}),
  };
}

export function createSuccessDiagnostic({ report, sourceMode, sourceValue, gitRef, packs, elapsedMs }) {
  return {
    schemaVersion: "1",
    event: "scan-completed",
    timestamp: report.generatedAt || new Date().toISOString(),
    toolVersion: report.tool?.version ?? "unknown",
    source: {
      kind: sourceMode,
      label: safeSourceLabel(sourceMode, sourceValue),
      ...(sourceMode === "github" && gitRef ? { ref: truncate(gitRef, 200) } : {}),
    },
    inventorySource:
      report.project?.inventorySource ?? (report.project?.gitRepository ? "git-tracked" : "filesystem"),
    fileCount: report.project?.fileCount ?? 0,
    packs: [...packs],
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    summary: { ...report.summary },
    checks: report.checks.map(safeCheck),
  };
}

export function createFailureDiagnostic({ sourceMode, sourceValue, gitRef, packs, elapsedMs, engineVersion, error }) {
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

export function formatReceipt(entry) {
  if (!entry) return "No scan receipt yet.";
  if (entry.event === "scan-failed") {
    return [
      "Scan failed",
      `${entry.source.kind} · ${entry.source.label}`,
      `engine ${entry.toolVersion} · ${entry.elapsedMs} ms`,
      `error: ${entry.error}`,
    ].join("\n");
  }

  const passed = entry.checks.filter((check) => check.status === "passed").length;
  const findings = entry.checks.filter((check) => check.status === "findings").length;
  const errors = entry.checks.filter((check) => check.status === "error").length;
  const lines = [
    "Scan completed",
    `${entry.source.kind} · ${entry.source.label}${entry.source.ref ? ` · ${entry.source.ref}` : ""}`,
    `${entry.fileCount} files · ${entry.checks.length} checks · ${entry.inventorySource}`,
    `${passed} passed · ${findings} with findings · ${errors} errors · ${entry.elapsedMs} ms`,
    `engine ${entry.toolVersion}`,
    "",
    ...entry.checks.map(
      (check) => `${check.status.padEnd(8)} ${check.checkId} · ${check.findingCount} findings · ${check.durationMs} ms`,
    ),
  ];
  return lines.join("\n");
}

export function formatDiagnostics(entries) {
  return JSON.stringify(
    {
      schemaVersion: "1",
      exportedAt: new Date().toISOString(),
      note: "Ship Check diagnostics contain scan metadata only: no source contents, evidence excerpts or matched secret values.",
      entries,
    },
    null,
    2,
  );
}
