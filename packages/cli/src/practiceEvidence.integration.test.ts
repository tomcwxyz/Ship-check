import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateAssuranceGate, toRackStepResult } from "@ship-check/adapters";
import { builtInChecks } from "@ship-check/checks";
import { scanProject } from "@ship-check/core";
import { costAwareChecks } from "@ship-check/cost-checks";

const riskyFixture = fileURLToPath(new URL("../../../test-fixtures/risky-next", import.meta.url));

describe("practice evidence integration", () => {
  it("scans a real fixture and carries shared practice evidence into RACK output", async () => {
    const report = await scanProject(riskyFixture, [...builtInChecks, ...costAwareChecks], "test");
    const gate = evaluateAssuranceGate(report, { gateId: "ship-check", threshold: "high" });
    const step = toRackStepResult("practice-loop", gate);

    expect(report.checks.some((check) => check.principles.includes("practice.preserve-safety"))).toBe(true);
    expect(step.providerResult.practiceEvidence.some((item) =>
      item.principleId === "practice.preserve-safety" && item.outcome === "fail"
    )).toBe(true);
  });
});
