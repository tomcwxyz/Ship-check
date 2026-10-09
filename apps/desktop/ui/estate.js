import { assertFocusedReview, renderFocusedReview, renderFocusedReviewError } from "./focus.js";
import { renderFindingReviewControls, renderProjectReviewHistory } from "./review-controls.js";
import { reviewsForProject } from "./finding-reviews.js";
import { reviewFinding } from "./review.js";

const severityRank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const areaLabels = {
  secrets: "Secrets", "access-control": "Access", configuration: "Config",
  "supply-chain": "Dependencies", cost: "Costs", "code-security": "Code",
  database: "Database", runtime: "Runtime",
};
const bucketLabels = {
  attention: "Findings",
  verify: "To verify",
  failed: "Failed scans",
  limited: "Limited evidence",
  quiet: "No findings in checked areas",
};
const bucketDescriptions = {
  attention: "At least one finding was reported. Findings remain visible even after a local review decision.",
  verify: "No active findings, but some controls are unanswered or a check could not complete.",
  failed: "No report was produced for these projects. They have not been assessed.",
  limited: "The scan did not establish coverage of any area. More project evidence or enabled checks are needed.",
  quiet: "No active findings in the bounded areas checked. Partial and unassessed areas remain visible on every project; this is not proof of safety.",
};

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function assertEstateReport(report) {
  if (!report || report.schemaVersion !== "0.1" ||
      report.type !== "ship-check-estate-report" || report.tool?.name !== "ship-check" ||
      !Number.isInteger(report.projectCount) || !Number.isInteger(report.scannedCount) ||
      !Number.isInteger(report.failedCount) || !report.summary || !Array.isArray(report.projects)) {
    throw new Error("The local engine returned an unexpected estate report. Update the desktop app and engine together.");
  }
  return report;
}

function checkErrors(report) {
  return (report?.checks ?? []).filter(check => check.status === "error").length;
}

function highestSeverity(findings = []) {
  return findings.reduce((highest, finding) =>
    (severityRank[finding.severity] ?? 0) > (severityRank[highest] ?? 0)
      ? finding.severity : highest, "info");
}

export function estateProjectCategory(project) {
  if (project.status === "failed" || !project.report) return "failed";
  const report = project.report;
  if ((report.findings ?? []).length) return "attention";
  if ((report.gaps ?? []).length || checkErrors(report)) return "verify";
  const coverage = report.coverage ?? [];
  // A quiet project can still have unassessed areas: "no findings in checked
  // areas" is valid when some bounded checks ran. Reserve limited for zero
  // assessable coverage, otherwise the limited bucket swallows the estate.
  if (!coverage.some(entry => entry.status === "assessed" || entry.status === "partial")) return "limited";
  return "quiet";
}

export function estateProjectBuckets(estate) {
  const buckets = { failed: [], attention: [], verify: [], limited: [], quiet: [] };
  for (const project of estate.projects) buckets[estateProjectCategory(project)].push(project);
  buckets.attention.sort((a, b) => {
    const difference = severityRank[highestSeverity(b.report.findings)] -
      severityRank[highestSeverity(a.report.findings)];
    return difference || a.relativePath.localeCompare(b.relativePath);
  });
  for (const name of ["failed", "verify", "limited", "quiet"]) {
    buckets[name].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }
  return buckets;
}

export function estateSummary(estate) {
  const buckets = estateProjectBuckets(estate);
  const unassessed = estate.projects.filter(project =>
    project.status === "failed" ||
    !(project.report?.coverage?.length) ||
    project.report.coverage.some(area => area.status !== "assessed")
  ).length;
  return {
    buckets,
    projectCount: estate.projectCount,
    scannedCount: estate.scannedCount,
    withUnassessedAreas: unassessed,
    findings: estate.projects.reduce((n, p) => n + (p.report?.findings?.length ?? 0), 0),
    unanswered: estate.projects.reduce((n, p) =>
      n + (p.report?.gaps?.length ?? 0) + checkErrors(p.report), 0),
  };
}

export function estateProjectCanFocus(project) {
  return Boolean(project?.status === "scanned" &&
    ((project.report?.findings?.length ?? 0) > 0 || (project.report?.gaps?.length ?? 0) > 0));
}

function metric(value, label, explanation, onClick) {
  const button = el("button", "estate-overview-metric");
  button.type = "button";
  button.append(el("strong", "", value), el("span", "", label), el("small", "", explanation));
  button.addEventListener("click", onClick);
  return button;
}

