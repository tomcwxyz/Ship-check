import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "./index.js";

const baseReport = {
  schemaVersion: "0.1" as const,
  tool: { name: "ship-check" as const, version: "0.0.0-alpha.4" },
  project: {
    path: "/tmp/project",
    gitRepository: true,
    inventorySource: "git-tracked" as const,
    fileCount: 10,
  },
  packs: ["secure-build" as const],
  checks: [
    {
      checkId: "secure.example",
      pack: "secure-build" as const,
      status: "passed" as const,
      findingCount: 0,
      durationMs: 2,
    },
  ],
  findings: [],
  summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  generatedAt: "2026-09-04T19:45:00.000Z",
};

describe("ScanReportSchema", () => {
  it("accepts explicit inventory provenance", () => {
    const report = ScanReportSchema.parse(baseReport);
    expect(report.project.inventorySource).toBe("git-tracked");
  });

  it("rejects reports that omit inventory provenance", () => {
    const { inventorySource: _inventorySource, ...project } = baseReport.project;
    expect(() => ScanReportSchema.parse({ ...baseReport, project })).toThrow();
  });

  it("rejects an impossible negative file count", () => {
    expect(() =>
      ScanReportSchema.parse({
        ...baseReport,
        project: { ...baseReport.project, fileCount: -1 },
      }),
    ).toThrow();
  });
});
