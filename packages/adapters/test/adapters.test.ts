import { describe, expect, it } from "vitest";
import type { ScanReport } from "@ship-check/schemas";
import {
  buildTopoAssuranceContextRequest,
  evaluateAssuranceGate,
  toOrganisationalAssuranceSummary,
  toRackStepResult
} from "../src/index.js";

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "0.0.0-alpha.1" },
    project: { path: "/tmp/example", gitRepository: true, fileCount: 12 },
    packs: ["secure-build", "production-ready", "cost-aware"],
    checks: [],
    findings: [],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    generatedAt: "2026-09-04T10:00:00.000Z",
    ...overrides
  };
}

describe("RACK assurance adapter", () => {
  it("fails a gate when a finding meets the configured threshold", () => {
    const input = report({
      checks: [{ checkId: "secure.example", pack: "secure-build", status: "findings", findingCount: 1, durationMs: 1 }],
      findings: [{
        id: "secure.example:one",
        checkId: "secure.example",
        pack: "secure-build",
        title: "Example risk",
        summary: "Example",
        severity: "high",
        confidence: "high",
        evidence: [{ kind: "repository", detail: "Evidence" }],
        remediation: { why: "Why", fix: "Fix", verify: "Verify", agentPrompt: "Repair" }
      }],
      summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }
    });

    const gate = evaluateAssuranceGate(input, {
      gateId: "ship-check-secure-build",
      threshold: "high"
    });
    expect(gate.outcome).toBe("fail");
    expect(toRackStepResult("security", gate)).toMatchObject({
      stepId: "security",
      check: "ship-check-secure-build",
      outcome: "fail"
    });
  });

  it("marks an omitted requested pack as incomplete rather than passing", () => {
    const gate = evaluateAssuranceGate(report({ packs: ["secure-build"] }), {
      gateId: "ship-check-cost-aware"
    });
    expect(gate.outcome).toBe("incomplete");
  });
});

describe("ecosystem context adapters", () => {
  it("builds a TOPO-compatible purpose-bound request without source content", () => {
    const request = buildTopoAssuranceContextRequest({
      subject: "user-1",
      projectPath: "attention-agent-pilot",
      packs: ["secure-build", "cost-aware"]
    });
    expect(request.requestedBy).toBe("ship-check");
    expect(request.purpose).toContain("must never override deterministic Ship Check evidence");
    expect(request.query).toContain("attention-agent-pilot");
  });

  it("produces metadata-only organisational assurance summaries", () => {
    const input = report();
    const gate = evaluateAssuranceGate(input, { gateId: "ship-check" });
    expect(toOrganisationalAssuranceSummary(input, gate)).toMatchObject({
      protocol: "oos/0.1-draft",
      type: "technical-assurance",
      provider: "ship-check",
      counts: { findings: 0, checkErrors: 0 }
    });
  });
});