function coverageStrip(report) {
  const items = el("div", "estate-coverage-strip");
  items.setAttribute("aria-label", "Areas checked");
  const coverage = report.coverage ?? [];
  if (!coverage.length) {
    items.append(el("span", "estate-cover-empty", "Coverage not reported"));
    return items;
  }
  for (const item of coverage) {
    const tile = el("span", "estate-coverage-tile");
    tile.dataset.status = item.status;
    const label = areaLabels[item.area] ?? item.area;
    tile.title = label + ": " + (item.status === "assessed" ? "checks completed" :
      item.status === "partial" ? "partly assessed" : "not assessed");
    tile.setAttribute("aria-label", tile.title);
    tile.append(
      el("span", "", item.status === "assessed" ? "●" : item.status === "partial" ? "◐" : "○"),
      el("small", "", label)
    );
    items.append(tile);
  }
  return items;
}

function projectCard(project, { focusReport, projectKey, storage, onReviewsChanged }) {
  const article = el("article", "estate-project-card estate-dashboard-card");
  let updateHistory = () => {};
  article.dataset.category = estateProjectCategory(project);
  const header = el("div", "estate-dashboard-card-head");
  const title = el("div", "");
  title.append(el("h3", "", project.relativePath));
  const category = estateProjectCategory(project);
  title.append(el("p", "estate-project-context", bucketLabels[category]));
  header.append(title);
  article.append(header);

  if (project.status === "failed") {
    article.append(el("p", "estate-brief", "This project was discovered but could not be scanned."),
      el("p", "estate-error-text", project.error ?? "Unknown scan error"));
    return article;
  }

  const report = project.report;
  const findings = [...(report.findings ?? [])].sort((a,b) =>
    (severityRank[b.severity] - severityRank[a.severity]) || a.title.localeCompare(b.title));
  const gaps = report.gaps ?? [];
  const errors = (report.checks ?? []).filter(check => check.status === "error");
  const line = el("p", "estate-brief",
    findings.length ? findings.length + " findings · " + gaps.length + " questions · " + errors.length + " check errors" :
    gaps.length || errors.length ? gaps.length + " questions · " + errors.length + " check errors" :
    category === "limited" ? "No assessment coverage could be established." :
    "No active findings in checked areas." +
      ((report.coverage ?? []).some(entry => entry.status !== "assessed") ?
        " Other areas remain partly checked or not checked." : ""));
  article.append(line, coverageStrip(report));

  if (findings.length) {
    article.append(el("p", "estate-priority", "First action: " + reviewFinding(findings[0]).title));
  } else if (gaps.length) {
    article.append(el("p", "estate-priority", "First question: " + gaps[0].title));
  } else if (errors.length) {
    article.append(el("p", "estate-priority", "Next: resolve the incomplete check."));
  } else if (category === "limited") {
    article.append(el("p", "estate-priority", "Next: provide suitable evidence or enable a relevant check."));
  } else if ((report.coverage ?? []).some(entry => entry.status !== "assessed")) {
    article.append(el("p", "estate-priority", "Optional: add more evidence for areas not fully checked."));
  }

  const details = el("details", "review-technical estate-project-details");
  details.append(el("summary", "", "Review project details"));

  if (estateProjectCanFocus(project) && typeof focusReport === "function") {
    const focus = el("div", "estate-focus-actions");
    const button = el("button", "button button-quiet", "Focus next action");
    button.type = "button";
    const panel = el("section", "focus-panel estate-focus-panel");
    panel.hidden = true;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { renderFocusedReview(panel, assertFocusedReview(await focusReport(report))); }
      catch (error) { renderFocusedReviewError(panel, error); }
      finally { button.disabled = false; }
    });
    focus.append(button, panel);
    details.append(focus);
  }

  const versions = new Map((report.checks ?? []).map(c => [c.checkId, c.checkVersion ?? "1"]));
  for (const finding of findings) {
    const row = el("section", "estate-attention-row");
    row.append(
      el("span", "severity-badge severity-" + finding.severity, finding.severity),
      el("strong", "", reviewFinding(finding).title),
      el("p", "", finding.summary),
      el("small", "", "Next: " + finding.remediation.fix)
    );
    row.append(renderFindingReviewControls(finding, versions.get(finding.checkId) ?? "1", projectKey, storage, () => { updateHistory(); onReviewsChanged(); }));
    details.append(row);
  }
  for (const gap of gaps) {
    const row = el("section", "estate-attention-row estate-verify-row");
    row.append(el("strong", "", "Question: " + gap.title), el("p", "", gap.summary),
      el("small", "", "How to check: " + gap.verify));
    details.append(row);
  }
  for (const failedCheck of errors) {
    const row = el("section", "estate-attention-row estate-error-row");
    row.append(el("strong", "", "Could not complete: " + (failedCheck.title ?? failedCheck.checkId)),
      el("p", "", failedCheck.error ?? "Check did not complete."));
    details.append(row);
  }
  const history = el("div", "finding-review-history");
  const historyHeading = el("h4", "", "Saved review decisions");
  const historyPanel = el("details", "estate-review-history");
  const historyLabel = el("summary", "");
  historyPanel.append(historyLabel, history);
  updateHistory = () => {
    historyLabel.textContent = "Past decisions (" + (projectKey ? reviewsForProject(storage, projectKey).length : 0) + ")";
    renderProjectReviewHistory(history, projectKey, storage, () => {
      const wasOpen = details.open;
      const refreshed = projectCard(project, { focusReport, projectKey, storage, onReviewsChanged });
      article.replaceWith(refreshed);
      refreshed.querySelector(".estate-project-details").open = wasOpen;
      onReviewsChanged();
    });
  };
  updateHistory();
  details.append(historyPanel);
  article.append(details);
  return article;
}

