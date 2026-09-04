import { z } from "zod";

export const CheckPackSchema = z.enum(["secure-build", "production-ready", "cost-aware"]);
export type CheckPack = z.infer<typeof CheckPackSchema>;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

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

export const CheckResultSchema = z.object({
  checkId: z.string(),
  pack: CheckPackSchema,
  status: z.enum(["passed", "findings", "error"]),
  findingCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  error: z.string().optional()
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const InventorySourceSchema = z.enum(["git-tracked", "filesystem"]);
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const ScanReportSchema = z.object({
  schemaVersion: z.literal("0.1"),
  tool: z.object({ name: z.literal("ship-check"), version: z.string() }),
  project: z.object({
    path: z.string(),
    gitRepository: z.boolean(),
    inventorySource: InventorySourceSchema,
    fileCount: z.number().int().nonnegative()
  }),
  packs: z.array(CheckPackSchema),
  checks: z.array(CheckResultSchema),
  findings: z.array(FindingSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    info: z.number().int().nonnegative()
  }),
  generatedAt: z.string().datetime()
});
export type ScanReport = z.infer<typeof ScanReportSchema>;

export const AssuranceOutcomeSchema = z.enum(["pass", "fail", "uncertain", "incomplete"]);
export type AssuranceOutcome = z.infer<typeof AssuranceOutcomeSchema>;

export const AssuranceGateIdSchema = z.enum([
  "ship-check",
  "ship-check-secure-build",
  "ship-check-production-ready",
  "ship-check-cost-aware"
]);
export type AssuranceGateId = z.infer<typeof AssuranceGateIdSchema>;

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
    title: z.string().min(1)
  })),
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
