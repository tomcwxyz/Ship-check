import type { AssessmentGap, ScanReport, Severity } from "@ship-check/schemas";

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

export function isUnavailableScannerGap(gap: AssessmentGap): boolean {
  return /unavailable/i.test(gap.id) ||
    /scanner.+unavailable|scanning.+unavailable/i.test(gap.title);
}

function evidenceLocation(path?: string, line?: number): string {
  if (!path) return "Project evidence";
  return `${path}${line ? `:${line}` : ""}`;
}

export function renderReportMarkdown(report: ScanReport): string {
  const checkErrors = report.checks.filter((check) => check.status === "error");
  const unavailable = report.gaps.filter(isUnavailableScannerGap);
  const unanswered = report.gaps.filter((gap) => !isUnavailableScannerGap(gap));
  const lines: string[] = [
    `# Ship Check review — ${report.project.path}`,
    "",
    `**${report.summary.total}** confirmed findings · **${unanswered.length}** unanswered controls · **${unavailable.length}** unavailable scanner checks · **${checkErrors.length}** check errors.`,
    ""
  ];

  if (report.project.context) {
    const declared = [
      report.project.context.status ? `status: ${report.project.context.status}` : "",
      report.project.context.ownership ? `ownership: ${report.project.context.ownership}` : ""
    ].filter(Boolean).join(" · ");
    lines.push(`Declared project context — ${declared}.`, "");
  }

  if (unavailable.length > 0 || checkErrors.length > 0) {
    lines.push("## Evidence that could not be collected", "");
    lines.push("Do not treat the affected areas as assessed.", "");
    for (const gap of unavailable) {
      lines.push(`- **${gap.title}** — ${gap.summary}`, `  - Resolve: ${gap.verify}`);
    }
    for (const check of checkErrors) {
      lines.push(`- **${check.checkId} could not complete** — ${check.error ?? "Unknown check error."}`);
    }
    lines.push("");
  }

  lines.push("## Confirmed findings", "");
  if (report.findings.length === 0) {
    lines.push("No active findings were reported in the areas assessed. This is not a claim that the project is safe or fully assessed.", "");
  } else {
    for (const finding of [...report.findings].sort((left, right) =>
      severityRank[right.severity] - severityRank[left.severity] ||
      left.title.localeCompare(right.title)
    )) {
      const evidence = finding.evidence[0];
      lines.push(
        `### [${finding.severity.toUpperCase()}] ${finding.title}`,
        "",
        finding.summary,
        "",
        `- Finding: \`${finding.id}\``,
        `- Rule: \`${finding.checkId}\``,
        `- Evidence: ${evidenceLocation(evidence?.path, evidence?.line)}`,
        `- Why it matters: ${finding.remediation.why}`,
        `- Fix: ${finding.remediation.fix}`,
        `- Verify: ${finding.remediation.verify}`,
        `- Agent instruction: ${finding.remediation.agentPrompt}`,
        ""
      );
    }
  }

  if (unanswered.length > 0) {
    lines.push("## Unanswered controls", "");
    lines.push("These are questions to verify, not confirmed defects.", "");
    for (const gap of unanswered) {
      const evidence = gap.evidence[0];
      lines.push(
        `### [VERIFY] ${gap.title}`,
        "",
        gap.summary,
        "",
        `- Question: \`${gap.id}\``,
        `- Rule: \`${gap.checkId}\``,
        `- Evidence: ${evidenceLocation(evidence?.path, evidence?.line)}`,
        `- Verify: ${gap.verify}`,
        ""
      );
    }
  }

  if (report.suppressedFindings.length > 0) {
    lines.push("## Accepted exceptions", "");
    for (const suppression of report.suppressedFindings) {
      lines.push(
        `- **${suppression.finding.title}** — \`${suppression.finding.id}\` @ rule \`${suppression.finding.checkId}@${suppression.checkVersion}\``,
        `  - Rationale: ${suppression.rationale}`
      );
    }
    lines.push("");
  }

  lines.push("## Coverage", "");
  for (const coverage of report.coverage) {
    lines.push(`- **${coverage.area}** — ${coverage.status}: ${coverage.detail}`);
  }
  lines.push("");

  lines.push(
    "## Handoff rules",
    "",
    "- Treat confirmed findings as evidence-backed concerns.",
    "- Treat unanswered controls as questions to investigate before changing code.",
    "- Do not reveal secret values while investigating credential findings.",
    "- Do not infer that unassessed areas are safe.",
    "- Preserve intended behaviour and run relevant project tests after repairs.",
    "- Rerun Ship Check after changes and distinguish resolved, persistent and newly introduced concerns.",
    "- Keep any agent judgement or contextual classification separate from Ship Check's deterministic result.",
    "",
    "Ship Check reports bounded project evidence, not security or compliance certification."
  );

  return lines.join("\n");
}
