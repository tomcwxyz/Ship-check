import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "@ship-check/schemas";
import { evaluateAssuranceGate, toOrganisationalAssuranceSummary, toRackStepResult } from "./index.js";

const finding = {
  id: "cost.vercel-cron-frequency:0:/api/cron/heartbeat",
  checkId: "cost.vercel-cron-frequency",
  pack: "cost-aware" as const,
  title: "Scheduled server work runs more often than hourly",
  summary: "A five-minute schedule was detected.",
  severity: "medium" as const,
  confidence: "high" as const,
  evidence: [{ kind: "configuration" as const, path: "vercel.json", detail: "Five-minute schedule." }],
  remediation: {
    why: "Frequent schedules consume compute.",
    fix: "Use the lowest useful cadence.",
    verify: "Measure invocation volume.",
    agentPrompt: "Review the scheduler cadence."
  }
};

describe("suppressed assurance evidence", () => {
  it("does not fail a gate but warns RACK that an accepted exception exists", () => {
    const report = ScanReportSchema.parse({
      schemaVersion: "0.1",
      tool: { name: "ship-check", version: "test" },
      project: { path: "/tmp/example", gitRepository: true, inventorySource: "git-tracked", fileCount: 3 },
      packs: ["cost-aware"],
      checks: [{
        checkId: "cost.vercel-cron-frequency",
        checkVersion: "2",
        pack: "cost-aware",
        principles: ["practice.cost-discipline"],
        status: "suppressed",
        findingCount: 0,
        suppressedCount: 1,
        durationMs: 1
      }],
      findings: [],
      suppressedFindings: [{
        finding,
        checkVersion: "2",
        rationale: "This lightweight heartbeat is measured and intentionally kept at five minutes.",
        configPath: ".ship-check.json"
      }],
      summary: { total: 0, suppressed: 1, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      generatedAt: "2026-09-08T13:30:00.000Z"
    });

    const gate = evaluateAssuranceGate(report, { gateId: "ship-check-cost-aware", threshold: "medium" });
    const rack = toRackStepResult("cost-review", gate);
    const oos = toOrganisationalAssuranceSummary(report, gate);

    expect(gate.outcome).toBe("pass");
    expect(gate.findings).toEqual([]);
    expect(gate.practiceEvidence).toEqual([]);
    expect(gate.warnings.join(" ")).toMatch(/explicitly suppressed/);
    expect(rack.outcome).toBe("pass");
    expect(oos.counts.suppressed).toBe(1);
    expect(JSON.stringify(rack)).not.toContain("lightweight heartbeat");
  });
});
