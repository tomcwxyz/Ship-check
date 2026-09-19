import { z } from "zod";
import {
  ProjectEvidenceCapabilitySchema,
  ProjectEvidenceSourceSchema,
  ProjectSnapshotFingerprintSchema
} from "./projectEvidence.js";

export * from "./projectEvidence.js";

export const PracticePrincipleIdSchema = z.string().regex(
  /^practice\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/,
  "Expected a stable practice principle ID such as practice.preserve-safety."
);
export type PracticePrincipleId = z.infer<typeof PracticePrincipleIdSchema>;

export const CheckPackSchema = z.enum(["secure-build", "production-ready", "cost-aware"]);
export type CheckPack = z.infer<typeof CheckPackSchema>;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const CheckVersionSchema = z.string().regex(
  /^[1-9]\d*(?:\.\d+){0,2}$/,
  "Expected a positive rule version such as 1, 2 or 2.1."
);
export type CheckVersion = z.infer<typeof CheckVersionSchema>;

export const RulesetProvenanceSchema = z.object({
  algorithm: z.literal("sha256"),
  scope: z.literal("check-ruleset-v1"),
  value: z.string().regex(/^[a-f0-9]{64}$/),
  checkCount: z.number().int().nonnegative()
}).strict();
export type RulesetProvenance = z.infer<typeof RulesetProvenanceSchema>;

