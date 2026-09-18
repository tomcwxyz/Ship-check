import { desktopBridge } from "./bridge.js";
import {
  renderCoverage,
  renderFindings,
  renderGaps,
  renderObservations,
  renderSummary,
  renderSuppressions,
  setEnginePill,
} from "./components.js";
import {
  appendDiagnostic,
  clearDiagnostics,
  compareWithPreviousDiagnostics,
  createFailureDiagnostic,
  createSuccessDiagnostic,
  formatComparison,
  formatDiagnostics,
  formatReceipt,
  readDiagnostics,
} from "./diagnostics.js";

const SOURCE_MODES = new Set(["local", "github", "archive", "runtime"]);

const state = {
  sourceMode: "local",
  projectPath: "",
  archivePath: "",
  runtimeUrl: "",
  deploymentUrl: "",
  githubRepository: "",
  githubRef: "",
  engine: null,
  report: null,
  scanning: false,
  severityFilter: "all",
};

const elements = {
  enginePill: document.querySelector("#engine-pill"),
  engineLabel: document.querySelector("#engine-label"),
  sourceSwitch: document.querySelector("#source-switch"),
  localSource: document.querySelector("#local-source"),
  githubSource: document.querySelector("#github-source"),
  archiveSource: document.querySelector("#archive-source"),
  runtimeSource: document.querySelector("#runtime-source"),
  githubRepository: document.querySelector("#github-repository"),
  githubRef: document.querySelector("#github-ref"),
  chooseProject: document.querySelector("#choose-project"),
  projectPath: document.querySelector("#project-path"),
  projectPathValue: document.querySelector("#project-path-value"),
  chooseArchive: document.querySelector("#choose-archive"),
  archivePath: document.querySelector("#archive-path"),
  archivePathValue: document.querySelector("#archive-path-value"),
  runtimeUrl: document.querySelector("#runtime-url"),
  deploymentCompanion: document.querySelector("#deployment-companion"),
  deploymentUrl: document.querySelector("#deployment-url"),
  defaultScanNote: document.querySelector("#default-scan-note"),
  scanExplainer: document.querySelector("#scan-explainer"),
  packGrid: document.querySelector("#pack-grid"),
  localSemgrepScan: document.querySelector("#local-semgrep-scan"),
  networkedDependencyScan: document.querySelector("#networked-dependency-scan"),
  inspectDatabase: document.querySelector("#inspect-database"),
  databaseInspectionFields: document.querySelector("#database-inspection-fields"),
  databaseConnectionString: document.querySelector("#database-connection-string"),
  databasePlatform: document.querySelector("#database-platform"),
  databaseTableLimit: document.querySelector("#database-table-limit"),
  runScan: document.querySelector("#run-scan"),
  rerunScan: document.querySelector("#rerun-scan"),
  errorBanner: document.querySelector("#error-banner"),
  results: document.querySelector("#results"),
  summaryGrid: document.querySelector("#summary-grid"),
  coverageGrid: document.querySelector("#coverage-grid"),
  observationsPanel: document.querySelector("#observations-panel"),
  observationsList: document.querySelector("#observations-list"),
  suppressionsPanel: document.querySelector("#suppressions-panel"),
  suppressionsList: document.querySelector("#suppressions-list"),
  unverifiedPanel: document.querySelector("#unverified-panel"),
  unverifiedList: document.querySelector("#unverified-list"),
  scanMeta: document.querySelector("#scan-meta"),
  historySummary: null,
  severityFilters: document.querySelector("#severity-filters"),
  findingsList: document.querySelector("#findings-list"),
  emptyState: document.querySelector("#empty-state"),
  emptyCopy: document.querySelector("#empty-copy"),
  diagnosticsPanel: null,
  diagnosticsSummary: null,
  scanReceipt: null,
  copyDiagnostics: null,
  clearDiagnostics: null,
};

function selectedPacks() {
  return [...elements.packGrid.querySelectorAll('input[type="checkbox"]:checked')].map(
    (input) => input.value,
  );
}

function secureBuildSelected() {
  return selectedPacks().includes("secure-build");
}

function productionReadySelected() {
  return selectedPacks().includes("production-ready");
}

function sourceHasFiles() {
  return state.sourceMode !== "runtime";
}

function databaseTableLimit() {
  const value = Number(elements.databaseTableLimit?.value || 1000);
  return Number.isInteger(value) && value >= 1 && value <= 5000 ? value : null;
}

