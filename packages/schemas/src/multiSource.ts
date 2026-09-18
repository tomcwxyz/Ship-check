import { z } from "zod";
import { ScanReportSchema } from "./index.js";
import { ProjectEvidenceSourceSchema } from "./projectEvidence.js";

export const MultiSourceScanReportSchema = ScanReportSchema.extend({
  project: ScanReportSchema.shape.project.extend({
    evidenceSources: z.array(ProjectEvidenceSourceSchema).min(2)
  })
});

export type MultiSourceScanReport = z.infer<typeof MultiSourceScanReportSchema>;
