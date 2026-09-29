const severityRank = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function assertEstateReport(report) {
  const valid =
    report &&
    report.schemaVersion === "0.1" &&
    report.type === "ship-check-estate-report" &&
    report.tool?.name === "ship-check" &&
    Number.isInteger(report.projectCount) &&
    Number.isInteger(report.scannedCount) &&
    Number.isInteger(report.failedCount) &&
    report.summary &&
    Array.isArray(report.projects);

  if (!valid) {
    throw new Error(
      "The local engine returned an unexpected estate report. Update the desktop app and engine together.",
    );
  }
  return report;
}

export function estateProjectBuckets(estate) {
  const failed = [];
  const attention = [];
  const quiet = [];

  for (const project of estate.projects) {
    if (project.status === "failed") {
      failed.push(project);
      continue;
    }
    const report = project.report;
    const hasCheckError = report.checks.some((check) => check.status === "error");
    if (report.findings.length > 0 || report.gaps.length > 0 || hasCheckError) {
      attention.push(project);
    } else {
      quiet.push(project);
    }
  }

  return { failed, attention, quiet };
}

function highestSeverity(findings = []) {
  return findings.reduce(
    (current, finding) =>
      severityRank[finding.severity] > severityRank[current] ? finding.severity : current,
    "info",
  );
}

function metricCard(value, label) {
  const card = element("div", "summary-card");
  card.append(element("strong", "summary-number", value));
  card.append(element("span", "summary-label", label));
  return card;
}

function projectCard(project) {
  const report = project.report;
  const article = element("article", "estate-project-card");
  const heading = element("div", "estate-project-heading");
  const titleWrap = element("div");
  titleWrap.append(element("h3", "", project.relativePath));

  const declared = [
    report.project?.context?.status ? `status: ${report.project.context.status}` : "",
    report.project?.context?.ownership ? `ownership: ${report.project.context.ownership}` : "",
  ].filter(Boolean);
  if (declared.length) {
    titleWrap.append(element("p", "estate-project-context", `Declared context · ${declared.join(" · ")}`));
  }

  const badges = element("div", "finding-badges");
  if (report.findings.length > 0) {
    const severity = highestSeverity(report.findings);
    badges.append(
      element(
        "span",
        `severity-badge severity-${severity}`,
        `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}`,
      ),
    );
  }
  if (report.gaps.length > 0) {
    badges.append(element("span", "gap-badge", `${report.gaps.length} to verify`));
  }
  const errors = report.checks.filter((check) => check.status === "error").length;
  if (errors > 0) {
    badges.append(element("span", "estate-error-badge", `${errors} check error${errors === 1 ? "" : "s"}`));
  }
  heading.append(titleWrap, badges);
  article.append(heading);

  const details = element("details", "review-technical estate-project-details");
  details.append(element("summary", "", "Review project attention"));

  const findings = [...report.findings].sort(
    (left, right) =>
      severityRank[right.severity] - severityRank[left.severity] ||
      left.title.localeCompare(right.title),
  );
  for (const finding of findings) {
    const row = element("div", "estate-attention-row");
    row.append(
      element("span", `severity-badge severity-${finding.severity}`, finding.severity),
      element("strong", "", finding.title),
      element("p", "", finding.summary),
      element("small", "", `Fix · ${finding.remediation.fix}`),
      element("small", "", `Verify · ${finding.remediation.verify}`),
    );
    details.append(row);
  }

  for (const gap of report.gaps) {
    const row = element("div", "estate-attention-row estate-verify-row");
    row.append(
      element("span", "gap-badge", "Verify"),
      element("strong", "", gap.title),
      element("p", "", gap.summary),
      element("small", "", gap.verify),
    );
    details.append(row);
  }

  for (const check of report.checks.filter((item) => item.status === "error")) {
    const row = element("div", "estate-attention-row estate-error-row");
    row.append(
      element("span", "estate-error-badge", "Check error"),
      element("strong", "", check.title || check.checkId),
      element("p", "", check.error || "This check did not complete."),
    );
    details.append(row);
  }

  article.append(details);
  return article;
}

export function renderEstateReport({ estate, summaryContainer, projectsContainer, metaElement }) {
  assertEstateReport(estate);
  const buckets = estateProjectBuckets(estate);

  summaryContainer.replaceChildren(
    metricCard(estate.projectCount, "projects discovered"),
    metricCard(estate.summary.findings, "confirmed findings"),
    metricCard(estate.summary.unverified, "unanswered controls"),
    metricCard(estate.summary.scannerUnavailable, "scanner gaps"),
    metricCard(estate.failedCount, "failed scans"),
  );

  metaElement.textContent =
    `${estate.scannedCount} of ${estate.projectCount} projects scanned · ` +
    `${buckets.attention.length} needing attention · ${buckets.quiet.length} quiet scans · no estate score`;

  projectsContainer.replaceChildren();

  if (buckets.failed.length > 0) {
    const section = element("section", "estate-group");
    section.append(
      element("h3", "", "Scans that did not complete"),
      element("p", "source-help", "These projects were discovered but did not produce a report. Their affected areas remain unassessed."),
    );
    for (const project of buckets.failed) {
      const row = element("article", "estate-project-card estate-failed-card");
      row.append(element("h4", "", project.relativePath), element("p", "", project.error));
      section.append(row);
    }
    projectsContainer.append(section);
  }

  const attentionSection = element("section", "estate-group");
  attentionSection.append(
    element("h3", "", "Projects needing attention"),
    element("p", "source-help", "Confirmed findings, unanswered controls and check failures stay distinct. Project order is not a safety ranking."),
  );
  if (buckets.attention.length === 0) {
    attentionSection.append(
      element("p", "estate-quiet-note", "No confirmed findings, unanswered controls or check errors were reported in the areas assessed."),
    );
  } else {
    for (const project of buckets.attention) attentionSection.append(projectCard(project));
  }
  projectsContainer.append(attentionSection);

  if (buckets.quiet.length > 0) {
    const quiet = element("details", "estate-group estate-quiet-group");
    quiet.append(
      element("summary", "", `${buckets.quiet.length} quiet scan${buckets.quiet.length === 1 ? "" : "s"}`),
      element("p", "source-help", "Quiet means no confirmed findings or unanswered controls in the areas checked. It does not mean the project is safe or fully assessed."),
    );
    const list = element("ul", "estate-quiet-list");
    for (const project of buckets.quiet) list.append(element("li", "", project.relativePath));
    quiet.append(list);
    projectsContainer.append(quiet);
  }
}
