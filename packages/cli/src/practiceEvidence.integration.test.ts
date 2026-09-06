import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAssuranceGate, toRackStepResult } from "@ship-check/adapters";
import { builtInChecks } from "@ship-check/checks";
import { scanProject } from "@ship-check/core";
import { costAwareChecks } from "@ship-check/cost-checks";

const riskyFixture = fileURLToPath(new URL("../../../test-fixtures/risky-next", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("practice evidence integration", () => {
  it("scans a real fixture and carries shared practice evidence into RACK output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-practice-evidence-"));
    temporaryRoots.push(root);
    await fs.cp(riskyFixture, root, { recursive: true });

    const report = await scanProject(root, [...builtInChecks, ...costAwareChecks], "test");
    const gate = evaluateAssuranceGate(report, { gateId: "ship-check", threshold: "high" });
    const step = toRackStepResult("practice-loop", gate);

    expect(report.checks.some((check) => check.principles.includes("practice.preserve-safety"))).toBe(true);
    expect(step.providerResult.practiceEvidence.some((item) =>
      item.principleId === "practice.preserve-safety" && item.outcome === "fail"
    )).toBe(true);
  });
});
