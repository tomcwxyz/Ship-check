import { describe, expect, it } from "vitest";
import type { ScanReport } from "@ship-check/schemas";
import { isUnavailableScannerGap, renderReportMarkdown } from "./reportMarkdown.js";

function report(): ScanReport {
  return {
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "0.0.0-alpha.9" },
    project: {
      path: "example",
      gitRepository: true,
      inventorySource: "git-tracked",
      fileCount: 2,
      context: { status: "live", ownership: "owned" }
    },
    packs: ["secure-build", "production-ready"],
    checks: [{
      checkId: "production.osv-vulnerabilities",
      checkVersion: "1",
      pack: "production-ready",
      principles: [],
      status: "unverified",
      missingEvidence: [],
      findingCount: 0,
      suppressedCount: 0,
      gapCount: 1,
      observationCount: 0,
      durationMs: 1
    }],
    findings: [{
      id: "secure.example:app.ts:1",
      checkId: "secure.example",
      pack: "secure-build",
      title: "Example concern",
      summary: "Evidence supports a concrete concern.",
      severity: "high",
      confidence: "high",
      evidence: [{ kind: "file-match", path: "app.ts", line: 1, detail: "Example evidence." }],
      remediation: {
        why: "It matters.",
        fix: "Fix it narrowly.",
        verify: "Rerun the test and Ship Check.",
        agentPrompt: "Repair the specific concern without unrelated changes."
      }
    }],
    suppressedFindings: [],
    gaps: [{
      id: "production.osv-vulnerabilities:osv-unavailable",
      checkId: "production.osv-vulnerabilities",
      pack: "production-ready",
      area: "supply-chain",
      title: "OSV dependency scanner is unavailable",
      summary: "The requested scan could not run.",
      evidence: [{ kind: "configuration", detail: "Scanner missing." }],
      verify: "Install the pinned scanner and rerun."
    }],
    observations: [],
    coverage: [{
      area: "supply-chain",
      status: "partial",
      checkIds: ["production.osv-vulnerabilities"],
      detail: "Dependency evidence is incomplete."
    }],
    summary: {
      total: 1,
      suppressed: 0,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0
    },
    generatedAt: new Date().toISOString()
  };
}

describe("Markdown handoff", () => {
  it("keeps deterministic findings, unavailable evidence and declared context distinct", () => {
    const markdown = renderReportMarkdown(report());

    expect(markdown).toContain("Declared project context — status: live · ownership: owned");
    expect(markdown).toContain("Evidence that could not be collected");
    expect(markdown).toContain("Do not treat the affected areas as assessed");
    expect(markdown).toContain("[HIGH] Example concern");
    expect(markdown).toContain("Agent instruction:");
    expect(markdown).toContain("Keep any agent judgement");
  });

  it("recognises scanner availability gaps", () => {
    expect(isUnavailableScannerGap(report().gaps[0]!)).toBe(true);
  });
});