function databaseInspectionEnabled() {
  return Boolean(elements.inspectDatabase?.checked);
}

function databaseInspectionReady() {
  if (!databaseInspectionEnabled()) return true;
  return productionReadySelected()
    && Boolean(elements.databaseConnectionString?.value.trim())
    && databaseTableLimit() !== null;
}

function scanOptions() {
  const databaseInspection = databaseInspectionEnabled();
  return {
    localSemgrepScan:
      sourceHasFiles() && secureBuildSelected() && Boolean(elements.localSemgrepScan?.checked),
    networkedDependencyScan:
      sourceHasFiles() && productionReadySelected() && Boolean(elements.networkedDependencyScan?.checked),
    deploymentUrl: state.sourceMode === "runtime" ? "" : state.deploymentUrl.trim(),
    databaseInspection,
    ...(databaseInspection ? {
      databasePlatform: elements.databasePlatform?.value || "postgres",
      databaseTableLimit: databaseTableLimit() ?? 1000,
    } : {}),
  };
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.hidden = false;
}

function clearError() {
  elements.errorBanner.textContent = "";
  elements.errorBanner.hidden = true;
}

function sourceReady() {
  if (state.sourceMode === "github") return Boolean(state.githubRepository.trim());
  if (state.sourceMode === "archive") return Boolean(state.archivePath);
  if (state.sourceMode === "runtime") return Boolean(state.runtimeUrl.trim());
  return Boolean(state.projectPath);
}

function currentSourceValue() {
  if (state.sourceMode === "github") return state.githubRepository.trim();
  if (state.sourceMode === "archive") return state.archivePath;
  if (state.sourceMode === "runtime") return state.runtimeUrl.trim();
  return state.projectPath;
}

function updateDeepScanAvailability() {
  const sourceAvailable = sourceHasFiles();
  const semgrepEnabled = sourceAvailable && secureBuildSelected();
  if (elements.localSemgrepScan) {
    if (!semgrepEnabled) elements.localSemgrepScan.checked = false;
    elements.localSemgrepScan.disabled = state.scanning || !semgrepEnabled;
  }

  const dependencyEnabled = sourceAvailable && productionReadySelected();
  if (elements.networkedDependencyScan) {
    if (!dependencyEnabled) elements.networkedDependencyScan.checked = false;
    elements.networkedDependencyScan.disabled = state.scanning || !dependencyEnabled;
  }
}

function updateDatabaseAvailability() {
  const enabledByPack = productionReadySelected();
  if (!enabledByPack && elements.inspectDatabase.checked) {
    elements.inspectDatabase.checked = false;
    elements.databaseConnectionString.value = "";
  }
  elements.inspectDatabase.disabled = state.scanning || !enabledByPack;
  elements.databaseInspectionFields.hidden = !elements.inspectDatabase.checked;
  elements.databaseConnectionString.disabled = state.scanning || !elements.inspectDatabase.checked;
  elements.databasePlatform.disabled = state.scanning || !elements.inspectDatabase.checked;
  elements.databaseTableLimit.disabled = state.scanning || !elements.inspectDatabase.checked;
}

function updateRunAvailability() {
  const ready =
    sourceReady() &&
    Boolean(state.engine?.available) &&
    selectedPacks().length > 0 &&
    databaseInspectionReady() &&
    !state.scanning;
  elements.runScan.disabled = !ready;
  elements.rerunScan.disabled = state.scanning || !ready;
}

function scanningLabel() {
  const database = databaseInspectionEnabled();
  if (state.sourceMode === "github") return database ? "Checking out source & database…" : "Checking out & scanning…";
  if (state.sourceMode === "archive") return database ? "Opening export & checking database…" : "Opening export & scanning…";
  if (state.sourceMode === "runtime") return database ? "Checking live site & database…" : "Checking live site…";
  if (state.deploymentUrl.trim() && database) return "Checking source, live site & database…";
  if (state.deploymentUrl.trim()) return "Checking source & live site…";
  if (database) return "Checking source & database…";
  return "Checking…";
}

