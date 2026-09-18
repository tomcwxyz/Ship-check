import { describe, expect, it } from "vitest";
import { ScanReportSchema, type ScanReport } from "@ship-check/schemas";
import { MultiSourceScanReportSchema } from "@ship-check/schemas/multiSource";
import {
  evaluateAssuranceGate,
  toOrganisationalAssuranceSummary,
  toRackStepResult
} from "./index.js";

function combinedReport(options: {
  findingSeverity?: "low" | "high";
  includeUnavailableCheck?: boolean;
} = {}) {
  const source = {
    schemaVersion: "0.1" as const,
    id: "local:/project",
    type: "source" as const,
    provider: "local",
    label: "/project",
    acquisition: "local" as const,
    executionLocation: "user-device" as const,
    capabilities: ["source-files" as const],
    ephemeral: false,
    acquiredAt: "2026-09-18T13:00:00.000Z"
  };
  const deployment = {
    schemaVersion: "0.1" as const,
    id: "url:https://example.com/",
    type: "deployment" as const,
    provider: "url",
    label: "https://example.com/",
    acquisition: "runtime-probe" as const,
    executionLocation: "user-device" as const,
    capabilities: ["runtime-http" as const],
    ephemeral: true,
    acquiredAt: "2026-09-18T13:01:00.000Z"
  };

  const gap = {
    id: "production.next-security-headers:next.config.ts",
    checkId: "production.next-security-headers",
    pack: "production-ready" as const,
    area: "configuration" as const,
    title: "Security headers are not verified from repository evidence",
    summary: "The repository alone could not establish the deployed policy.",
    evidence: [{ kind: "configuration" as const, path: "next.config.ts", detail: "No recognised core policy was found." }],
    verify: "Inspect the deployed response headers."
  };

  const findings = options.findingSeverity ? [{
    id: `runtime.response-security-headers:${options.findingSeverity}`,
    checkId: "runtime.response-security-headers",
    pack: "production-ready" as const,
    title: "Runtime header concern remains",
    summary: "A distinct runtime concern remains after the source question was resolved.",
    severity: options.findingSeverity,
    confidence: "high" as const,
    evidence: [{ kind: "configuration" as const, detail: "A bounded runtime check found a distinct concern." }],
    remediation: {
      why: "Runtime behaviour still needs attention.",
      fix: "Correct the deployed response policy.",
      verify: "Rerun the runtime check.",
      agentPrompt: "Correct the deployed response policy and rerun Ship Check."
    }
  }] : [];

  return MultiSourceScanReportSchema.parse({
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "test" },
    project: {
      path: "/project",
      gitRepository: false,
      inventorySource: "filesystem",
      fileCount: 3,
      snapshot: {
        schemaVersion: "0.1",
        id: "11111111-1111-4111-8111-111111111111",
        source,
        inventory: { source: "filesystem", fileCount: 3 }
      },
      evidenceSources: [source, deployment]
    },
    packs: ["production-ready"],
    checks: [
      {
        checkId: "production.next-security-headers",
        pack: "production-ready",
        principles: ["practice.preserve-safety"],
        status: "resolved",
        findingCount: 0,
        gapCount: 0,
        resolvedGapCount: 1,
        observationCount: 0,
        durationMs: 1
      },
      {
        checkId: "runtime.response-security-headers",
        pack: "production-ready",
        principles: ["practice.preserve-safety"],
        status: findings.length > 0 ? "findings" : "passed",
        findingCount: findings.length,
        gapCount: 0,
        observationCount: 1,
        durationMs: 1
      },
      ...(options.includeUnavailableCheck ? [{
        checkId: "production.dependency-evidence",
        pack: "production-ready" as const,
        principles: ["practice.dependency-restraint"],
        status: "not-assessed" as const,
        missingEvidence: ["dependency-manifests" as const],
        findingCount: 0,
        gapCount: 0,
        observationCount: 0,
        durationMs: 0
      }] : [])
    ],
    findings,
    gaps: [],
    resolvedGaps: [{
      gap,
      resolvedByObservationIds: ["runtime.response-security-headers:verified"],
      resolvedByCheckIds: ["runtime.response-security-headers"],
      summary: "Runtime evidence resolved the source-only uncertainty."
    }],
    observations: [{
      id: "runtime.response-security-headers:verified",
      checkId: "runtime.response-security-headers",
      pack: "production-ready",
      area: "runtime",
      kind: "verified-control",
      title: "Core security-header policy observed at runtime",
      summary: "The deployed response established the narrower source question.",
      evidence: [{ kind: "configuration", detail: "Core header names were observed." }],
      resolvesCheckIds: ["production.next-security-headers"]
    }],
    coverage: [
      { area: "configuration", status: "partial", checkIds: ["production.next-security-headers", "runtime.response-security-headers"], detail: "Configuration partially assessed." },
      { area: "runtime", status: "assessed", checkIds: ["runtime.response-security-headers"], detail: "Runtime assessed." }
    ],
    summary: {
      total: findings.length,
      critical: 0,
      high: options.findingSeverity === "high" ? 1 : 0,
      medium: 0,
      low: options.findingSeverity === "low" ? 1 : 0,
      info: 0
    },
    generatedAt: "2026-09-18T13:02:00.000Z"
  });
}

