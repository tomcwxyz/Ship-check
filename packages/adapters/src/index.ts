import {
  AssuranceGateResultSchema,
  RackStepResultSchema,
  type AssuranceGateId,
  type AssuranceGateResult,
  type CheckPack,
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

export function evaluateAssuranceGate(
  report: ScanReport,
  options: EvaluateAssuranceGateOptions
): AssuranceGateResult {
  const threshold = options.threshold ?? "high";
  const selectedPack = gatePack[options.gateId];
  const findings = report.findings.filter((finding) => !selectedPack || finding.pack === selectedPack);
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

  const gateFailures = findings.filter(
    (finding) => severityRank[finding.severity] >= severityRank[threshold]
  );

  let outcome: AssuranceGateResult["outcome"] = "pass";
  if (gateFailures.length > 0) outcome = "fail";
  else if (checkErrors.length > 0 || (selectedPack !== null && !report.packs.includes(selectedPack))) {
    outcome = "incomplete";
  }

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
      title: finding.title
    })),
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
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    checkErrors: number;
  };
};

export function toOrganisationalAssuranceSummary(
  report: ScanReport,
  gate: AssuranceGateResult
): OrganisationalAssuranceSummary {
  const selectedPack = gatePack[gate.gateId];
  const findings = report.findings.filter((finding) => !selectedPack || finding.pack === selectedPack);
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
      critical: count("critical"),
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      info: count("info"),
      checkErrors: gate.checkErrors.length
    }
  };
}
