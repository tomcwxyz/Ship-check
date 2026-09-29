import { describe, expect, it } from "vitest";
import type { ScanReport } from "@ship-check/schemas";
import { renderFocusedReview, selectFocusedReview } from "./focus.js";

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    schemaVersion: "0.1",
    generatedAt: "2026-09-29T00:00:00.000Z",
    engine: { name: "ship-check", version: "test" },
    project: {
      path: ".",
      inventorySource: "filesystem",
      fileCount: 1
    },
    packs: ["secure-build"],
    checks: [
      {
        checkId: "secure.example",
        checkVersion: "3",
        pack: "secure-build",
        title: "Example",
        status: "completed",
        findings: 0,
        gaps: 0,
        observations: 0,
        coverage: []
      }
    ],
    findings: [],
    gaps: [],
    observations: [],
    suppressedFindings: [],
    resolvedGaps: [],
    coverage: [],
    summary: {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    },
    ...overrides
  } as ScanReport;
}

describe("focused review", () => {
  it("selects the highest-severity active finding before unanswered controls", () => {
    const result = selectFocusedReview(
      report({
        findings: [
          {
            id: "low",
            checkId: "secure.example",
            pack: "secure-build",
            title: "Low finding",
            summary: "Lower-priority confirmed evidence.",
            severity: "low",
            confidence: "high",
            evidence: [{ kind: "configuration", detail: "low evidence" }],
            remediation: {
              why: "why",
              fix: "fix low",
              verify: "verify low",
              agentPrompt: "agent low"
            }
          },
          {
            id: "critical",
            checkId: "secure.example",
            pack: "secure-build",
            title: "Critical finding",
            summary: "Higher-priority confirmed evidence.",
            severity: "critical",
            confidence: "high",
            evidence: [{ kind: "configuration", detail: "critical evidence" }],
            remediation: {
              why: "why",
              fix: "fix critical",
              verify: "verify critical",
              agentPrompt: "agent critical"
            }
          }
        ],
        gaps: [
          {
            id: "gap",
            checkId: "secure.example",
            pack: "secure-build",
            area: "secrets",
            title: "Question",
            summary: "Needs verification.",
            evidence: [{ kind: "configuration", detail: "gap evidence" }],
            verify: "verify gap"
          }
        ]
      })
    );

    expect(result).toMatchObject({
      type: "finding",
      action: "fix",
      id: "critical",
      checkVersion: "3",
      severity: "critical"
    });
  });

  it("surfaces an unanswered control as verify when no active finding exists", () => {
    const result = selectFocusedReview(
      report({
        gaps: [
          {
            id: "gap",
            checkId: "secure.example",
            pack: "secure-build",
            area: "configuration",
            title: "Verify this boundary",
            summary: "The repository cannot establish this control.",
            evidence: [{ kind: "configuration", detail: "missing evidence" }],
            verify: "Inspect deployment configuration."
          }
        ]
      })
    );

    expect(result).toMatchObject({
      type: "unverified",
      action: "verify",
      id: "gap",
      checkVersion: "3"
    });
    expect(renderFocusedReview(result)).toContain(
      "question to verify, not a confirmed defect"
    );
  });

  it("does not turn an empty focused queue into a clean bill of health", () => {
    const result = selectFocusedReview(report());

    expect(result).toMatchObject({ type: "none", action: "none" });
    expect(renderFocusedReview(result)).toContain("not a clean bill of health");
    expect(result.summary).toContain("Review coverage");
  });
});