function asScanReport(report: ReturnType<typeof combinedReport>): ScanReport {
  return ScanReportSchema.parse(report);
}

describe("resolved cross-source evidence in assurance adapters", () => {
  it("does not leave a resolved source question as RACK/OOS uncertainty", () => {
    const report = combinedReport();
    const gate = evaluateAssuranceGate(report, {
      gateId: "ship-check-production-ready",
      threshold: "high"
    });
    const rack = toRackStepResult("release-readiness", gate);
    const oos = toOrganisationalAssuranceSummary(report, gate);

    expect(gate.outcome).toBe("pass");
    expect(gate.warnings.some((warning) => warning.includes("not verified"))).toBe(false);
    expect(gate.practiceEvidence).toEqual([]);
    expect(rack.outcome).toBe("pass");
    expect(oos.gate.outcome).toBe("pass");
    expect(oos.counts.unverified).toBe(0);
  });

  it("still fails the gate when a distinct high-severity runtime finding remains", () => {
    const report = combinedReport({ findingSeverity: "high" });
    const gate = evaluateAssuranceGate(report, {
      gateId: "ship-check-production-ready",
      threshold: "high"
    });

    expect(gate.outcome).toBe("fail");
    expect(gate.findings).toContainEqual(expect.objectContaining({
      id: "runtime.response-security-headers:high"
    }));
    expect(gate.practiceEvidence).toContainEqual(expect.objectContaining({
      principleId: "practice.preserve-safety",
      outcome: "fail"
    }));
  });

  it("keeps lower-severity runtime findings visible without recreating a resolved gap", () => {
    const report = combinedReport({ findingSeverity: "low" });
    const gate = evaluateAssuranceGate(report, {
      gateId: "ship-check-production-ready",
      threshold: "high"
    });
    const oos = toOrganisationalAssuranceSummary(report, gate);

    expect(gate.outcome).toBe("pass");
    expect(gate.findings).toContainEqual(expect.objectContaining({ severity: "low" }));
    expect(gate.warnings).toContain("1 finding is below the high gate threshold.");
    expect(oos.counts.low).toBe(1);
    expect(oos.counts.unverified).toBe(0);
  });

  it("remains incomplete when other required evidence is unavailable", () => {
    const report = combinedReport({ includeUnavailableCheck: true });
    const gate = evaluateAssuranceGate(report, {
      gateId: "ship-check-production-ready",
      threshold: "high"
    });

    expect(gate.outcome).toBe("incomplete");
    expect(gate.warnings.some((warning) => warning.includes("dependency-manifests"))).toBe(true);
  });

  it("stays compatible when the extended report is viewed through the base ScanReport contract", () => {
    const base = asScanReport(combinedReport());
    const gate = evaluateAssuranceGate(base, {
      gateId: "ship-check-production-ready",
      threshold: "high"
    });

    expect(gate.outcome).toBe("pass");
    expect(base.checks.find((check) => check.status === "resolved")?.resolvedGapCount).toBe(1);
  });
});
