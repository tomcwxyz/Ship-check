import { reviewFinding, reviewSummary } from "./review.js";
export const severityOrder = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const packNames = {
  "secure-build": "Secure Build",
  "production-ready": "Production Ready",
  "cost-aware": "Cost Aware",
};

const areaNames = {
  secrets: "Access keys and passwords",
  "access-control": "Who can use the app",
  configuration: "Configuration",
  "supply-chain": "Software packages",
  cost: "Cost",
  "code-security": "Code security",
  database: "Database",
  runtime: "The running app",
};

const coverageNames = {
  assessed: "Checks completed",
  partial: "Limited checks",
  "not-assessed": "Not checked",
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function labelledValue(label, value, className = "") {
  const wrapper = element("div", `labelled-value ${className}`.trim());
  wrapper.append(element("span", "labelled-value-label", label));
  wrapper.append(element("strong", "labelled-value-value", value));
  return wrapper;
}

export function setEnginePill(pill, label, status) {
  const state = status?.available ? "ready" : status ? "missing" : "checking";
  pill.dataset.state = state;
  if (!status) {
    label.textContent = "Checking local engine…";
    pill.title = "";
    return;
  }
  if (status.available) {
    label.textContent = status.version ? `Engine ${status.version}` : "Local engine ready";
  } else {
    label.textContent = "Engine unavailable";
  }
  pill.title = status.message || "";
}

export function renderSummary(container, report) {
  container.replaceChildren();
  const summary = reviewSummary(report);
  const card = element("div", "review-overview");
  card.append(element("h3", "", summary.title));
  card.append(element("p", "", summary.detail));
  if (summary.optional) card.append(element("p", "", summary.optional));
  if (report.summary.suppressed) card.append(element("p", "", `${report.summary.suppressed} accepted exceptions remain in this project.`));
  if (report.resolvedGaps?.length) {
    card.append(element(
      "p",
      "",
      `${report.resolvedGaps.length} previously unanswered question${report.resolvedGaps.length === 1 ? " was" : "s were"} established by another evidence source in this review.`,
    ));
  }
  const details = element("details", "review-technical");
  details.append(element("summary", "", "See individual checks"));
  const labels = {
    passed: "Nothing found by this check",
    "not-applicable": "Does not apply",
    findings: "Needs review",
    unverified: "Could not verify",
    resolved: "Established by other evidence",
    error: "Could not complete",
    suppressed: "Accepted exception",
    "not-assessed": "Not assessed with this evidence",
  };
  for (const check of report.checks) details.append(element("p", "", `${check.checkId}: ${labels[check.status] ?? check.status}`));
  card.append(details);
  container.append(card);
}

export function renderCoverage(container, coverage = []) {
  container.replaceChildren();
  for (const entry of coverage) {
    const card = element("div", "coverage-item");
    card.dataset.status = entry.status;
    const heading = element("div", "coverage-item-heading");
    heading.append(element("strong", "coverage-area", areaNames[entry.area] || entry.area));
    heading.append(element("span", `coverage-status coverage-${entry.status}`, coverageNames[entry.status] || entry.status));
    card.append(heading);
    card.append(element("p", "coverage-detail", entry.status === "not-assessed" ? "This scan did not check this area." : entry.status === "partial" ? "Only a limited part of this area was checked." : "Selected checks completed. This does not verify the whole area."));
    container.append(card);
  }
}

function evidenceItem(evidence) {
  const item = element("li", "evidence-item");
  const location = evidence.path
    ? `${evidence.path}${evidence.line ? `:${evidence.line}` : ""}`
    : evidence.kind || "Repository evidence";
  item.append(element("div", "evidence-location", location));
  item.append(element("p", "evidence-detail", evidence.detail));
  if (evidence.excerpt) {
    item.append(element("code", "evidence-excerpt", evidence.excerpt));
  }
  return item;
}

export function renderObservations(panel, container, observations = []) {
  container.replaceChildren();
  panel.hidden = observations.length === 0;
  for (const observation of observations) {
    const article = element("article", "observation-card");
    const badges = element("div", "finding-badges");
    badges.append(element("span", "observation-badge", observation.kind === "verified-control" ? "Verified" : "Observed"));
    if (observation.resolvesCheckIds?.length) {
      badges.append(element(
        "span",
        "observation-badge",
        observation.resolvesCheckIds.length === 1 ? "Answers source question" : `Answers ${observation.resolvesCheckIds.length} source questions`,
      ));
    }
    badges.append(element("span", "pack-badge", packNames[observation.pack] || observation.pack));
    badges.append(element("span", "confidence-badge", areaNames[observation.area] || observation.area));
    article.append(badges);
    article.append(element("h4", "gap-title", observation.title));
    article.append(element("p", "gap-summary", observation.summary));

    const evidenceList = element("ul", "evidence-list observation-evidence");
    for (const evidence of observation.evidence || []) evidenceList.append(evidenceItem(evidence));
    const details = element("details", "review-technical");
    details.append(element("summary", "", "Show technical evidence"), evidenceList);
    if (observation.resolvesCheckIds?.length) {
      details.append(labelledValue(
        "Source question established",
        observation.resolvesCheckIds.join(", "),
        "gap-verify",
      ));
    }
    article.append(details);
    container.append(article);
  }
}

export function renderSuppressions(panel, container, suppressions = []) {
  container.replaceChildren();
  panel.hidden = suppressions.length === 0;
  for (const suppression of suppressions) {
    const finding = suppression.finding;
    const article = element("article", "suppression-card");
    article.dataset.severity = finding.severity;
    const badges = element("div", "finding-badges");
    badges.append(element("span", "suppression-badge", "Accepted exception"));
    badges.append(element("span", `severity-badge severity-${finding.severity}`, finding.severity));
    badges.append(element("span", "pack-badge", packNames[finding.pack] || finding.pack));
    article.append(badges);
    article.append(element("h4", "gap-title", finding.title));
    article.append(element("p", "gap-summary", finding.summary));
    article.append(labelledValue("Finding ID", finding.id, "suppression-meta"));
    article.append(labelledValue("Rule", `${finding.checkId}@${suppression.checkVersion}`, "suppression-meta"));
    article.append(labelledValue("Accepted-risk rationale", suppression.rationale, "suppression-rationale"));
    article.append(element("p", "suppression-note", `Declared in ${suppression.configPath}. A rule-version change makes this suppression stop matching.`));
    container.append(article);
  }
}

export function renderGaps(panel, container, gaps = []) {
  container.replaceChildren();
  panel.hidden = gaps.length === 0;
  for (const gap of gaps) {
    const article = element("article", "gap-card");
    const badges = element("div", "finding-badges");
    badges.append(element("span", "gap-badge", "Needs checking"));
    badges.append(element("span", "pack-badge", packNames[gap.pack] || gap.pack));
    badges.append(element("span", "confidence-badge", areaNames[gap.area] || gap.area));
    article.append(badges);
    article.append(element("h4", "gap-title", gap.title));
    article.append(element("p", "gap-summary", gap.summary));

    const evidenceList = element("ul", "evidence-list");
    for (const evidence of gap.evidence || []) evidenceList.append(evidenceItem(evidence));
    const details = element("details", "review-technical");
    details.append(element("summary", "", "Show technical evidence"), evidenceList);
    article.append(details);
    article.append(labelledValue("How to check", gap.verify, "gap-verify"));
    const copyButton = element("button", "button button-quiet", "Copy checking instructions");
    copyButton.type = "button";
    const instructions = [gap.title, gap.summary, `Rule: ${gap.checkId}`, `Question: ${gap.id}`,
      ...gap.evidence.map(item => `${item.path ?? "Project"}${item.line ? `:${item.line}` : ""}: ${item.detail}`),
      gap.verify, "This is an unanswered question, not a confirmed defect. Verify the behaviour before making changes. Do not share access keys or personal data."
    ].join("\n\n");
    copyButton.addEventListener("click", () => copyPrompt(copyButton, instructions));
    article.append(copyButton);
    container.append(article);
  }
}

async function copyPrompt(button, text) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

export function createFindingCard(finding, checkVersion = "1") {
  const article = element("article", "finding-card");
  article.dataset.severity = finding.severity;

  const review = reviewFinding(finding);
  const heading = element("div", "finding-heading");
  const headingCopy = element("div", "finding-heading-copy");
  const badges = element("div", "finding-badges");
  badges.append(element("span", `severity-badge severity-${finding.severity}`, finding.severity));
  badges.append(element("span", "pack-badge", packNames[finding.pack] || finding.pack));
  badges.append(element("span", "confidence-badge", `${finding.confidence} confidence`));
  badges.append(element("span", "rule-badge", `${finding.checkId}@${checkVersion}`));

  headingCopy.append(element("span", "gap-badge", ["critical", "high"].includes(finding.severity) ? "Review first" : "Review when ready"));
  headingCopy.append(element("h3", "finding-title", review.title));
  headingCopy.append(element("p", "finding-summary", review.summary));

  heading.append(headingCopy);
  article.append(heading);

  const evidenceSection = element("section", "finding-section");
  evidenceSection.append(element("h4", "finding-section-title", "Evidence"));
  const evidenceList = element("ul", "evidence-list");
  for (const evidence of finding.evidence || []) {
    evidenceList.append(evidenceItem(evidence));
  }
  evidenceSection.append(evidenceList);
  const technical = element("details", "review-technical");
  technical.append(element("summary", "", "Technical evidence for your developer"));
  technical.append(badges, element("code", "finding-id", finding.id), evidenceSection);

  const remediation = element("section", "finding-section remediation-grid");
  remediation.append(labelledValue("Why it matters", review.why, "remediation-item"));
  remediation.append(labelledValue("What to do next", review.next, "remediation-item"));
  remediation.append(labelledValue("How to know it is fixed", review.verification, "remediation-item"));
  article.append(remediation, technical);

  const prompt = element("div", "agent-prompt");
  const promptCopy = element("div", "agent-prompt-copy");
  promptCopy.append(element("span", "agent-prompt-label", "Instructions for your developer or AI tool"));

  const copyButton = element("button", "button button-quiet", "Copy repair instructions");
  copyButton.type = "button";
  copyButton.addEventListener("click", () => copyPrompt(copyButton, `${review.repairInstructions}\n\nRule version: ${checkVersion}`));
  prompt.append(promptCopy, copyButton);
  article.append(prompt);

  return article;
}

export function renderFindings(container, emptyState, findings, severityFilter, checks = []) {
  container.replaceChildren();
  const versions = new Map(checks.map((check) => [check.checkId, check.checkVersion || "1"]));
  const visible = findings
    .filter((finding) => severityFilter === "all" || finding.severity === severityFilter)
    .sort((left, right) => {
      const severityDifference = severityOrder[right.severity] - severityOrder[left.severity];
      if (severityDifference !== 0) return severityDifference;
      return left.title.localeCompare(right.title);
    });

  emptyState.hidden = visible.length !== 0;
  for (const finding of visible) {
    container.append(createFindingCard(finding, versions.get(finding.checkId) || "1"));
  }
}
