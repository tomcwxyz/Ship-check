import { z } from "zod";
import { AssessmentGapSchema, ScanReportSchema } from "./index.js";
import { ProjectEvidenceSourceSchema } from "./projectEvidence.js";

export const ResolvedAssessmentGapSchema = z.object({
  gap: AssessmentGapSchema,
  resolvedByObservationIds: z.array(z.string().min(1)).min(1),
  resolvedByCheckIds: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1)
});
export type ResolvedAssessmentGap = z.infer<typeof ResolvedAssessmentGapSchema>;

export const MultiSourceScanReportSchema = ScanReportSchema.extend({
  project: ScanReportSchema.shape.project.extend({
    evidenceSources: z.array(ProjectEvidenceSourceSchema).min(2)
  }),
  resolvedGaps: z.array(ResolvedAssessmentGapSchema).default([])
});

export type MultiSourceScanReport = z.infer<typeof MultiSourceScanReportSchema>;
