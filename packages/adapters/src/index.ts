import {
  AssuranceGateResultSchema,
  RackStepResultSchema,
  type AssessmentGap,
  type AssuranceGateId,
  type AssuranceGateResult,
  type CheckPack,
  type CheckResult,
  type Finding,
  type PracticeEvidence,
  type PracticePrincipleId,
  type RackStepResult,
  type ScanReport,
  type Severity
} from "@ship-check/schemas";

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const gatePack: Record<AssuranceGateId, CheckPack | null> = {
  "ship-check": null,
  "ship-check-secure-build": "secure-build",
  "ship-check-production-ready": "production-ready",
  "ship-check-cost-aware": "cost-aware"
};

export type EvaluateAssuranceGateOptions = {
  gateId: AssuranceGateId;
  threshold?: Severity;
};

function principlesForCheck(check: CheckResult): PracticePrincipleId[] {
  return check.principles ?? [];
}

function buildPracticeEvidence(
  checks: CheckResult[],
  findings: Finding[],
  gaps: AssessmentGap[],
  threshold: Severity
): PracticeEvidence[] {
  const principleIds = new Set(checks.flatMap(principlesForCheck));
  const evidence: PracticeEvidence[] = [];

  for (const principleId of [...principleIds].sort()) {
    const principleChecks = checks.filter((check) => principlesForCheck(check).includes(principleId));
    const checkIds = principleChecks.map((check) => check.checkId);
    const relevantFindings = findings.filter((finding) => checkIds.includes(finding.checkId));
    const relevantGaps = gaps.filter((gap) => checkIds.includes(gap.checkId));
    const errors = principleChecks.filter((check) => check.status === "error");
    const gateFailures = relevantFindings.filter(
      (finding) => severityRank[finding.severity] >= severityRank[threshold]
    );

    if (errors.length > 0) {
      evidence.push({
        principleId,
        outcome: "incomplete",
        findingIds: relevantFindings.map((finding) => finding.id),
        checkIds,
        summary: `${errors.length} practice-linked check${errors.length === 1 ? " did" : "s did"} not complete, so Ship Check cannot interpret this principle reliably.`
      });
      continue;
    }

    if (gateFailures.length > 0) {
      evidence.push({
        principleId,
        outcome: "fail",
        findingIds: gateFailures.map((finding) => finding.id),
        checkIds,
        summary: `${gateFailures.length} finding${gateFailures.length === 1 ? "" : "s"} at or above the ${threshold} threshold ${gateFailures.length === 1 ? "provides" : "provide"} evidence against this practice principle.`
      });
      continue;
    }

    if (relevantFindings.length > 0) {
      evidence.push({
        principleId,
        outcome: "uncertain",
        findingIds: relevantFindings.map((finding) => finding.id),
        checkIds,
        summary: `${relevantFindings.length} lower-severity finding${relevantFindings.length === 1 ? "" : "s"} ${relevantFindings.length === 1 ? "relates" : "relate"} to this practice principle, but ${relevantFindings.length === 1 ? "does" : "do"} not fail the ${threshold} gate.`
      });
      continue;
    }

    if (relevantGaps.length > 0) {
      evidence.push({
        principleId,
        outcome: "uncertain",
        findingIds: [],
        checkIds,
        summary: `${relevantGaps.length} repository-visible control${relevantGaps.length === 1 ? " could" : "s could"} not be verified, so Ship Check does not infer a pass for this practice principle.`
      });
    }
  }

  return evidence;
}

