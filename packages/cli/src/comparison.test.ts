import { describe, expect, it } from "vitest";
import type { Finding, ScanReport } from "@ship-check/schemas";
import { compareScanReports, renderComparisonMarkdown } from "./comparison.js";

function finding(id: string, title: string, severity: Finding["severity"] = "high"): Finding {
  return {
    id,
    checkId: "secure.example",
    pack: "secure-build",
    title,
    summary: title,
    severity,
    confidence: "high",
    evidence: [{ kind: "repository", detail: "example" }],
    remediation: {
      why: "why",
      fix: "fix",
      verify: "verify",
      agentPrompt: "repair"
    }
  };
}

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  const base: ScanReport = {
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "test" },
    project: {
      path: "fixture",
      gitRepository: true,
      inventorySource: "git-tracked",
      fileCount: 1
    },
    packs: ["secure-build"],
    checks: [{
      checkId: "secure.example",
      checkVersion: "1",
      pack: "secure-build",
      principles: [],
      status: "passed",
      missingEvidence: [],
      findingCount: 0,
      suppressedCount: 0,
      gapCount: 0,
      observationCount: 0,
      durationMs: 1
    }],
    ruleset: {
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      value: "a".repeat(64),
      checkCount: 1
    },
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
    generatedAt: new Date().toISOString()
  };
  return { ...base, ...overrides } as ScanReport;
}

describe("portable scan comparison", () => {
  it("distinguishes introduced, persistent, reactivated, accepted and no-longer-active findings", () => {
    const base = report({
      findings: [
        finding("persistent", "Persistent"),
        finding("old", "Old"),
        finding("accepted-next", "Will be accepted")
      ],
      suppressedFindings: [{
        finding: finding("reactivated", "Was accepted"),
        checkVersion: "1",
        rationale: "Accepted for a bounded test window.",
        configPath: ".ship-check.json"
      }]
    });
    const current = report({
      findings: [
        finding("persistent", "Persistent"),
        finding("new", "New", "critical"),
        finding("reactivated", "Was accepted")
      ],
      suppressedFindings: [{
        finding: finding("accepted-next", "Will be accepted"),
        checkVersion: "1",
        rationale: "Accepted for a bounded test window.",
        configPath: ".ship-check.json"
      }]
    });

    const comparison = compareScanReports(base, current);
    expect(comparison.comparable).toBe(true);
    if (!comparison.comparable) return;

    expect(comparison.findings.introduced.map((item) => item.id)).toEqual(["new"]);
    expect(comparison.findings.persistent.map((item) => item.id)).toEqual(["persistent"]);
    expect(comparison.findings.reactivated.map((item) => item.id)).toEqual(["reactivated"]);
    expect(comparison.findings.accepted.map((item) => item.id)).toEqual(["accepted-next"]);
    expect(comparison.findings.noLongerActive.map((item) => item.id)).toEqual(["old"]);

    const markdown = renderComparisonMarkdown(comparison);
    expect(markdown).toContain("1 introduced");
    expect(markdown).toContain("NO LONGER ACTIVE");
    expect(markdown).toContain("not proof");
  });

  it("refuses comparison when rulesets differ", () => {
    const current = report({
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: "b".repeat(64),
        checkCount: 1
      }
    });
    const comparison = compareScanReports(report(), current);
    expect(comparison).toMatchObject({ comparable: false });
  });
});
