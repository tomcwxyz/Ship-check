import { desktopBridge } from "./bridge.js";
import { renderFindings, renderSummary, setEnginePill } from "./components.js";
import {
  appendDiagnostic,
  clearDiagnostics,
  createFailureDiagnostic,
  createSuccessDiagnostic,
  formatDiagnostics,
  formatReceipt,
  readDiagnostics,
} from "./diagnostics.js";

const state = {
  sourceMode: "local",
  projectPath: "",
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
  githubRepository: document.querySelector("#github-repository"),
  githubRef: document.querySelector("#github-ref"),
  chooseProject: document.querySelector("#choose-project"),
  projectPath: document.querySelector("#project-path"),
  projectPathValue: document.querySelector("#project-path-value"),
  packGrid: document.querySelector("#pack-grid"),
  runScan: document.querySelector("#run-scan"),
  rerunScan: document.querySelector("#rerun-scan"),
  errorBanner: document.querySelector("#error-banner"),
  results: document.querySelector("#results"),
  summaryGrid: document.querySelector("#summary-grid"),
  scanMeta: document.querySelector("#scan-meta"),
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
  return Boolean(state.projectPath);
}

function currentSourceValue() {
  return state.sourceMode === "github" ? state.githubRepository.trim() : state.projectPath;
}

function updateRunAvailability() {
  const ready =
    sourceReady() &&
    Boolean(state.engine?.available) &&
    selectedPacks().length > 0 &&
    !state.scanning;
  elements.runScan.disabled = !ready;
  elements.rerunScan.disabled = state.scanning || !ready;
}

function setScanning(scanning) {
  state.scanning = scanning;
  elements.runScan.textContent = scanning
    ? state.sourceMode === "github"
      ? "Checking out & scanning…"
      : "Checking…"
    : "Check this repo";
  elements.chooseProject.disabled = scanning;
  elements.githubRepository.disabled = scanning;
  elements.githubRef.disabled = scanning;
  for (const button of elements.sourceSwitch.querySelectorAll("[data-source]")) {
    button.disabled = scanning;
  }
  for (const checkbox of elements.packGrid.querySelectorAll('input[type="checkbox"]')) {
    checkbox.disabled = scanning;
  }
  updateRunAvailability();
}

function setProjectPath(projectPath) {
  state.projectPath = projectPath || "";
  elements.projectPath.dataset.empty = state.projectPath ? "false" : "true";
  elements.projectPathValue.textContent = state.projectPath || "No folder chosen yet";
  elements.projectPathValue.title = state.projectPath;
  updateRunAvailability();
}

function setSourceMode(mode) {
  if (mode !== "local" && mode !== "github") return;
  state.sourceMode = mode;
  elements.localSource.hidden = mode !== "local";
  elements.githubSource.hidden = mode !== "github";
  for (const button of elements.sourceSwitch.querySelectorAll("[data-source]")) {
    button.classList.toggle("is-active", button.dataset.source === mode);
  }
  clearError();
  updateRunAvailability();
  if (mode === "github") elements.githubRepository.focus();
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
  copy.textContent = "Stored locally for alpha testing. Includes repo label, engine version, inventory source, timings and check outcomes — never source contents, evidence excerpts or matched secret values.";
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
  });
}

function renderDiagnostics(entry, count) {
  ensureDiagnosticsPanel();
  elements.diagnosticsPanel.hidden = count === 0 && !entry;
  elements.diagnosticsSummary.textContent = `Scan receipt & diagnostics · ${count} stored`;
  elements.scanReceipt.textContent = formatReceipt(entry);
}

function restoreDiagnostics() {
  const entries = readDiagnostics(window.localStorage);
  renderDiagnostics(entries.at(-1) ?? null, entries.length);
}

function recordSuccess(report, packs, startedAt) {
  const entry = createSuccessDiagnostic({
    report,
    sourceMode: state.sourceMode,
    sourceValue: currentSourceValue(),
    gitRef: state.githubRef.trim(),
    packs,
    elapsedMs: performance.now() - startedAt,
  });
  const entries = appendDiagnostic(window.localStorage, entry);
  renderDiagnostics(entry, entries.length);
}

function recordFailure(error, packs, startedAt) {
  const message = error instanceof Error ? error.message : String(error);
  const entry = createFailureDiagnostic({
    sourceMode: state.sourceMode,
    sourceValue: currentSourceValue(),
    gitRef: state.githubRef.trim(),
    packs,
    elapsedMs: performance.now() - startedAt,
    engineVersion: state.engine?.version,
    error: message,
  });
  const entries = appendDiagnostic(window.localStorage, entry);
  renderDiagnostics(entry, entries.length);
}

function renderReport(report) {
  state.report = report;
  renderSummary(elements.summaryGrid, report);

  const generated = new Date(report.generatedAt);
  const when = Number.isNaN(generated.getTime())
    ? "just now"
    : generated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const source = state.sourceMode === "github" ? "GitHub repo" : "local repo";
  const inventory = report.project.inventorySource === "git-tracked" ? "Git tracked" : "filesystem";
  elements.scanMeta.textContent = `${source} · ${report.project.fileCount.toLocaleString("en-GB")} files · ${report.checks.length} checks · ${inventory} · ${when}`;

  elements.emptyCopy.textContent = report.findings.length === 0
    ? "The selected checks did not surface any findings. This is not a security or compliance certification."
    : "No findings match this severity filter.";

  renderFindings(elements.findingsList, elements.emptyState, report.findings, state.severityFilter);
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

async function runScan() {
  if (!sourceReady() || !state.engine?.available || state.scanning) return;
  const packs = selectedPacks();
  if (packs.length === 0) {
    showError("Choose at least one check pack.");
    return;
  }

  const startedAt = performance.now();
  clearError();
  setScanning(true);
  try {
    const rawReport = state.sourceMode === "github"
      ? await desktopBridge.scanGithubRepository(
          state.githubRepository.trim(),
          state.githubRef.trim(),
          packs,
        )
      : await desktopBridge.scanProject(state.projectPath, packs);
    const report = assertScanReport(rawReport);
    state.severityFilter = "all";
    for (const button of elements.severityFilters.querySelectorAll("[data-severity]")) {
      button.classList.toggle("is-active", button.dataset.severity === "all");
    }
    renderReport(report);
    recordSuccess(report, packs, startedAt);
    elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    recordFailure(error, packs, startedAt);
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setScanning(false);
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

elements.githubRepository.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !elements.runScan.disabled) runScan();
});

elements.githubRef.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !elements.runScan.disabled) runScan();
});

elements.chooseProject.addEventListener("click", chooseProject);
elements.runScan.addEventListener("click", runScan);
elements.rerunScan.addEventListener("click", runScan);
elements.packGrid.addEventListener("change", updateRunAvailability);

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
  );
});

setProjectPath("");
setSourceMode("local");
restoreDiagnostics();
refreshEngineStatus();
