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
 * A privacy-preserving fingerprint of the exact source inventory Ship Check
 * attempted to scan. The digest is derived locally from normalised paths and
 * per-entry content/link digests; source contents never enter the report.
 *
 * `partial` means one or more inventory entries were deliberately skipped by
 * the fingerprint resource bounds or could not be read. Consumers must not
 * treat equal partial fingerprints as proof of identical source snapshots.
 */
export const ProjectSnapshotFingerprintSchema = z.object({
  algorithm: z.literal("sha256"),
  scope: z.literal("source-inventory-v1"),
  value: z.string().regex(/^[a-f0-9]{64}$/),
  completeness: z.enum(["complete", "partial"]),
  entryCount: z.number().int().nonnegative(),
  hashedEntryCount: z.number().int().nonnegative(),
  skippedEntryCount: z.number().int().nonnegative()
}).strict().superRefine((fingerprint, ctx) => {
  if (fingerprint.hashedEntryCount + fingerprint.skippedEntryCount !== fingerprint.entryCount) {
    ctx.addIssue({
      code: "custom",
      message: "Fingerprint hashed/skipped entry counts must equal the source inventory entry count."
    });
  }
  if (fingerprint.completeness === "complete" && fingerprint.skippedEntryCount !== 0) {
    ctx.addIssue({
      code: "custom",
      message: "A complete source fingerprint cannot contain skipped entries."
    });
  }
});
export type ProjectSnapshotFingerprint = z.infer<typeof ProjectSnapshotFingerprintSchema>;

/**
 * Input accepted by the core when a caller already knows how a directory was
 * acquired. The core supplies defaults for ordinary local scans and records
 * the final validated ProjectEvidenceSource in the report.
 */
export type ProjectEvidenceSourceInput = Partial<Omit<ProjectEvidenceSource, "schemaVersion" | "acquiredAt">> & {
  acquiredAt?: string;
};