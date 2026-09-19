import { describe, expect, it } from "vitest";
import { ScanReportSchema, type ScanReport } from "@ship-check/schemas";
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

function sourceWithHeaderGap(): ScanReport {
  const base = report("source");
  return ScanReportSchema.parse({
    ...base,
    checks: [{
      checkId: "production.next-security-headers",
      pack: "production-ready",
      status: "unverified",
      findingCount: 0,
      gapCount: 1,
      durationMs: 1
    }],
    gaps: [{
      id: "production.next-security-headers:next.config.ts",
      checkId: "production.next-security-headers",
      pack: "production-ready",
      area: "configuration",
      title: "Security headers are not verified from repository evidence",
      summary: "The repository does not prove whether deployed headers exist.",
      evidence: [{ kind: "configuration", path: "next.config.ts", detail: "No recognised core policy was found." }],
      verify: "Inspect the deployed response headers."
    }]
  });
}

function runtimeWithResolver(options: { resolves?: boolean; finding?: boolean } = {}): ScanReport {
  const base = report("runtime");
  return ScanReportSchema.parse({
    ...base,
    checks: [{
      checkId: "runtime.response-security-headers",
      pack: "production-ready",
      status: options.finding ? "findings" : "passed",
      findingCount: options.finding ? 1 : 0,
      observationCount: 1,
      durationMs: 1
    }],
    findings: options.finding ? [{
      id: "runtime.response-security-headers:incomplete",
      checkId: "runtime.response-security-headers",
      pack: "production-ready",
      title: "Browser security header baseline is incomplete",
      summary: "A wider runtime baseline remains incomplete.",
      severity: "low",
      confidence: "high",
      evidence: [{ kind: "configuration", detail: "One baseline header is missing." }],
      remediation: {
        why: "Defence in depth.",
        fix: "Add the missing header.",
        verify: "Re-run the runtime check.",
        agentPrompt: "Add the missing browser security header."
      }
    }] : [],
    observations: [{
      id: "runtime.response-security-headers:verified",
      checkId: "runtime.response-security-headers",
      pack: "production-ready",
      area: "runtime",
      kind: "verified-control",
      title: "Core security-header policy observed at runtime",
      summary: "Runtime evidence proves that the core policy exists.",
      evidence: [{ kind: "configuration", detail: "Core header names were present." }],
      ...(options.resolves === false ? {} : { resolvesCheckIds: ["production.next-security-headers"] })
    }]
  });
}

describe("combineScanReports", () => {
  it("keeps stronger primary check evidence and adds distinct runtime checks and provenance", () => {
    const combined = combineScanReports(report("source"), report("runtime"));

    expect(combined.project.evidenceSources).toHaveLength(2);
    expect(combined.ruleset).toMatchObject({
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      checkCount: 2
    });
    expect(combined.project.evidenceSources.map((source) => source.type)).toEqual(["source", "deployment"]);
    expect(combined.checks.find((check) => check.checkId === "production.source")?.status).toBe("passed");
    expect(combined.checks.find((check) => check.checkId === "runtime.headers")?.status).toBe("passed");
    expect(combined.coverage.find((entry) => entry.area === "runtime")?.status).toBe("assessed");
    expect(combined.coverage.find((entry) => entry.area === "configuration")?.status).toBe("partial");
    expect(combined.observations).toHaveLength(1);
    expect(combined.resolvedGaps).toEqual([]);
  });

  it("rejects conflicting versions for the same check across evidence sources", () => {
    const source = report("source");
    const runtime = report("runtime");
    const conflictingRuntime = ScanReportSchema.parse({
      ...runtime,
      checks: runtime.checks.map((check) =>
        check.checkId === "production.source"
          ? { ...check, checkVersion: "2" }
          : check
      )
    });

    expect(() => combineScanReports(source, conflictingRuntime))
      .toThrow(/conflicting rule definitions for production\.source/i);
  });

  it("resolves an exact source gap only when a verified observation explicitly names that check", () => {
    const combined = combineScanReports(sourceWithHeaderGap(), runtimeWithResolver());

    expect(combined.gaps).toEqual([]);
    expect(combined.resolvedGaps).toHaveLength(1);
    expect(combined.resolvedGaps[0]).toMatchObject({
      gap: { checkId: "production.next-security-headers" },
      resolvedByObservationIds: ["runtime.response-security-headers:verified"],
      resolvedByCheckIds: ["runtime.response-security-headers"]
    });
    expect(combined.checks.find((check) => check.checkId === "production.next-security-headers")).toMatchObject({
      status: "resolved",
      gapCount: 0,
      resolvedGapCount: 1
    });
  });

  it("does not resolve a gap from a generic verified observation without an explicit relationship", () => {
    const combined = combineScanReports(sourceWithHeaderGap(), runtimeWithResolver({ resolves: false }));

    expect(combined.gaps).toHaveLength(1);
    expect(combined.resolvedGaps).toEqual([]);
    expect(combined.checks.find((check) => check.checkId === "production.next-security-headers")).toMatchObject({
      status: "unverified",
      gapCount: 1,
      resolvedGapCount: 0
    });
  });

  it("can resolve a narrower source uncertainty while retaining a distinct runtime finding", () => {
    const combined = combineScanReports(sourceWithHeaderGap(), runtimeWithResolver({ finding: true }));

    expect(combined.gaps).toEqual([]);
    expect(combined.resolvedGaps).toHaveLength(1);
    expect(combined.findings).toContainEqual(expect.objectContaining({
      id: "runtime.response-security-headers:incomplete"
    }));
    expect(combined.summary.low).toBe(1);
  });
});