export function evaluateAssuranceGate(
  report: ScanReport,
  options: EvaluateAssuranceGateOptions
): AssuranceGateResult {
  const threshold = options.threshold ?? "high";
  const selectedPack = gatePack[options.gateId];
  const findings = report.findings.filter((finding) => !selectedPack || finding.pack === selectedPack);
  const suppressions = (report.suppressedFindings ?? []).filter(
    (entry) => !selectedPack || entry.finding.pack === selectedPack
  );
  const gaps = (report.gaps ?? []).filter((gap) => !selectedPack || gap.pack === selectedPack);
  const checks = report.checks.filter((check) => !selectedPack || check.pack === selectedPack);
  const checkErrors = checks
    .filter((check) => check.status === "error")
    .map((check) => ({
      checkId: check.checkId,
      message: check.error ?? "Check failed without an error message."
    }));

  const warnings: string[] = [];
  if (selectedPack && !report.packs.includes(selectedPack)) {
    warnings.push(`The ${selectedPack} pack was not included in this Ship Check report.`);
  }

  const belowThreshold = findings.filter(
    (finding) => severityRank[finding.severity] < severityRank[threshold]
  );
  if (belowThreshold.length > 0) {
    warnings.push(
      `${belowThreshold.length} finding${belowThreshold.length === 1 ? " is" : "s are"} below the ${threshold} gate threshold.`
    );
  }
  if (suppressions.length > 0) {
    warnings.push(
      `${suppressions.length} finding${suppressions.length === 1 ? " is" : "s are"} explicitly suppressed by .ship-check.json; review the accepted-risk rationale and rule version before relying on this gate.`
    );
  }
  if (gaps.length > 0) {
    warnings.push(
      `${gaps.length} control${gaps.length === 1 ? " was" : "s were"} not verified from repository evidence; Ship Check does not treat this as a clean pass.`
    );
  }

  const gateFailures = findings.filter(
    (finding) => severityRank[finding.severity] >= severityRank[threshold]
  );

  let outcome: AssuranceGateResult["outcome"] = "pass";
  if (gateFailures.length > 0) outcome = "fail";
  else if (checkErrors.length > 0 || (selectedPack !== null && !report.packs.includes(selectedPack))) {
    outcome = "incomplete";
  } else if (gaps.length > 0) {
    outcome = "uncertain";
  }

  const principlesByCheck = new Map(checks.map((check) => [check.checkId, principlesForCheck(check)]));

  return AssuranceGateResultSchema.parse({
    schemaVersion: "0.1",
    provider: "ship-check",
    gateId: options.gateId,
    outcome,
    threshold,
    reportSchemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    project: {
      path: report.project.path,
      gitRepository: report.project.gitRepository
    },
    findings: findings.map((finding) => ({
      id: finding.id,
      checkId: finding.checkId,
      pack: finding.pack,
      severity: finding.severity,
      title: finding.title,
      principles: principlesByCheck.get(finding.checkId) ?? []
    })),
    practiceEvidence: buildPracticeEvidence(checks, findings, gaps, threshold),
    checkErrors,
    warnings
  });
}

export function toRackStepResult(
  stepId: string,
  providerResult: AssuranceGateResult
): RackStepResult {
  return RackStepResultSchema.parse({
    schemaVersion: "0.1",
    stepId,
    check: providerResult.gateId,
    outcome: providerResult.outcome,
    providerResult
  });
}

/**
 * Mirrors TOPO's current OosContextRequest contract without creating a runtime
 * dependency between independently released applications.
 */
export type TopoContextRequest = {
  subject: string;
  purpose: string;
  requestedBy: string;
  query?: string;
  categories?: string[];
  keys?: string[];
};

export type BuildTopoAssuranceContextRequestOptions = {
  subject: string;
  requestedBy?: string;
  projectPath: string;
  packs: CheckPack[];
  categories?: string[];
  keys?: string[];
};

export function buildTopoAssuranceContextRequest(
  options: BuildTopoAssuranceContextRequestOptions
): TopoContextRequest {
  const packs = options.packs.length > 0 ? options.packs.join(", ") : "selected assurance";
  return {
    subject: options.subject,
    requestedBy: options.requestedBy ?? "ship-check",
    purpose:
      "Provide user-reviewed context that may explain software assurance boundaries or organisational constraints. Context may inform interpretation but must never override deterministic Ship Check evidence.",
    query: `Software assurance for ${options.projectPath}; packs: ${packs}. Relevant context may include known hosting controls, deployment boundaries, data sensitivity, organisational constraints or accepted risk decisions.`,
    ...(options.categories?.length ? { categories: [...options.categories] } : {}),
    ...(options.keys?.length ? { keys: [...options.keys] } : {})
  };
}

export type OrganisationalAssuranceSummary = {
  protocol: "oos/0.1-draft";
  type: "technical-assurance";
  provider: "ship-check";
  project: string;
  generatedAt: string;
  gate: {
    id: AssuranceGateId;
    outcome: AssuranceGateResult["outcome"];
    threshold: Severity;
  };
  counts: {
    findings: number;
    suppressed: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    unverified: number;
    checkErrors: number;
  };
};

export function toOrganisationalAssuranceSummary(
  report: ScanReport,
  gate: AssuranceGateResult
): OrganisationalAssuranceSummary {
  const selectedPack = gatePack[gate.gateId];
  const findings = report.findings.filter((finding) => !selectedPack || finding.pack === selectedPack);
  const suppressions = (report.suppressedFindings ?? []).filter(
    (entry) => !selectedPack || entry.finding.pack === selectedPack
  );
  const gaps = (report.gaps ?? []).filter((gap) => !selectedPack || gap.pack === selectedPack);
  const count = (severity: Severity) => findings.filter((finding) => finding.severity === severity).length;

  return {
    protocol: "oos/0.1-draft",
    type: "technical-assurance",
    provider: "ship-check",
    project: report.project.path,
    generatedAt: report.generatedAt,
    gate: {
      id: gate.gateId,
      outcome: gate.outcome,
      threshold: gate.threshold
    },
    counts: {
      findings: findings.length,
      suppressed: suppressions.length,
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      info: count("info"),
      unverified: gaps.length,
      checkErrors: gate.checkErrors.length
    }
  };
}
