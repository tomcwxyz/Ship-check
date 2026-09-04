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
  const items = [
    ["Findings", report.summary.total],
    ["Critical", report.summary.critical],
    ["High", report.summary.high],
    ["Checks run", report.checks.length],
  ];

  for (const [label, value] of items) {
    const card = element("div", "summary-card");
    card.append(element("span", "summary-number", value));
    card.append(element("span", "summary-label", label));
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

export function createFindingCard(finding) {
  const article = element("article", "finding-card");
  article.dataset.severity = finding.severity;

  const heading = element("div", "finding-heading");
  const headingCopy = element("div", "finding-heading-copy");
  const badges = element("div", "finding-badges");
  badges.append(element("span", `severity-badge severity-${finding.severity}`, finding.severity));
  badges.append(element("span", "pack-badge", packNames[finding.pack] || finding.pack));
  badges.append(element("span", "confidence-badge", `${finding.confidence} confidence`));
  headingCopy.append(badges);
  headingCopy.append(element("h3", "finding-title", finding.title));
  headingCopy.append(element("p", "finding-summary", finding.summary));
  heading.append(headingCopy);
  article.append(heading);

  const evidenceSection = element("section", "finding-section");
  evidenceSection.append(element("h4", "finding-section-title", "Evidence"));
  const evidenceList = element("ul", "evidence-list");
  for (const evidence of finding.evidence || []) {
    evidenceList.append(evidenceItem(evidence));
  }
  evidenceSection.append(evidenceList);
  article.append(evidenceSection);

  const remediation = element("section", "finding-section remediation-grid");
  remediation.append(labelledValue("Why it matters", finding.remediation.why, "remediation-item"));
  remediation.append(labelledValue("Fix", finding.remediation.fix, "remediation-item"));
  remediation.append(labelledValue("Verify", finding.remediation.verify, "remediation-item"));
  article.append(remediation);

  const prompt = element("div", "agent-prompt");
  const promptCopy = element("div", "agent-prompt-copy");
  promptCopy.append(element("span", "agent-prompt-label", "Repair prompt"));
  promptCopy.append(element("p", "agent-prompt-text", finding.remediation.agentPrompt));
  const copyButton = element("button", "button button-quiet", "Copy prompt");
  copyButton.type = "button";
  copyButton.addEventListener("click", () => copyPrompt(copyButton, finding.remediation.agentPrompt));
  prompt.append(promptCopy, copyButton);
  article.append(prompt);

  return article;
}

export function renderFindings(container, emptyState, findings, severityFilter) {
  container.replaceChildren();
  const visible = findings
    .filter((finding) => severityFilter === "all" || finding.severity === severityFilter)
    .sort((left, right) => {
      const severityDifference = severityOrder[right.severity] - severityOrder[left.severity];
      if (severityDifference !== 0) return severityDifference;
      return left.title.localeCompare(right.title);
    });

  emptyState.hidden = visible.length !== 0;
  for (const finding of visible) {
    container.append(createFindingCard(finding));
  }
}
