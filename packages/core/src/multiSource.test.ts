import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "@ship-check/schemas";
import { combineScanReports } from "./multiSource.js";

function report(kind: "source" | "runtime") {
  const runtime = kind === "runtime";
  const source = runtime
    ? {
        schemaVersion: "0.1" as const,
        id: "url:https://example.com/",
        type: "deployment" as const,
        provider: "url",
        label: "https://example.com/",
        acquisition: "runtime-probe" as const,
        executionLocation: "user-device" as const,
        capabilities: ["runtime-http" as const],
        ephemeral: true,
        acquiredAt: "2026-09-18T12:00:00.000Z"
      }
    : {
        schemaVersion: "0.1" as const,
        id: "local:/project",
        type: "source" as const,
        provider: "local",
        label: "/project",
        acquisition: "local" as const,
        executionLocation: "user-device" as const,
        capabilities: ["source-files" as const],
        ephemeral: false,
        acquiredAt: "2026-09-18T11:59:00.000Z"
      };

  return ScanReportSchema.parse({
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "0.0.0-test" },
    project: {
      path: source.label,
      gitRepository: false,
      inventorySource: "filesystem",
      fileCount: runtime ? 0 : 2,
      snapshot: {
        schemaVersion: "0.1",
        id: runtime ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111",
        source,
        inventory: { source: "filesystem", fileCount: runtime ? 0 : 2 }
      }
    },
    packs: ["production-ready"],
    checks: runtime
      ? [
          {
            checkId: "production.source",
            pack: "production-ready",
            status: "not-assessed",
            missingEvidence: ["source-files"],
            findingCount: 0,
            durationMs: 0
          },
          {
            checkId: "runtime.headers",
            pack: "production-ready",
            status: "passed",
            findingCount: 0,
            observationCount: 1,
            durationMs: 1
          }
        ]
      : [{
          checkId: "production.source",
          pack: "production-ready",
          status: "passed",
          findingCount: 0,
          durationMs: 1
        }],
    findings: [],
    observations: runtime
      ? [{
          id: "runtime.headers:verified",
          checkId: "runtime.headers",
          pack: "production-ready",
          area: "runtime",
          kind: "verified-control",
          title: "Runtime headers observed",
          summary: "Runtime evidence exists.",
          evidence: [{ kind: "configuration", detail: "Representative response checked." }]
        }]
      : [],
    coverage: runtime
      ? [{ area: "runtime", status: "assessed", checkIds: ["runtime.headers"], detail: "Runtime assessed." }]
      : [{ area: "configuration", status: "partial", checkIds: ["production.source"], detail: "Configuration partially assessed." }],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    generatedAt: "2026-09-18T12:00:00.000Z"
  });
}

describe("combineScanReports", () => {
  it("keeps stronger primary check evidence and adds distinct runtime checks and provenance", () => {
    const combined = combineScanReports(report("source"), report("runtime"));

    expect(combined.project.evidenceSources).toHaveLength(2);
    expect(combined.project.evidenceSources.map((source) => source.type)).toEqual(["source", "deployment"]);
    expect(combined.checks.find((check) => check.checkId === "production.source")?.status).toBe("passed");
    expect(combined.checks.find((check) => check.checkId === "runtime.headers")?.status).toBe("passed");
    expect(combined.coverage.find((entry) => entry.area === "runtime")?.status).toBe("assessed");
    expect(combined.coverage.find((entry) => entry.area === "configuration")?.status).toBe("partial");
    expect(combined.observations).toHaveLength(1);
  });
});