function setScanning(scanning) {
  state.scanning = scanning;
  elements.runScan.textContent = scanning ? scanningLabel() : "Run Ship Check";
  elements.chooseProject.disabled = scanning;
  elements.chooseArchive.disabled = scanning;
  elements.githubRepository.disabled = scanning;
  elements.githubRef.disabled = scanning;
  elements.runtimeUrl.disabled = scanning;
  elements.deploymentUrl.disabled = scanning;
  for (const button of elements.sourceSwitch.querySelectorAll("[data-source]")) {
    button.disabled = scanning;
  }
  for (const checkbox of elements.packGrid.querySelectorAll('input[type="checkbox"]')) {
    checkbox.disabled = scanning;
  }
  updateDeepScanAvailability();
  updateDatabaseAvailability();
  updateRunAvailability();
}

function setProjectPath(projectPath) {
  state.projectPath = projectPath || "";
  elements.projectPath.dataset.empty = state.projectPath ? "false" : "true";
  elements.projectPathValue.textContent = state.projectPath || "No folder chosen yet";
  elements.projectPathValue.title = state.projectPath;
  updateRunAvailability();
}

function setArchivePath(archivePath) {
  state.archivePath = archivePath || "";
  elements.archivePath.dataset.empty = state.archivePath ? "false" : "true";
  elements.archivePathValue.textContent = state.archivePath || "No project ZIP chosen yet";
  elements.archivePathValue.title = state.archivePath;
  updateRunAvailability();
}

function updateSourceGuidance() {
  const runtimeOnly = state.sourceMode === "runtime";
  const database = databaseInspectionEnabled();
  elements.deploymentCompanion.hidden = runtimeOnly;
  if (runtimeOnly) {
    elements.defaultScanNote.querySelector("strong").textContent = database
      ? "This review combines live runtime and database metadata evidence."
      : "This review uses live runtime evidence only.";
    elements.defaultScanNote.querySelector("span").textContent = database
      ? "Source and dependency areas stay visibly not assessed; database evidence is limited to the explicit read-only metadata boundary."
      : "Source, dependencies, database internals and other unavailable areas stay visibly not assessed.";
    elements.scanExplainer.querySelector("strong").textContent = "The live checks are bounded and non-mutating.";
    elements.scanExplainer.querySelector("span").textContent = database
      ? "Ship Check inspects response metadata and fixed database catalogue metadata; it discards response bodies and reads no application rows."
      : "Ship Check follows a small redirect chain, inspects response metadata and discards response bodies and cookie values.";
  } else {
    elements.defaultScanNote.querySelector("strong").textContent = database
      ? "Source and live database metadata will be reviewed together."
      : "The standard review is ready to run.";
    elements.defaultScanNote.querySelector("span").textContent = "Ship Check uses the evidence this source can provide, and marks unavailable evidence as not assessed rather than assuming it is safe.";
    elements.scanExplainer.querySelector("strong").textContent = "Nothing changes in the project or database.";
    elements.scanExplainer.querySelector("span").textContent = database
      ? "Source inspection is read-only. Database inspection uses a read-only transaction and fixed catalogue queries only."
      : "Source inspection is read-only. Live-site checks make bounded HTTP requests only when a deployment URL is included.";
  }
}

function setSourceMode(mode) {
  if (!SOURCE_MODES.has(mode)) return;
  state.sourceMode = mode;
  elements.localSource.hidden = mode !== "local";
  elements.githubSource.hidden = mode !== "github";
  elements.archiveSource.hidden = mode !== "archive";
  elements.runtimeSource.hidden = mode !== "runtime";
  for (const button of elements.sourceSwitch.querySelectorAll("[data-source]")) {
    button.classList.toggle("is-active", button.dataset.source === mode);
  }
  clearError();
  updateSourceGuidance();
  updateDeepScanAvailability();
  updateDatabaseAvailability();
  updateRunAvailability();
  if (mode === "github") elements.githubRepository.focus();
  if (mode === "runtime") elements.runtimeUrl.focus();
}

function assertScanReport(report) {
  const valid =
    report &&
    report.schemaVersion === "0.1" &&
    report.tool?.name === "ship-check" &&
    report.project &&
    ["git-tracked", "filesystem"].includes(report.project.inventorySource) &&
    Array.isArray(report.checks) &&
    Array.isArray(report.findings) &&
    Array.isArray(report.suppressedFindings) &&
    Array.isArray(report.gaps) &&
    Array.isArray(report.observations) &&
    Array.isArray(report.coverage) &&
    report.summary;
  if (!valid) {
    throw new Error("The local engine returned an unexpected report. Update the desktop app and engine together.");
  }
  return report;
}

