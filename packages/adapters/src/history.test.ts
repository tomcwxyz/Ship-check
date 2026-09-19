import { describe, expect, it } from "vitest";
import { ScanReportSchema } from "@ship-check/schemas";
import { MultiSourceScanReportSchema } from "@ship-check/schemas/multiSource";
import { toProjectHistoryMetadata } from "./history.js";

const generatedAt = "2026-09-19T09:00:00.000Z";

function sourceReport() {
  return ScanReportSchema.parse({
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "0.0.0-alpha.7" },
    project: {
      path: "/Users/tom/private-client",
      gitRepository: true,
      inventorySource: "git-tracked",
      fileCount: 2,
      commit: "a".repeat(40),
      snapshot: {
        schemaVersion: "0.1",
        id: "11111111-1111-4111-8111-111111111111",
        source: {
          schemaVersion: "0.1",
          id: "local:/Users/tom/private-client",
          type: "source",
          provider: "local",
          label: "/Users/tom/private-client",
          acquisition: "local",
          executionLocation: "user-device",
          capabilities: ["source-files", "git-history"],
          ephemeral: false,
          acquiredAt: generatedAt,
          ref: "secret-client-branch"
        },
        inventory: {
          source: "git-tracked",
          fileCount: 2,
          commit: "a".repeat(40),
          fingerprint: {
            algorithm: "sha256",
            scope: "source-inventory-v1",
            value: "b".repeat(64),
            completeness: "complete",
            entryCount: 2,
            hashedEntryCount: 2,
            skippedEntryCount: 0
          }
        }
      }
    },
    packs: ["secure-build", "production-ready"],
    checks: [
      {
        checkId: "secure.secret-pattern",
        checkVersion: "1",
        pack: "secure-build",
        status: "findings",
        findingCount: 1,
        durationMs: 1
      },
      {
        checkId: "production.next-security-headers",
        checkVersion: "1",
        pack: "production-ready",
        status: "unverified",
        findingCount: 0,
        gapCount: 1,
        durationMs: 1
      },
      {
        checkId: "production.server-surface-inventory",
        checkVersion: "2",
        pack: "production-ready",
        status: "passed",
        findingCount: 0,
        observationCount: 1,
        durationMs: 1
      },
      {
        checkId: "production.unavailable",
        checkVersion: "1",
        pack: "production-ready",
        status: "not-assessed",
        missingEvidence: ["runtime-http"],
        findingCount: 0,
        durationMs: 0
      }
    ],
    ruleset: {
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      value: "c".repeat(64),
      checkCount: 4
    },
    findings: [{
      id: "secure.secret-pattern:src/private.ts:2:key",
      checkId: "secure.secret-pattern",
      pack: "secure-build",
      title: "Private credential concern",
      summary: "Sensitive detail that must not enter metadata.",
      severity: "high",
      confidence: "high",
      evidence: [{
        kind: "file-match",
        path: "src/private.ts",
        line: 2,
        detail: "Sensitive evidence detail."
      }],
      remediation: {
        why: "Sensitive why.",
        fix: "Sensitive fix.",
        verify: "Sensitive verify.",
        agentPrompt: "Sensitive repair prompt."
      }
    }],
    suppressedFindings: [{
      finding: {
        id: "production.accepted:private",
        checkId: "production.next-security-headers",
        pack: "production-ready",
        title: "Accepted private concern",
        summary: "Accepted private detail.",
        severity: "low",
        confidence: "medium",
        evidence: [{ kind: "configuration", path: "next.config.ts", detail: "Private config." }],
        remediation: {
          why: "why",
          fix: "fix",
          verify: "verify",
          agentPrompt: "prompt"
        }
      },
      checkVersion: "1",
      rationale: "Private rationale that must never enter timeline metadata.",
      configPath: ".ship-check.json"
    }],
    gaps: [{
      id: "production.next-security-headers:next.config.ts",
      checkId: "production.next-security-headers",
      pack: "production-ready",
      area: "configuration",
      title: "Private unanswered control",
      summary: "Private gap detail.",
      evidence: [{ kind: "configuration", path: "next.config.ts", detail: "No local proof." }],
      verify: "Inspect deployed response."
    }],
    observations: [{
      id: "production.server-surface-inventory:api",
      checkId: "production.server-surface-inventory",
      pack: "production-ready",
      area: "access-control",
      kind: "inventory",
      title: "Private route inventory",
      summary: "Private observation detail.",
      evidence: [{ kind: "file-presence", path: "app/api/private/route.ts", detail: "Private route." }]
    }],
    coverage: [
      { area: "secrets", status: "assessed", checkIds: ["secure.secret-pattern"], detail: "Private coverage detail." },
      { area: "configuration", status: "partial", checkIds: ["production.next-security-headers"], detail: "Private coverage detail." }
    ],
    summary: {
      total: 1,
      suppressed: 1,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0
    },
    generatedAt
  });
}

function runtimeReport(url: string) {
  return ScanReportSchema.parse({
    ...sourceReport(),
    project: {
      path: url,
      gitRepository: false,
      inventorySource: "filesystem",
      fileCount: 0,
      snapshot: {
        schemaVersion: "0.1",
        id: "22222222-2222-4222-8222-222222222222",
        source: {
          schemaVersion: "0.1",
          id: `url:${url}`,
          type: "deployment",
          provider: "url",
          label: url,
          acquisition: "runtime-probe",
          executionLocation: "user-device",
          capabilities: ["runtime-http"],
          ephemeral: true,
          acquiredAt: generatedAt
        },
        inventory: {
          source: "filesystem",
          fileCount: 0
        }
      }
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
    }
  });
}

