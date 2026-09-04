import { desktopBridge } from "./bridge.js";
import { renderFindings, renderSummary, setEnginePill } from "./components.js";

const state = {
  projectPath: "",
  engine: null,
  report: null,
  scanning: false,
  severityFilter: "all",
};

const elements = {
  enginePill: document.querySelector("#engine-pill"),
  engineLabel: document.querySelector("#engine-label"),
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

function updateRunAvailability() {
  const ready =
    Boolean(state.projectPath) &&
    Boolean(state.engine?.available) &&
    selectedPacks().length > 0 &&
    !state.scanning;
  elements.runScan.disabled = !ready;
  elements.rerunScan.disabled = state.scanning || !ready;
}

function setScanning(scanning) {
  state.scanning = scanning;
  elements.runScan.textContent = scanning ? "Checking…" : "Run Ship Check";
  elements.chooseProject.disabled = scanning;
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

function assertScanReport(report) {
  const valid =
    report &&
    report.schemaVersion === "0.1" &&
    report.tool?.name === "ship-check" &&
    report.project &&
    Array.isArray(report.checks) &&
    Array.isArray(report.findings) &&
    report.summary;
  if (!valid) {
    throw new Error("The local engine returned an unexpected report. Update the desktop app and engine together.");
  }
  return report;
}

function renderReport(report) {
  state.report = report;
  renderSummary(elements.summaryGrid, report);

  const generated = new Date(report.generatedAt);
  const when = Number.isNaN(generated.getTime())
    ? "just now"
    : generated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  elements.scanMeta.textContent = `${report.project.fileCount.toLocaleString("en-GB")} files · ${report.checks.length} checks · ${when}`;

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
  if (!state.projectPath || !state.engine?.available || state.scanning) return;
  const packs = selectedPacks();
  if (packs.length === 0) {
    showError("Choose at least one check pack.");
    return;
  }

  clearError();
  setScanning(true);
  try {
    const report = assertScanReport(await desktopBridge.scanProject(state.projectPath, packs));
    state.severityFilter = "all";
    for (const button of elements.severityFilters.querySelectorAll("[data-severity]")) {
      button.classList.toggle("is-active", button.dataset.severity === "all");
    }
    renderReport(report);
    elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setScanning(false);
  }
}

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
refreshEngineStatus();