function ensureDiagnosticsPanel() {
  if (elements.diagnosticsPanel) return;

  const panel = document.createElement("details");
  panel.className = "diagnostics-card";
  panel.hidden = true;

  const summary = document.createElement("summary");
  summary.textContent = "Scan receipt & diagnostics";
  panel.append(summary);

  const copy = document.createElement("p");
  copy.className = "source-help";
  copy.textContent = "Stored locally for alpha testing. Includes safe project labels, engine/rule versions, selected scan options, evidence-source count, coverage status, timings, check outcomes and opaque SHA-256 identities used for local regression comparison — never source contents, raw local paths, raw finding/gap IDs, database connection URLs/credentials, deployment query strings, cookie values, finding details, observation details, evidence excerpts or matched secret values.";
  panel.append(copy);

  const receipt = document.createElement("pre");
  receipt.className = "scan-receipt";
  panel.append(receipt);

  const actions = document.createElement("div");
  actions.className = "diagnostics-actions";

  const copyButton = document.createElement("button");
  copyButton.className = "button button-quiet";
  copyButton.type = "button";
  copyButton.textContent = "Copy diagnostics";

  const clearButton = document.createElement("button");
  clearButton.className = "button button-quiet";
  clearButton.type = "button";
  clearButton.textContent = "Clear diagnostics";

  actions.append(copyButton, clearButton);
  panel.append(actions);
  elements.errorBanner.insertAdjacentElement("afterend", panel);

  elements.diagnosticsPanel = panel;
  elements.diagnosticsSummary = summary;
  elements.scanReceipt = receipt;
  elements.copyDiagnostics = copyButton;
  elements.clearDiagnostics = clearButton;

  copyButton.addEventListener("click", async () => {
    try {
      const entries = readDiagnostics(window.localStorage);
      await navigator.clipboard.writeText(formatDiagnostics(entries));
      copyButton.textContent = `Copied ${entries.length} scan${entries.length === 1 ? "" : "s"}`;
      window.setTimeout(() => {
        copyButton.textContent = "Copy diagnostics";
      }, 1600);
    } catch (error) {
      showError(`Could not copy diagnostics: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  clearButton.addEventListener("click", () => {
    clearDiagnostics(window.localStorage);
    renderDiagnostics(null, 0);
    renderHistoryComparison(null);
  });
}

function renderDiagnostics(entry, count) {
  ensureDiagnosticsPanel();
  elements.diagnosticsPanel.hidden = count === 0 && !entry;
  elements.diagnosticsSummary.textContent = `Scan receipt & diagnostics · ${count} stored`;
  elements.scanReceipt.textContent = formatReceipt(entry);
}

function ensureHistorySummary() {
  if (elements.historySummary) return elements.historySummary;
  const summary = document.createElement("p");
  summary.className = "source-help";
  summary.hidden = true;
  elements.scanMeta.insertAdjacentElement("afterend", summary);
  elements.historySummary = summary;
  return summary;
}

function renderHistoryComparison(comparison) {
  const summary = ensureHistorySummary();
  if (!comparison) {
    summary.textContent = "No comparable local scan yet. The next scan with the same project identity and rule set can show what changed.";
    summary.hidden = false;
    return;
  }
  const baseline = new Date(comparison.baselineTimestamp);
  const when = Number.isNaN(baseline.getTime())
    ? "the previous comparable scan"
    : baseline.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  summary.textContent = `Since ${when}: ${formatComparison(comparison)}.`;
  summary.hidden = false;
}

function restoreDiagnostics() {
  const entries = readDiagnostics(window.localStorage);
  renderDiagnostics(entries.at(-1) ?? null, entries.length);
}

async function recordSuccess(report, packs, options, startedAt) {
  const previousEntries = readDiagnostics(window.localStorage);
  const entry = await createSuccessDiagnostic({
    report,
    sourceMode: state.sourceMode,
    sourceValue: currentSourceValue(),
    gitRef: state.githubRef.trim(),
    packs,
    options,
    elapsedMs: performance.now() - startedAt,
  });
  const comparison = compareWithPreviousDiagnostics(previousEntries, entry);
  if (comparison) entry.comparison = comparison;
  const entries = appendDiagnostic(window.localStorage, entry);
  renderDiagnostics(entry, entries.length);
  renderHistoryComparison(comparison);
  return entry;
}

function recordFailure(error, packs, options, startedAt) {
  const message = error instanceof Error ? error.message : String(error);
  const entry = createFailureDiagnostic({
    sourceMode: state.sourceMode,
    sourceValue: currentSourceValue(),
    gitRef: state.githubRef.trim(),
    packs,
    options,
    elapsedMs: performance.now() - startedAt,
    engineVersion: state.engine?.version,
    error: message,
  });
  const entries = appendDiagnostic(window.localStorage, entry);
  renderDiagnostics(entry, entries.length);
}

function evidenceSources(report) {
  if (Array.isArray(report.project?.evidenceSources) && report.project.evidenceSources.length > 0) {
    return report.project.evidenceSources;
  }
  return report.project?.snapshot?.source ? [report.project.snapshot.source] : [];
}

function sourceMetaLabel(source) {
  const labels = {
    local: "local source",
    github: "GitHub source",
    upload: "exported source",
    url: "live deployment",
    postgres: "Postgres metadata",
    supabase: "Supabase metadata",
    neon: "Neon metadata",
  };
  return labels[source?.provider] || source?.type || "project evidence";
}

function renderReport(report, options) {
  state.report = report;
  renderSummary(elements.summaryGrid, report);
  renderCoverage(elements.coverageGrid, report.coverage);
  renderObservations(elements.observationsPanel, elements.observationsList, report.observations);
  renderSuppressions(elements.suppressionsPanel, elements.suppressionsList, report.suppressedFindings);
  renderGaps(elements.unverifiedPanel, elements.unverifiedList, report.gaps);

  const generated = new Date(report.generatedAt);
  const when = Number.isNaN(generated.getTime())
    ? "just now"
    : generated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sources = evidenceSources(report);
  const sourceLabel = sources.length > 1
    ? `${sources.length} evidence sources (${sources.map(sourceMetaLabel).join(" + ")})`
    : sources.length === 1
      ? sourceMetaLabel(sources[0])
      : "project evidence";
  const fileLabel = report.project.fileCount > 0
    ? `${report.project.fileCount.toLocaleString("en-GB")} files`
    : "no source files supplied";
  const notAssessed = report.checks.filter((check) => check.status === "not-assessed").length;
  const inventory = report.project.inventorySource === "git-tracked" ? "Git tracked" : "filesystem/runtime";
  const semgrepMode = options.localSemgrepScan ? "Semgrep local" : "Semgrep off";
  const dependencyMode = options.networkedDependencyScan ? "OSV network check" : "OSV off";
  const databaseMode = options.databaseInspection ? `${options.databasePlatform} metadata` : "database live check off";
  elements.scanMeta.textContent = `${sourceLabel} · ${fileLabel} · ${report.checks.length} checks · ${report.suppressedFindings.length} suppressed · ${report.observations.length} observed · ${report.gaps.length} unverified · ${notAssessed} not assessed · ${databaseMode} · ${semgrepMode} · ${dependencyMode} · ${inventory} · ${when}`;

  elements.emptyCopy.textContent = report.findings.length === 0
    ? report.suppressedFindings.length > 0
      ? `No active findings in assessed areas. ${report.suppressedFindings.length} finding${report.suppressedFindings.length === 1 ? " is" : "s are"} explicitly accepted in .ship-check.json; review the rationale and rule version above.`
      : report.gaps.length > 0 || notAssessed > 0
        ? `No confirmed findings in assessed areas. ${report.gaps.length} control${report.gaps.length === 1 ? " still needs" : "s still need"} verification and ${notAssessed} check${notAssessed === 1 ? " was" : "s were"} not assessed with the available evidence.`
        : report.observations.length > 0
          ? `No confirmed findings in assessed areas. Ship Check recorded ${report.observations.length} project observation${report.observations.length === 1 ? "" : "s"}; check those and the coverage before treating the project as clean.`
          : "No confirmed findings in assessed areas. Check the coverage above before treating the project as clean."
    : "No findings match this severity filter.";

  renderFindings(elements.findingsList, elements.emptyState, report.findings, state.severityFilter, report.checks);
  elements.results.hidden = false;
}

async function refreshEngineStatus() {
  setEnginePill(elements.enginePill, elements.engineLabel, null);
  try {
    state.engine = await desktopBridge.engineStatus();
    setEnginePill(elements.enginePill, elements.engineLabel, state.engine);
    if (!state.engine.available) {
      showError(state.engine.message);
    }
  } catch (error) {
    state.engine = { available: false, message: String(error) };
    setEnginePill(elements.enginePill, elements.engineLabel, state.engine);
    showError(error instanceof Error ? error.message : String(error));
  }
  updateRunAvailability();
}

async function chooseProject() {
  clearError();
  try {
    const selected = await desktopBridge.chooseProject();
    if (selected) setProjectPath(selected);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function chooseArchive() {
  clearError();
  try {
    const selected = await desktopBridge.chooseProjectArchive();
    if (selected) setArchivePath(selected);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function runScan() {
  if (!sourceReady() || !state.engine?.available || state.scanning) return;
  const packs = selectedPacks();
  if (packs.length === 0) {
    showError("Choose at least one check pack.");
    return;
  }

  const options = scanOptions();
  if (options.databaseInspection && !productionReadySelected()) {
    showError("Database metadata inspection requires the Production Ready area.");
    return;
  }
  const databaseConnectionString = options.databaseInspection
    ? elements.databaseConnectionString.value.trim()
    : "";
  if (options.databaseInspection && !databaseConnectionString) {
    showError("Enter a PostgreSQL connection URL for this database inspection.");
    return;
  }

  const startedAt = performance.now();
  clearError();
  setScanning(true);
  try {
    let rawReport;
    if (state.sourceMode === "github") {
      rawReport = await desktopBridge.scanGithubRepository(
        state.githubRepository.trim(),
        state.githubRef.trim(),
        packs,
        options,
        databaseConnectionString,
      );
    } else {
      rawReport = await desktopBridge.scanProject(
        currentSourceValue(),
        packs,
        options,
        databaseConnectionString,
      );
    }
    const report = assertScanReport(rawReport);
    state.severityFilter = "all";
    for (const button of elements.severityFilters.querySelectorAll("[data-severity]")) {
      button.classList.toggle("is-active", button.dataset.severity === "all");
    }
    renderReport(report, options);
    await recordSuccess(report, packs, options, startedAt);
    elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    recordFailure(error, packs, options, startedAt);
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (options.databaseInspection) elements.databaseConnectionString.value = "";
    setScanning(false);
    updateRunAvailability();
  }
}

elements.sourceSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-source]");
  if (!button || state.scanning) return;
  setSourceMode(button.dataset.source);
});

elements.githubRepository.addEventListener("input", (event) => {
  state.githubRepository = event.target.value;
  updateRunAvailability();
});

elements.githubRef.addEventListener("input", (event) => {
  state.githubRef = event.target.value;
});

elements.runtimeUrl.addEventListener("input", (event) => {
  state.runtimeUrl = event.target.value;
  updateRunAvailability();
});

elements.deploymentUrl.addEventListener("input", (event) => {
  state.deploymentUrl = event.target.value;
});

elements.inspectDatabase.addEventListener("change", () => {
  if (!elements.inspectDatabase.checked) elements.databaseConnectionString.value = "";
  updateDatabaseAvailability();
  updateSourceGuidance();
  updateRunAvailability();
  if (elements.inspectDatabase.checked) elements.databaseConnectionString.focus();
});

elements.databaseConnectionString.addEventListener("input", updateRunAvailability);
elements.databaseTableLimit.addEventListener("input", updateRunAvailability);

for (const input of [elements.githubRepository, elements.githubRef, elements.runtimeUrl, elements.deploymentUrl, elements.databaseConnectionString]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !elements.runScan.disabled) runScan();
  });
}

elements.chooseProject.addEventListener("click", chooseProject);
elements.chooseArchive.addEventListener("click", chooseArchive);
elements.runScan.addEventListener("click", runScan);
elements.rerunScan.addEventListener("click", runScan);
elements.packGrid.addEventListener("change", () => {
  updateDeepScanAvailability();
  updateDatabaseAvailability();
  updateSourceGuidance();
  updateRunAvailability();
});

elements.severityFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-severity]");
  if (!button || !state.report) return;
  state.severityFilter = button.dataset.severity;
  for (const candidate of elements.severityFilters.querySelectorAll("[data-severity]")) {
    candidate.classList.toggle("is-active", candidate === button);
  }
  renderFindings(
    elements.findingsList,
    elements.emptyState,
    state.report.findings,
    state.severityFilter,
    state.report.checks,
  );
});

setProjectPath("");
setArchivePath("");
setSourceMode("local");
updateDeepScanAvailability();
updateDatabaseAvailability();
restoreDiagnostics();
refreshEngineStatus();
