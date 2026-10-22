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

  it("renders positive observations separately from confirmed findings and makes their evidence visible", () => {
    const data = report();
    data.observations = [
      {
        id: "production.server-surface-inventory:scheduled-routes",
        checkId: "production.server-surface-inventory",
        pack: "production-ready",
        area: "cost",
        kind: "inventory",
        title: "Scheduled server surfaces discovered",
        summary: "Seven Vercel cron routes declared; authentication was not inferred.",
        evidence: [{ kind: "configuration", path: "vercel.json", detail: "Scheduled routes declared." }]
      },
      {
        id: "runtime.security-headers:present",
        checkId: "runtime.security-headers",
        pack: "production-ready",
        area: "runtime",
        kind: "verified-control",
        title: "Runtime policy inspected",
        summary: "A bounded live response check returned evidence for this control.",
        evidence: [{ kind: "configuration", detail: "HTTP response headers." }]
      }
    ];
    const markdown = renderReportMarkdown(data);
    expect(markdown).toContain("2** observations");
    expect(markdown).toContain("## Evidence observed");
    expect(markdown).toContain("Verified control · Runtime policy inspected");
    expect(markdown).toContain("Observed · Scheduled server surfaces discovered");
    expect(markdown).toContain("Evidence: vercel.json");
    expect(markdown).toContain("not automatic proof of safety");
  });

  it("provides a runnable next-evidence route for source-only Next.js header questions", () => {
    const data = report();
    data.findings = [];
    data.summary.total = 0;
    data.summary.high = 0;
    data.gaps = [{
      id: "production.next-security-headers:next.config.ts",
      checkId: "production.next-security-headers",
      pack: "production-ready",
      area: "configuration",
      title: "Security headers are not verified from repository evidence",
      summary: "No recognisable policy in the scanned Next.js config.",
      evidence: [{ kind: "file-presence", path: "next.config.ts", detail: "Project configuration." }],
      verify: "Check deployed headers."
    }];
    const markdown = renderReportMarkdown(data);
    expect(markdown).toContain("## Suggested next evidence");
    expect(markdown).toContain("--deployment-url https://your-site.example");
    expect(markdown).toContain("source snapshot and deployment");
  });

  it("distinguishes answered questions, collected sources and a newly confirmed runtime finding", () => {
    const data = report() as ScanReport & {
      project: ScanReport["project"] & { evidenceSources?: Array<{
        schemaVersion: "0.1"; id: string; type: "source" | "deployment"; provider: "local" | "web";
        label: string; acquisition: "local" | "runtime-probe"; executionLocation: "user-device";
        capabilities: Array<"source-files" | "runtime-http">; ephemeral: boolean; acquiredAt: string;
      }> };
      resolvedGaps?: Array<{gap: ScanReport["gaps"][number];resolvedByObservationIds:string[];resolvedByCheckIds:string[];summary:string}>;
    };
    const now = new Date().toISOString();
    data.project.evidenceSources = [
      { schemaVersion:"0.1", id:"source-1", type:"source", provider:"local", label:"local checkout", acquisition:"local", executionLocation:"user-device", capabilities:["source-files"], ephemeral:false, acquiredAt:now },
      { schemaVersion:"0.1", id:"deployment-1", type:"deployment", provider:"web", label:"live website", acquisition:"runtime-probe", executionLocation:"user-device", capabilities:["runtime-http"], ephemeral:true, acquiredAt:now }
    ];
    data.resolvedGaps = [{
      gap: {
        id:"production.next-security-headers:next.config.ts",checkId:"production.next-security-headers",pack:"production-ready",area:"configuration",
        title:"Security headers not verified", summary:"Source alone was insufficient.",
        evidence:[{kind:"configuration",path:"next.config.ts",detail:"No recognised source policy."}],verify:"Check deployed response."
      },
      resolvedByObservationIds:["runtime.security-headers:observed"],resolvedByCheckIds:["runtime.security-headers"],
      summary:"Deployment response provided evidence for the question."
    }];
    const markdown=renderReportMarkdown(data);
    expect(markdown).toContain("## Evidence sources");
    expect(markdown).toContain("local checkout");
    expect(markdown).toContain("live website");
    expect(markdown).toContain("may not correspond to the live deployment version");
    expect(markdown).toContain("## Questions answered by additional evidence");
    expect(markdown).toContain("not necessarily a passed control");
    expect(markdown).not.toContain("## Suggested next evidence");
  });

  it("caps observations in Markdown but keeps the full result available in JSON", () => {
    const data = report();
    data.observations = Array.from({length:13},(_,i)=>({
      id: "observation-" + i,checkId:"production.server-surface-inventory",pack:"production-ready" as const,area:"cost" as const,
      kind:"inventory" as const,title:"Inventory " + i,summary:"Scanned surface.",
      evidence:[{kind:"configuration" as const,detail:"Bounded source."}]
    }));
    const markdown=renderReportMarkdown(data);
    expect(markdown).toContain("and 1 more observations");
    expect(markdown).toContain("--format json");
  });


  it("recognises scanner availability gaps", () => {
    expect(isUnavailableScannerGap(report().gaps[0]!)).toBe(true);
  });
});
