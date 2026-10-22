import type { AssessmentGap, ProjectEvidenceSource, ScanReport, Severity } from "@ship-check/schemas";
import type { ResolvedAssessmentGap } from "@ship-check/schemas/multiSource";

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
  // Multi-source reports extend the canonical scan report without changing the single-source contract.
  const multi = report as ScanReport & {
    project: ScanReport["project"] & { evidenceSources?: ProjectEvidenceSource[] };
    resolvedGaps?: ResolvedAssessmentGap[];
  };
  const sources = multi.project.evidenceSources ??
    (report.project.snapshot?.source ? [report.project.snapshot.source] : []);
  const resolvedGaps = multi.resolvedGaps ?? [];
  const observations = [...report.observations].sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === "verified-control" ? -1 : 1) ||
    a.area.localeCompare(b.area) ||
    a.title.localeCompare(b.title)
  );
  const checkErrors = report.checks.filter((check) => check.status === "error");
  const unavailable = report.gaps.filter(isUnavailableScannerGap);
  const unanswered = report.gaps.filter((gap) => !isUnavailableScannerGap(gap));
  const lines: string[] = [
    `# Ship Check review — ${report.project.path}`,
    "",
    `**${report.summary.total}** confirmed findings · **${unanswered.length}** unanswered controls · **${observations.length}** observations · **${unavailable.length}** unavailable scanner checks · **${checkErrors.length}** check errors.`,
    ""
  ];

  if (report.project.context) {
    const declared = [
      report.project.context.status ? `status: ${report.project.context.status}` : "",
      report.project.context.ownership ? `ownership: ${report.project.context.ownership}` : ""
    ].filter(Boolean).join(" · ");
    lines.push(`Declared project context — ${declared}.`, "");
  }

  if (sources.length > 1) {
    lines.push("## Evidence sources", "");
    for (const source of sources) {
      lines.push(`- **${source.type}** — ${source.label} (${source.provider}, ${source.acquisition}, acquired ${source.acquiredAt}).`);
    }
    lines.push(
      "",
      "Sources were collected separately. A local source snapshot may not correspond to the live deployment version.",
      ""
    );
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

  if (unanswered.some((gap) => gap.checkId === "production.next-security-headers") &&
      !sources.some((source) => source.type === "deployment")) {
    lines.push(
      "## Suggested next evidence",
      "",
      "- **Deployed security headers:** Supply the application's public deployment URL to check the actual HTTP response rather than guessing from `next.config.*`:",
      "  `ship-check scan <project-source> --deployment-url https://your-site.example --format markdown`",
      "  This is a bounded, non-mutating probe. Ensure the source snapshot and deployment refer to the intended revision.",
      ""
    );
  }

  if (resolvedGaps.length > 0) {
    lines.push(
      "## Questions answered by additional evidence",
      "",
      "Additional evidence answered these earlier questions. An answered question is **not necessarily a passed control**; review confirmed findings for any problems it established.",
      ""
    );
    for (const item of resolvedGaps) {
      lines.push(`- **${item.gap.title}** — ${item.summary}`);
    }
    lines.push("");
  }

  if (observations.length > 0) {
    lines.push(
      "## Evidence observed",
      "",
      "These are repository or runtime observations, **not automatic proof of safety**. Verified controls establish only the specific bounded behaviour described.",
      ""
    );
    const limit = 12;
    for (const item of observations.slice(0, limit)) {
      const evidence = item.evidence[0];
      lines.push(
        `- **${item.kind === "verified-control" ? "Verified control" : "Observed"} · ${item.title}** [${item.area}] — ${item.summary}`,
        `  - Evidence: ${evidenceLocation(evidence?.path, evidence?.line)}`
      );
    }
    if (observations.length > limit) {
      lines.push(`- …and ${observations.length - limit} more observations. Use \`--format json\` for the complete evidence list.`);
    }
    lines.push("");
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
