import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "@ship-check/schemas";
import { evaluateAssuranceGate, toRackStepResult } from "./index.js";

describe("practice evidence hand-off", () => {
  it("carries principle-linked deterministic concerns into the RACK step result", () => {
    const report = ScanReportSchema.parse({
      schemaVersion: "0.1",
      tool: { name: "ship-check", version: "test" },
      project: {
        path: "/tmp/example",
        gitRepository: true,
        inventorySource: "git-tracked",
        fileCount: 3
      },
      packs: ["secure-build", "production-ready"],
      checks: [
        {
          checkId: "secure.secret-pattern",
          pack: "secure-build",
          principles: ["practice.preserve-safety"],
          status: "findings",
          findingCount: 1,
          durationMs: 1
        },
        {
          checkId: "production.package-lock-discipline",
          pack: "production-ready",
          principles: ["practice.dependency-restraint"],
          status: "passed",
          findingCount: 0,
          durationMs: 1
        }
      ],
      findings: [
        {
          id: "secure.secret-pattern:example",
          checkId: "secure.secret-pattern",
          pack: "secure-build",
          title: "Possible live credential in source",
          summary: "Credential-shaped source was detected.",
          severity: "critical",
          confidence: "high",
          evidence: [{ kind: "file-match", path: "app.ts", detail: "Value redacted." }],
          remediation: {
            why: "Secrets must not be committed.",
            fix: "Rotate and remove the credential.",
            verify: "Rerun the scanner.",
            agentPrompt: "Remove the credential without printing it."
          }
        }
      ],
      summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      generatedAt: "2026-09-06T09:00:00.000Z"
    });

    const gate = evaluateAssuranceGate(report, { gateId: "ship-check", threshold: "high" });
    const step = toRackStepResult("practice-loop", gate);

    expect(step.outcome).toBe("fail");
    expect(step.providerResult.findings[0]?.principles).toEqual(["practice.preserve-safety"]);
    expect(step.providerResult.practiceEvidence).toEqual([
      {
        principleId: "practice.preserve-safety",
        outcome: "fail",
        findingIds: ["secure.secret-pattern:example"],
        checkIds: ["secure.secret-pattern"],
        summary: "1 finding at or above the high threshold provides evidence against this practice principle."
      }
    ]);
    expect(step.providerResult.practiceEvidence.some((item) => item.principleId === "practice.dependency-restraint")).toBe(false);
  });
});