export const OpaqueProjectIdentitySchema = z.object({
  algorithm: z.literal("sha256"),
  scope: z.literal("project-source-v1"),
  value: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type OpaqueProjectIdentity = z.infer<typeof OpaqueProjectIdentitySchema>;

export const OpaqueScanIdentitySchema = z.object({
  algorithm: z.literal("sha256"),
  scope: z.literal("scan-event-v1"),
  value: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type OpaqueScanIdentity = z.infer<typeof OpaqueScanIdentitySchema>;

export const AssessmentAreaSchema = z.enum([
  "secrets",
  "access-control",
  "configuration",
  "supply-chain",
  "cost",
  "code-security",
  "database",
  "runtime"
]);
export type AssessmentArea = z.infer<typeof AssessmentAreaSchema>;

export const CoverageStatusSchema = z.enum(["assessed", "partial", "not-assessed"]);
export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum(["file-match", "file-presence", "configuration", "repository"]),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  excerpt: z.string().max(300).optional(),
  detail: z.string().min(1)
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RemediationSchema = z.object({
  why: z.string().min(1),
  fix: z.string().min(1),
  verify: z.string().min(1),
  agentPrompt: z.string().min(1)
});
export type Remediation = z.infer<typeof RemediationSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  checkId: z.string().min(1),
  pack: CheckPackSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceSchema).min(1),
  remediation: RemediationSchema
});
export type Finding = z.infer<typeof FindingSchema>;

export const FindingSuppressionSchema = z.object({
  findingId: z.string().min(1),
  checkVersion: CheckVersionSchema,
  rationale: z.string().trim().min(10, "Suppression rationale must explain why the finding is accepted.")
}).strict();
export type FindingSuppression = z.infer<typeof FindingSuppressionSchema>;

export const ShipCheckConfigSchema = z.object({
  schemaVersion: z.literal("0.1"),
  suppressions: z.array(FindingSuppressionSchema).default([])
}).strict();
export type ShipCheckConfig = z.infer<typeof ShipCheckConfigSchema>;

export const AppliedSuppressionSchema = z.object({
  finding: FindingSchema,
  checkVersion: CheckVersionSchema,
  rationale: z.string().min(10),
  configPath: z.literal(".ship-check.json")
});
export type AppliedSuppression = z.infer<typeof AppliedSuppressionSchema>;

export const AssessmentGapSchema = z.object({
  id: z.string().min(1),
  checkId: z.string().min(1),
  pack: CheckPackSchema,
  area: AssessmentAreaSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
  verify: z.string().min(1)
});
export type AssessmentGap = z.infer<typeof AssessmentGapSchema>;

export const ObservationKindSchema = z.enum(["inventory", "verified-control"]);
export type ObservationKind = z.infer<typeof ObservationKindSchema>;

export const ObservationSchema = z.object({
  id: z.string().min(1),
  checkId: z.string().min(1),
  pack: CheckPackSchema,
  area: AssessmentAreaSchema,
  kind: ObservationKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
  resolvesCheckIds: z.array(z.string().min(1)).optional()
});
export type Observation = z.infer<typeof ObservationSchema>;

export const CoverageEntrySchema = z.object({
  area: AssessmentAreaSchema,
  status: CoverageStatusSchema,
  checkIds: z.array(z.string().min(1)),
  detail: z.string().min(1)
});
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

export const CheckResultSchema = z.object({
  scannerVersion: z.string().optional(),
  checkId: z.string(),
  checkVersion: CheckVersionSchema.default("1"),
  pack: CheckPackSchema,
  principles: z.array(PracticePrincipleIdSchema).default([]),
  status: z.enum(["passed", "findings", "suppressed", "unverified", "resolved", "not-assessed", "not-applicable", "error"]),
  missingEvidence: z.array(ProjectEvidenceCapabilitySchema).default([]),
  findingCount: z.number().int().nonnegative(),
  suppressedCount: z.number().int().nonnegative().default(0),
  gapCount: z.number().int().nonnegative().default(0),
  resolvedGapCount: z.number().int().nonnegative().optional(),
  observationCount: z.number().int().nonnegative().default(0),
  durationMs: z.number().nonnegative(),
  error: z.string().optional()
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const InventorySourceSchema = z.enum(["git-tracked", "filesystem"]);
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const ProjectSnapshotSchema = z.object({
  schemaVersion: z.literal("0.1"),
  id: z.string().uuid(),
  source: ProjectEvidenceSourceSchema,
  inventory: z.object({
    source: InventorySourceSchema,
    fileCount: z.number().int().nonnegative(),
    commit: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
    fingerprint: ProjectSnapshotFingerprintSchema.optional()
  }).strict()
}).strict();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export const ScanReportSchema = z.object({
  schemaVersion: z.literal("0.1"),
  tool: z.object({ name: z.literal("ship-check"), version: z.string() }),
  project: z.object({
    path: z.string(),
    gitRepository: z.boolean(),
    inventorySource: InventorySourceSchema,
    fileCount: z.number().int().nonnegative(),
    commit: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
    snapshot: ProjectSnapshotSchema.optional()
  }),
  packs: z.array(CheckPackSchema),
  checks: z.array(CheckResultSchema),
  ruleset: RulesetProvenanceSchema.optional(),
  findings: z.array(FindingSchema),
  suppressedFindings: z.array(AppliedSuppressionSchema).default([]),
  gaps: z.array(AssessmentGapSchema).default([]),
  observations: z.array(ObservationSchema).default([]),
  coverage: z.array(CoverageEntrySchema).default([]),
  summary: z.object({
    total: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative().default(0),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative()
  }),
  generatedAt: z.string().datetime()
});
export type ScanReport = z.infer<typeof ScanReportSchema>;


export const ProjectHistoryEvidenceSourceSchema = z.object({
  type: ProjectEvidenceSourceSchema.shape.type,
  provider: ProjectEvidenceSourceSchema.shape.provider,
  acquisition: ProjectEvidenceSourceSchema.shape.acquisition,
  executionLocation: ProjectEvidenceSourceSchema.shape.executionLocation,
  capabilities: ProjectEvidenceSourceSchema.shape.capabilities,
  count: z.number().int().positive().default(1)
}).strict();
export type ProjectHistoryEvidenceSource = z.infer<typeof ProjectHistoryEvidenceSourceSchema>;

export const ProjectHistoryCoverageSchema = z.object({
  area: AssessmentAreaSchema,
  status: CoverageStatusSchema,
  checkCount: z.number().int().nonnegative()
}).strict();
export type ProjectHistoryCoverage = z.infer<typeof ProjectHistoryCoverageSchema>;

export const ProjectHistoryChangeSchema = z.object({
  basis: z.enum(["previous-comparable-scan", "pull-request-base"]),
  scope: z.enum(["source", "project"]),
  sourceSnapshot: z.enum(["changed", "unchanged", "uncertain", "unknown"]),
  findings: z.object({
    introduced: z.number().int().nonnegative(),
    persistent: z.number().int().nonnegative(),
    reactivated: z.number().int().nonnegative().default(0),
    accepted: z.number().int().nonnegative().default(0),
    noLongerActive: z.number().int().nonnegative()
  }).strict(),
  gaps: z.object({
    introduced: z.number().int().nonnegative(),
    persistent: z.number().int().nonnegative(),
    noLongerActive: z.number().int().nonnegative()
  }).strict(),
  surfaces: z.object({
    introduced: z.number().int().nonnegative().default(0),
    persistent: z.number().int().nonnegative().default(0),
    noLongerObserved: z.number().int().nonnegative().default(0)
  }).strict().default({
    introduced: 0,
    persistent: 0,
    noLongerObserved: 0
  })
}).strict();
export type ProjectHistoryChange = z.infer<typeof ProjectHistoryChangeSchema>;

export const ProjectHistoryMetadataSchema = z.object({
  schemaVersion: z.literal("0.1"),
  type: z.literal("assurance-metadata"),
  provider: z.literal("ship-check"),
  project: z.object({
    identity: OpaqueProjectIdentitySchema,
    identityBasis: z.enum(["primary-evidence", "caller-provided"]),
    evidenceSources: z.array(ProjectHistoryEvidenceSourceSchema).min(1),
    sourceFingerprint: ProjectSnapshotFingerprintSchema.optional(),
    commit: z.string().regex(/^[a-f0-9]{40,64}$/).optional()
  }).strict(),
  scan: z.object({
    identity: OpaqueScanIdentitySchema,
    generatedAt: z.string().datetime(),
    engineVersion: z.string().min(1),
    ruleset: RulesetProvenanceSchema,
    packs: z.array(CheckPackSchema),
    checkCount: z.number().int().nonnegative()
  }).strict(),
  counts: z.object({
    findings: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    observed: z.number().int().nonnegative(),
    notAssessed: z.number().int().nonnegative(),
    checkErrors: z.number().int().nonnegative()
  }).strict(),
  coverage: z.array(ProjectHistoryCoverageSchema),
  change: ProjectHistoryChangeSchema.optional()
}).strict();
export type ProjectHistoryMetadata = z.infer<typeof ProjectHistoryMetadataSchema>;

export const AssuranceOutcomeSchema = z.enum(["pass", "fail", "uncertain", "incomplete"]);
export type AssuranceOutcome = z.infer<typeof AssuranceOutcomeSchema>;

export const AssuranceGateIdSchema = z.enum([
  "ship-check",
  "ship-check-secure-build",
  "ship-check-production-ready",
  "ship-check-cost-aware"
]);
export type AssuranceGateId = z.infer<typeof AssuranceGateIdSchema>;

export const PracticeEvidenceSchema = z.object({
  principleId: PracticePrincipleIdSchema,
  outcome: z.enum(["fail", "uncertain", "incomplete"]),
  findingIds: z.array(z.string().min(1)).default([]),
  checkIds: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1)
});
export type PracticeEvidence = z.infer<typeof PracticeEvidenceSchema>;

export const AssuranceGateResultSchema = z.object({
  schemaVersion: z.literal("0.1"),
  provider: z.literal("ship-check"),
  gateId: AssuranceGateIdSchema,
  outcome: AssuranceOutcomeSchema,
  threshold: SeveritySchema,
  reportSchemaVersion: z.literal("0.1"),
  generatedAt: z.string().datetime(),
  project: z.object({
    path: z.string(),
    gitRepository: z.boolean()
  }),
  findings: z.array(z.object({
    id: z.string().min(1),
    checkId: z.string().min(1),
    pack: CheckPackSchema,
    severity: SeveritySchema,
    title: z.string().min(1),
    principles: z.array(PracticePrincipleIdSchema).default([])
  })),
  practiceEvidence: z.array(PracticeEvidenceSchema).default([]),
  checkErrors: z.array(z.object({
    checkId: z.string().min(1),
    message: z.string().min(1)
  })),
  warnings: z.array(z.string())
});
export type AssuranceGateResult = z.infer<typeof AssuranceGateResultSchema>;

export const RackStepResultSchema = z.object({
  schemaVersion: z.literal("0.1"),
  stepId: z.string().min(1),
  check: AssuranceGateIdSchema,
  outcome: AssuranceOutcomeSchema,
  providerResult: AssuranceGateResultSchema
});
export type RackStepResult = z.infer<typeof RackStepResultSchema>;
