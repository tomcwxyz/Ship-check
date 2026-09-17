import { z } from "zod";

export const ProjectEvidenceSourceTypeSchema = z.enum([
  "source",
  "deployment",
  "database",
  "platform",
  "dependency",
  "ci"
]);
export type ProjectEvidenceSourceType = z.infer<typeof ProjectEvidenceSourceTypeSchema>;

export const ProjectEvidenceCapabilitySchema = z.enum([
  "source-files",
  "git-history",
  "dependency-manifests",
  "runtime-http",
  "database-metadata",
  "platform-metadata",
  "ci-context"
]);
export type ProjectEvidenceCapability = z.infer<typeof ProjectEvidenceCapabilitySchema>;

export const ProjectEvidenceAcquisitionSchema = z.enum([
  "local",
  "transient-checkout",
  "uploaded-snapshot",
  "remote-readonly",
  "runtime-probe",
  "ci"
]);
export type ProjectEvidenceAcquisition = z.infer<typeof ProjectEvidenceAcquisitionSchema>;

export const ProjectExecutionLocationSchema = z.enum([
  "user-device",
  "ci-runner",
  "ship-check-managed",
  "external-platform"
]);
export type ProjectExecutionLocation = z.infer<typeof ProjectExecutionLocationSchema>;

const providerIdSchema = z.string().regex(
  /^[a-z][a-z0-9-]*$/,
  "Expected a stable provider ID such as local, github, lovable or upload."
);

export const ProjectEvidenceSourceSchema = z.object({
  schemaVersion: z.literal("0.1"),
  id: z.string().min(1),
  type: ProjectEvidenceSourceTypeSchema,
  provider: providerIdSchema,
  label: z.string().min(1),
  acquisition: ProjectEvidenceAcquisitionSchema,
  executionLocation: ProjectExecutionLocationSchema,
  capabilities: z.array(ProjectEvidenceCapabilitySchema).min(1),
  ephemeral: z.boolean().default(false),
  acquiredAt: z.string().datetime(),
  ref: z.string().min(1).optional()
}).strict();
export type ProjectEvidenceSource = z.infer<typeof ProjectEvidenceSourceSchema>;

/**
 * Input accepted by the core when a caller already knows how a directory was
 * acquired. The core supplies defaults for ordinary local scans and records
 * the final validated ProjectEvidenceSource in the report.
 */
export type ProjectEvidenceSourceInput = Partial<Omit<ProjectEvidenceSource, "schemaVersion" | "acquiredAt">> & {
  acquiredAt?: string;
};
