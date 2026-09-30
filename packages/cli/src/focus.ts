import type {
  AssessmentGap,
  Finding,
  ScanReport,
  Severity
} from "@ship-check/schemas";

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

type FindingFocus = {
  type: "finding";
  action: "fix";
  id: string;
  checkId: string;
  checkVersion: string;
  severity: Severity;
  title: string;
  summary: string;
  evidence: Finding["evidence"];
  fix: string;
  verify: string;
  agentPrompt: string;
};

type GapFocus = {
  type: "unverified";
  action: "verify";
  id: string;
  checkId: string;
  checkVersion: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
};

type EmptyFocus = {
  type: "none";
  action: "none";
  summary: string;
};

export type FocusedReview = FindingFocus | GapFocus | EmptyFocus;

function checkVersionFor(report: ScanReport, checkId: string): string {
  return report.checks.find((check) => check.checkId === checkId)?.checkVersion ?? "1";
}

function nextFinding(report: ScanReport): Finding | undefined {
  return report.findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => {
      const severityDifference =
        severityRank[right.finding.severity] - severityRank[left.finding.severity];
      return severityDifference || left.index - right.index;
    })[0]?.finding;
}

export function selectFocusedReview(report: ScanReport): FocusedReview {
  const finding = nextFinding(report);
  if (finding) {
    return {
      type: "finding",
      action: "fix",
      id: finding.id,
      checkId: finding.checkId,
      checkVersion: checkVersionFor(report, finding.checkId),
      severity: finding.severity,
      title: finding.title,
      summary: finding.summary,
      evidence: finding.evidence,
      fix: finding.remediation.fix,
      verify: finding.remediation.verify,
      agentPrompt: finding.remediation.agentPrompt
    };
  }

  const gap = report.gaps?.[0];
  if (gap) {
    return {
      type: "unverified",
      action: "verify",
      id: gap.id,
      checkId: gap.checkId,
      checkVersion: checkVersionFor(report, gap.checkId),
      title: gap.title,
      summary: gap.summary,
      evidence: gap.evidence,
      verify: gap.verify
    };
  }

  return {
    type: "none",
    action: "none",
    summary:
      "No active findings or unanswered controls are present in this report. Review coverage and checks that were not assessed before drawing conclusions about the project."
  };
}

function renderEvidence(evidence: Finding["evidence"] | AssessmentGap["evidence"]): string[] {
  if (evidence.length === 0) return ["Evidence: none recorded"];
  return evidence.slice(0, 3).map((item) => {
    const location = item.path
      ? `${item.path}${item.line ? `:${item.line}` : ""}`
      : "project evidence";
    return `Evidence: ${location} — ${item.detail}`;
  });
}

export function renderFocusedReview(review: FocusedReview): string {
  if (review.type === "none") {
    return [
      "Ship Check focused review",
      "",
      "Action: NONE",
      review.summary,
      "",
      "A quiet focused queue is not a clean bill of health."
    ].join("\n");
  }

  const lines = [
    "Ship Check focused review",
    "",
    `Action: ${review.action.toUpperCase()}`,
    `Type: ${review.type === "finding" ? "Confirmed finding" : "Unverified control"}`,
    ...(review.type === "finding" ? [`Severity: ${review.severity.toUpperCase()}`] : []),
    `Title: ${review.title}`,
    `ID: ${review.id}`,
    `Rule: ${review.checkId}@${review.checkVersion}`,
    "",
    review.summary,
    "",
    ...renderEvidence(review.evidence),
    "",
    ...(review.type === "finding"
      ? [
          `Fix: ${review.fix}`,
          `Verify: ${review.verify}`,
          `Agent prompt: ${review.agentPrompt}`
        ]
      : [`Verify: ${review.verify}`])
  ];

  if (review.type === "unverified") {
    lines.push(
      "",
      "This item is a question to verify, not a confirmed defect to fix."
    );
  }

  return lines.join("\n");
}
