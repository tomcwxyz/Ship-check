import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "./index.js";

const baseReport = {
  schemaVersion: "0.1" as const,
  tool: { name: "ship-check" as const, version: "0.0.0-alpha.6" },
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
  it("accepts explicit inventory provenance and supplies additive evidence defaults", () => {
    const report = ScanReportSchema.parse(baseReport);
    expect(report.project.inventorySource).toBe("git-tracked");
    expect(report.gaps).toEqual([]);
    expect(report.observations).toEqual([]);
    expect(report.coverage).toEqual([]);
    expect(report.checks[0]?.gapCount).toBe(0);
    expect(report.checks[0]?.observationCount).toBe(0);
  });

  it("accepts an unverified control separately from findings", () => {
    const report = ScanReportSchema.parse({
      ...baseReport,
      checks: [{
        checkId: "production.headers",
        pack: "production-ready",
        status: "unverified",
        findingCount: 0,
        gapCount: 1,
        durationMs: 1,
      }],
      gaps: [{
        id: "production.headers:missing",
        checkId: "production.headers",
        pack: "production-ready",
        area: "configuration",
        title: "Header control not verified",
        summary: "Repository evidence is incomplete.",
        evidence: [{ kind: "configuration", detail: "No local header evidence." }],
        verify: "Inspect deployed response headers."
      }],
      coverage: [{
        area: "configuration",
        status: "partial",
        checkIds: ["production.headers"],
        detail: "Configuration is partially assessed."
      }]
    });

    expect(report.findings).toHaveLength(0);
    expect(report.gaps[0]?.area).toBe("configuration");
    expect(report.coverage[0]?.status).toBe("partial");
  });

  it("accepts positive observations without changing finding semantics", () => {
    const report = ScanReportSchema.parse({
      ...baseReport,
      packs: ["production-ready"],
      checks: [{
        checkId: "production.server-surface-inventory",
        pack: "production-ready",
        status: "passed",
        findingCount: 0,
        gapCount: 0,
        observationCount: 1,
        durationMs: 1,
      }],
      observations: [{
        id: "production.server-surface-inventory:api-routes",
        checkId: "production.server-surface-inventory",
        pack: "production-ready",
        area: "access-control",
        kind: "inventory",
        title: "Server request surfaces discovered",
        summary: "Two request routes were found.",
        evidence: [{ kind: "file-presence", path: "app/api/demo/route.ts", detail: "Request surface." }]
      }]
    });

    expect(report.summary.total).toBe(0);
    expect(report.observations).toHaveLength(1);
    expect(report.checks[0]?.status).toBe("passed");
    expect(report.checks[0]?.observationCount).toBe(1);
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

  it("rejects unknown assessment areas", () => {
    expect(() => ScanReportSchema.parse({
      ...baseReport,
      coverage: [{ area: "magic", status: "partial", checkIds: [], detail: "Nope" }]
    })).toThrow();
  });
});