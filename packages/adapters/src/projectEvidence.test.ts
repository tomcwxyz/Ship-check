import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "@ship-check/schemas";
import { evaluateAssuranceGate } from "./index.js";

describe("assurance with unavailable evidence", () => {
  it("does not turn an unassessed source check into a pass", () => {
    const report = ScanReportSchema.parse({
      schemaVersion: "0.1",
      tool: { name: "ship-check", version: "0.0.0-test" },
      project: {
        path: "https://example.test",
        gitRepository: false,
        inventorySource: "filesystem",
        fileCount: 1
      },
      packs: ["secure-build"],
      checks: [{
        checkId: "secure.source-only",
        checkVersion: "1",
        pack: "secure-build",
        principles: ["practice.preserve-safety"],
        status: "not-assessed",
        missingEvidence: ["source-files"],
        findingCount: 0,
        suppressedCount: 0,
        gapCount: 0,
        observationCount: 0,
        durationMs: 1
      }],
      findings: [],
      suppressedFindings: [],
      gaps: [],
      observations: [],
      coverage: [],
      summary: {
        total: 0,
        suppressed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      },
      generatedAt: "2026-09-17T20:00:00.000Z"
    });

    const gate = evaluateAssuranceGate(report, {
      gateId: "ship-check-secure-build",
      threshold: "high"
    });

    expect(gate.outcome).toBe("incomplete");
    expect(gate.warnings.join(" ")).toMatch(/required evidence was unavailable/i);
    expect(gate.practiceEvidence[0]?.outcome).toBe("incomplete");
  });
});