export function renderEstateReport({
  estate, summaryContainer, projectsContainer, metaElement,
  focusReport, projectKeys = new Map(), storage, onReviewsChanged = () => {},
}) {
  assertEstateReport(estate);
  const summary = estateSummary(estate);
  const buckets = summary.buckets;

  summaryContainer.replaceChildren();
  const banner = el("div", "estate-overview-intro");
  banner.append(
    el("h3", "", summary.projectCount === 0 ? "No projects discovered" :
      buckets.attention.length ? buckets.attention.length + " projects have findings" :
      buckets.failed.length ? "Some projects could not be checked" :
      buckets.verify.length ? "Some projects need verifying" : "No active findings in the assessed areas"),
    el("p", "", "Browse the projects by what needs doing. Incomplete scans and unknown coverage are not treated as clean results.")
  );
  summaryContainer.append(banner);

  let selected = buckets.attention.length ? "attention" : buckets.failed.length ? "failed" :
    buckets.verify.length ? "verify" : buckets.limited.length ? "limited" : "quiet";

  const nav = el("div", "estate-dashboard-metrics");
  const descriptions = {
    attention: "Confirmed concerns", verify: "Questions or errors", failed: "No usable report",
    limited: "Scope uncertain", quiet: "Assessed areas only"
  };
  const buttons = new Map();
  const list = el("div", "estate-dashboard-list");
  const title = el("h3", "estate-dashboard-list-title");
  const explanation = el("p", "source-help");
  function choose(category) {
    selected = category;
    for (const [key, button] of buttons) {
      const active = key === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    title.textContent = bucketLabels[selected] + " (" + buckets[selected].length + ")";
    explanation.textContent = bucketDescriptions[selected];
    list.replaceChildren();
    if (!buckets[selected].length) {
      list.append(el("p", "estate-quiet-note", "No projects in this group."));
      return;
    }
    for (const project of buckets[selected]) {
      list.append(projectCard(project, {
        focusReport, projectKey: projectKeys.get(project.relativePath), storage, onReviewsChanged,
      }));
    }
  }

  for (const category of ["attention", "verify", "failed", "limited", "quiet"]) {
    const button = metric(buckets[category].length, bucketLabels[category], descriptions[category], () => choose(category));
    button.setAttribute("aria-pressed", "false");
    nav.append(button);
    buttons.set(category, button);
  }
  summaryContainer.append(nav);
  summaryContainer.append(el("p", "estate-coverage-note",
    summary.withUnassessedAreas + " of " + summary.projectCount +
    " projects have partially checked or unassessed areas, or no report. No estate-wide safety score."));

  metaElement.textContent = summary.scannedCount + " of " + summary.projectCount + " scanned · " +
    summary.findings + " findings · " + summary.unanswered + " questions or incomplete checks";

  projectsContainer.replaceChildren(title, explanation, list);
  choose(selected);
}