describe("project history metadata adapter", () => {
  it("emits deterministic metadata without source paths, findings or evidence details", () => {
    const report = sourceReport();
    const first = toProjectHistoryMetadata(report);
    const second = toProjectHistoryMetadata(report);
    const serialised = JSON.stringify(first);

    expect(first.project.identity).toMatchObject({
      algorithm: "sha256",
      scope: "project-source-v1"
    });
    expect(first.project.identity.value).toMatch(/^[a-f0-9]{64}$/);
    expect(first.scan.identity.value).toMatch(/^[a-f0-9]{64}$/);
    expect(second.scan.identity.value).toBe(first.scan.identity.value);
    expect(first.project.identity.value).toBe(second.project.identity.value);
    expect(first.project.identityBasis).toBe("primary-evidence");
    expect(first.project.evidenceSources).toEqual([{
      type: "source",
      provider: "local",
      acquisition: "local",
      executionLocation: "user-device",
      capabilities: ["git-history", "source-files"]
    }]);
    expect(first.counts).toMatchObject({
      findings: 1,
      suppressed: 1,
      high: 1,
      unverified: 1,
      observed: 1,
      notAssessed: 1,
      checkErrors: 0
    });
    expect(first.coverage).toEqual([
      { area: "secrets", status: "assessed", checkCount: 1 },
      { area: "configuration", status: "partial", checkCount: 1 }
    ]);

    expect(serialised).not.toContain("/Users/tom/private-client");
    expect(serialised).not.toContain("secret-client-branch");
    expect(serialised).not.toContain("secure.secret-pattern:src/private.ts");
    expect(serialised).not.toContain("Private credential concern");
    expect(serialised).not.toContain("Private rationale");
    expect(serialised).not.toContain("app/api/private/route.ts");
    expect(serialised).not.toContain("Private coverage detail");
  });

  it("changes scan identity for a new scan while retaining project identity", () => {
    const firstReport = sourceReport();
    const secondReport = ScanReportSchema.parse({
      ...firstReport,
      generatedAt: "2026-09-19T09:05:00.000Z"
    });

    const first = toProjectHistoryMetadata(firstReport);
    const second = toProjectHistoryMetadata(secondReport);

    expect(second.project.identity.value).toBe(first.project.identity.value);
    expect(second.scan.identity.value).not.toBe(first.scan.identity.value);
  });

  it("drops deployment query strings from project identity but keeps distinct paths distinct", () => {
    const first = toProjectHistoryMetadata(runtimeReport("https://example.com/app?token=one"));
    const samePath = toProjectHistoryMetadata(runtimeReport("https://example.com/app?token=two"));
    const otherPath = toProjectHistoryMetadata(runtimeReport("https://example.com/other?token=three"));

    expect(samePath.project.identity.value).toBe(first.project.identity.value);
    expect(otherPath.project.identity.value).not.toBe(first.project.identity.value);
    expect(JSON.stringify(first)).not.toContain("token=one");
  });

  it("allows a caller-provided opaque association key across different evidence sources", () => {
    const source = toProjectHistoryMetadata(sourceReport(), { projectIdentityKey: "cloud-project-123" });
    const runtime = toProjectHistoryMetadata(runtimeReport("https://example.com"), { projectIdentityKey: "cloud-project-123" });

    expect(source.project.identityBasis).toBe("caller-provided");
    expect(runtime.project.identityBasis).toBe("caller-provided");
    expect(runtime.project.identity.value).toBe(source.project.identity.value);
    expect(JSON.stringify(source)).not.toContain("cloud-project-123");
  });

  it("summarises multi-source provenance without source IDs, labels or refs", () => {
    const primary = sourceReport();
    const runtime = runtimeReport("https://example.com/private?token=secret");
    const combined = MultiSourceScanReportSchema.parse({
      ...primary,
      project: {
        ...primary.project,
        evidenceSources: [
          primary.project.snapshot!.source,
          runtime.project.snapshot!.source
        ]
      },
      resolvedGaps: []
    });

    const metadata = toProjectHistoryMetadata(combined);
    expect(metadata.project.evidenceSources).toHaveLength(2);
    expect(metadata.project.evidenceSources.map((source) => source.type).sort()).toEqual(["deployment", "source"]);
    expect(JSON.stringify(metadata)).not.toContain("https://example.com/private");
    expect(JSON.stringify(metadata)).not.toContain("local:/Users/tom/private-client");
  });

  it("accepts bounded change metadata but never needs raw finding IDs", () => {
    const metadata = toProjectHistoryMetadata(sourceReport(), {
      change: {
        basis: "previous-comparable-scan",
        sourceSnapshot: "changed",
        findings: {
          introduced: 1,
          persistent: 2,
          reactivated: 0,
          accepted: 1,
          noLongerActive: 1
        },
        gaps: {
          introduced: 1,
          persistent: 1,
          noLongerActive: 0
        },
        surfaces: {
          introduced: 2,
          persistent: 3,
          noLongerObserved: 1
        }
      }
    });

    expect(metadata.change?.findings).toEqual({
      introduced: 1,
      persistent: 2,
      reactivated: 0,
      accepted: 1,
      noLongerActive: 1
    });
  });

  it("refuses legacy reports without ruleset provenance", () => {
    const legacy = sourceReport();
    delete (legacy as { ruleset?: unknown }).ruleset;

    expect(() => toProjectHistoryMetadata(legacy))
      .toThrow(/requires stable ruleset provenance/i);
  });
});
