import { reviewFinding } from "./review.js";

const names = {
  secrets: "Keys and passwords",
  "access-control": "Access",
  configuration: "Configuration",
  "supply-chain": "Dependencies",
  cost: "Running costs",
  "code-security": "Code",
  database: "Database",
  runtime: "Live app",
};

const stateNames = {
  assessed: "Checks completed",
  partial: "Partly checked",
  "not-assessed": "Not checked",
};

const severityRank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function summariseReview(report) {
  const findings = report.findings ?? [];
  const checks = report.checks ?? [];
  const gaps = report.gaps ?? [];
  const coverage = report.coverage ?? [];
  const errors = checks.filter((check) => check.status === "error");
  const notChecked = coverage.filter((area) => area.status === "not-assessed");
  const partiallyChecked = coverage.filter((area) => area.status === "partial");
  const completed = coverage.filter((area) => area.status === "assessed");
  const priority = [...findings].sort((a, b) =>
    (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0)
  )[0];

  let next;
  if (priority) {
    const guidance = reviewFinding(priority);
    next = { label: "Start here · Finding", title: guidance.title, explanation: guidance.next, target: "review-findings" };
  } else if (errors.length > 0) {
    next = { label: "Start here · Incomplete check", title: "A check did not finish", explanation: "Find out why this check failed, then run it again. Its result is unknown, not clear.", target: "review-checks" };
  } else if (gaps.length > 0) {
    next = { label: "Start here · Question", title: gaps[0].title, explanation: gaps[0].verify, target: "review-questions" };
  } else if (notChecked.length > 0) {
    next = { label: "Start here · Scope", title: "Decide whether more evidence is needed", explanation: "Review the areas Ship Check could not assess with the sources provided.", target: "review-coverage" };
  } else {
    next = { label: "Next step", title: "Review what this scan actually covered", explanation: "No active concerns were reported in the checked areas. This is not a guarantee that the application is safe.", target: "review-coverage" };
  }

  const headline = findings.length > 0
    ? "There are things to look at"
    : errors.length > 0
      ? "Part of this review could not finish"
      : gaps.length > 0
        ? "Nothing confirmed, but questions remain"
        : "No findings in the areas checked";

  return { findings, gaps, errors, coverage, notChecked, partiallyChecked, completed, headline, next };
}

function metric(value, title, explanation, tone, target, onOpen) {
  const button = el("button", "review-metric review-metric-" + tone);
  button.type = "button";
  button.setAttribute("aria-label", title + ": " + value + ". " + explanation);
  button.append(
    el("strong", "review-metric-value", value),
    el("span", "review-metric-title", title),
    el("small", "review-metric-explanation", explanation),
  );
  button.addEventListener("click", () => onOpen(target));
  return button;
}

export function renderReviewOverview(container, report, onOpen = () => {}) {
  const view = summariseReview(report);
  container.replaceChildren();

  const head = el("div", "review-overview-heading");
  head.append(
    el("p", "section-kicker", "Your review · At a glance"),
    el("h3", "", view.headline),
    el("p", "review-overview-intro",
      "Three separate answers: what needs attention, what needs verifying and what this scan could not check. No safety score."),
  );

  const metrics = el("div", "review-metrics");
  metrics.append(
    metric(view.findings.length, "Needs attention", "Findings supported by this scan", "attention", "review-findings", onOpen),
    metric(view.gaps.length + view.errors.length, "Needs verifying",
      view.errors.length ? view.gaps.length + " questions · " + view.errors.length + " failed checks" : "Unanswered questions", "question", view.errors.length ? "review-checks" : "review-questions", onOpen),
    metric(view.notChecked.length, "Not checked", "Areas without assessment", "missing", "review-coverage", onOpen),
  );

  const next = el("div", "review-next");
  const nextCopy = el("div", "");
  nextCopy.append(
    el("p", "section-kicker", view.next.label),
    el("h4", "", view.next.title),
    el("p", "", view.next.explanation),
  );
  const nextButton = el("button", "button button-primary", "See what to do");
  nextButton.type = "button";
  nextButton.addEventListener("click", () => onOpen(view.next.target));
  next.append(nextCopy, nextButton);

  const scope = el("section", "review-scope");
  const heading = el("div", "review-scope-heading");
  heading.append(
    el("h4", "", "What was covered"),
    el("p", "", view.completed.length + " completed · " + view.partiallyChecked.length +
      " partly checked · " + view.notChecked.length + " not checked"),
  );
  scope.append(heading);

  const strip = el("div", "review-scope-strip");
  for (const entry of view.coverage) {
    const tile = el("div", "review-scope-tile");
    tile.dataset.status = entry.status;
    tile.setAttribute("aria-label", (names[entry.area] ?? entry.area) + ": " + (stateNames[entry.status] ?? entry.status));
    tile.append(
      el("span", "review-scope-symbol", entry.status === "assessed" ? "●" : entry.status === "partial" ? "◐" : "○"),
      el("span", "review-scope-name", names[entry.area] ?? entry.area),
      el("small", "review-scope-status", stateNames[entry.status] ?? entry.status),
    );
    strip.append(tile);
  }
  scope.append(strip);
  const scopeButton = el("button", "review-text-action", "Understand what was and wasn't checked →");
  scopeButton.type = "button";
  scopeButton.addEventListener("click", () => onOpen("review-coverage"));
  scope.append(scopeButton);

  container.append(head, metrics, next, scope);
}
