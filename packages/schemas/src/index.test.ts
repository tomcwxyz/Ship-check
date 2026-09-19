import { describe, expect, it } from "vitest";
import { CloudAccountSchema, CloudAuthenticatedPrincipalSchema, CloudHistoryIngestRequestSchema, CloudProjectConnectRequestSchema, CloudProjectNameUpdateRequestSchema, CloudProjectSchema, CloudRetentionUpdateRequestSchema, ProjectHistoryMetadataSchema, ProjectHistoryTimelineSchema, ScanReportSchema, ShipCheckConfigSchema } from "./index.js";

const baseReport = {
  schemaVersion: "0.1" as const,
  tool: { name: "ship-check" as const, version: "0.0.0-alpha.6" },
  project: {
    path: "/tmp/project",
    gitRepository: true,
    inventorySource: "git-tracked" as const,
    fileCount: 10,
  },
  packs: ["secure-build" as const],
  checks: [
    {
      checkId: "secure.example",
      pack: "secure-build" as const,
      status: "passed" as const,
      findingCount: 0,
      durationMs: 2,
    },
  ],
  findings: [],
  summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  generatedAt: "2026-09-04T19:45:00.000Z",
};

const suppressedFinding = {
  id: "secure.example:demo",
  checkId: "secure.example",
  pack: "secure-build" as const,
  title: "Example concern",
  summary: "An example finding exists.",
  severity: "high" as const,
  confidence: "high" as const,
  evidence: [{ kind: "file-match" as const, path: "app.ts", detail: "Example evidence." }],
  remediation: {
    why: "Example risk.",
    fix: "Fix it.",
    verify: "Verify it.",
    agentPrompt: "Repair the example concern."
  }
};

describe("ScanReportSchema", () => {
  it("accepts explicit inventory provenance and supplies additive evidence defaults", () => {
    const report = ScanReportSchema.parse(baseReport);
    expect(report.project.inventorySource).toBe("git-tracked");
    expect(report.gaps).toEqual([]);
    expect(report.observations).toEqual([]);
    expect(report.suppressedFindings).toEqual([]);
    expect(report.coverage).toEqual([]);
    expect(report.checks[0]?.checkVersion).toBe("1");
    expect(report.checks[0]?.suppressedCount).toBe(0);
    expect(report.checks[0]?.gapCount).toBe(0);
    expect(report.checks[0]?.observationCount).toBe(0);
    expect(report.summary.suppressed).toBe(0);
  });

  it("accepts bounded ruleset provenance and rejects malformed fingerprints", () => {
    const report = ScanReportSchema.parse({
      ...baseReport,
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: "a".repeat(64),
        checkCount: 1
      }
    });
    expect(report.ruleset).toEqual({
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      value: "a".repeat(64),
      checkCount: 1
    });

    expect(() => ScanReportSchema.parse({
      ...baseReport,
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: "not-a-digest",
        checkCount: 1
      }
    })).toThrow();
  });

  it("accepts an unverified control separately from findings", () => {
    const report = ScanReportSchema.parse({
      ...baseReport,
      checks: [{
        checkId: "production.headers",
        pack: "production-ready",
        status: "unverified",
        findingCount: 0,
        gapCount: 1,
        durationMs: 1,
      }],
      gaps: [{
        id: "production.headers:missing",
        checkId: "production.headers",
        pack: "production-ready",
        area: "configuration",
        title: "Header control not verified",
        summary: "Repository evidence is incomplete.",
        evidence: [{ kind: "configuration", detail: "No local header evidence." }],
        verify: "Inspect deployed response headers."
      }],
      coverage: [{
        area: "configuration",
        status: "partial",
        checkIds: ["production.headers"],
        detail: "Configuration is partially assessed."
      }]
    });

    expect(report.findings).toHaveLength(0);
    expect(report.gaps[0]?.area).toBe("configuration");
    expect(report.coverage[0]?.status).toBe("partial");
  });

  it("accepts positive observations without changing finding semantics", () => {
    const report = ScanReportSchema.parse({
      ...baseReport,
      packs: ["production-ready"],
      checks: [{
        checkId: "production.server-surface-inventory",
        pack: "production-ready",
        status: "passed",
        findingCount: 0,
        gapCount: 0,
        observationCount: 1,
        durationMs: 1,
      }],
      observations: [{
        id: "production.server-surface-inventory:api-routes",
        checkId: "production.server-surface-inventory",
        pack: "production-ready",
        area: "access-control",
        kind: "inventory",
        title: "Server request surfaces discovered",
        summary: "Two request routes were found.",
        evidence: [{ kind: "file-presence", path: "app/api/demo/route.ts", detail: "Request surface." }]
      }]
    });

    expect(report.summary.total).toBe(0);
    expect(report.observations).toHaveLength(1);
    expect(report.checks[0]?.status).toBe("passed");
    expect(report.checks[0]?.observationCount).toBe(1);
  });

  it("accepts a visible version-bound suppressed finding", () => {
    const report = ScanReportSchema.parse({
      ...baseReport,
      checks: [{
        checkId: "secure.example",
        checkVersion: "2",
        pack: "secure-build",
        status: "suppressed",
        findingCount: 0,
        suppressedCount: 1,
        durationMs: 1
      }],
      suppressedFindings: [{
        finding: suppressedFinding,
        checkVersion: "2",
        rationale: "This exact risk is accepted until the upstream migration is completed.",
        configPath: ".ship-check.json"
      }],
      summary: { ...baseReport.summary, suppressed: 1 }
    });

    expect(report.findings).toHaveLength(0);
    expect(report.suppressedFindings[0]?.finding.id).toBe("secure.example:demo");
    expect(report.checks[0]?.checkVersion).toBe("2");
    expect(report.summary.suppressed).toBe(1);
  });

  it("rejects reports that omit inventory provenance", () => {
    const { inventorySource: _inventorySource, ...project } = baseReport.project;
    expect(() => ScanReportSchema.parse({ ...baseReport, project })).toThrow();
  });

  it("rejects an impossible negative file count", () => {
    expect(() =>
      ScanReportSchema.parse({
        ...baseReport,
        project: { ...baseReport.project, fileCount: -1 },
      }),
    ).toThrow();
  });

  it("rejects unknown assessment areas", () => {
    expect(() => ScanReportSchema.parse({
      ...baseReport,
      coverage: [{ area: "magic", status: "partial", checkIds: [], detail: "Nope" }]
    })).toThrow();
  });
});

describe("ProjectHistoryMetadataSchema", () => {
  it("accepts source-free assurance history metadata", () => {
    const metadata = ProjectHistoryMetadataSchema.parse({
      schemaVersion: "0.1",
      type: "assurance-metadata",
      provider: "ship-check",
      project: {
        identity: {
          algorithm: "sha256",
          scope: "project-source-v1",
          value: "a".repeat(64)
        },
        identityBasis: "primary-evidence",
        evidenceSources: [{
          type: "source",
          provider: "github",
          acquisition: "ci",
          executionLocation: "ci-runner",
          capabilities: ["source-files", "ci-context"]
        }],
        sourceFingerprint: {
          algorithm: "sha256",
          scope: "source-inventory-v1",
          value: "b".repeat(64),
          completeness: "complete",
          entryCount: 10,
          hashedEntryCount: 10,
          skippedEntryCount: 0
        },
        commit: "c".repeat(40)
      },
      scan: {
        identity: {
          algorithm: "sha256",
          scope: "scan-event-v1",
          value: "d".repeat(64)
        },
        generatedAt: "2026-09-19T08:45:00.000Z",
        engineVersion: "0.0.0-alpha.7",
        ruleset: {
          algorithm: "sha256",
          scope: "check-ruleset-v1",
          value: "e".repeat(64),
          checkCount: 4
        },
        packs: ["secure-build", "production-ready"],
        checkCount: 4
      },
      counts: {
        findings: 2,
        suppressed: 1,
        critical: 0,
        high: 1,
        medium: 1,
        low: 0,
        info: 0,
        unverified: 1,
        resolved: 1,
        observed: 3,
        notAssessed: 2,
        checkErrors: 0
      },
      coverage: [{
        area: "secrets",
        status: "assessed",
        checkCount: 2
      }],
      change: {
        basis: "pull-request-base",
        scope: "source",
        sourceSnapshot: "changed",
        findings: {
          introduced: 1,
          persistent: 1,
          reactivated: 0,
          accepted: 1,
          noLongerActive: 1
        },
        gaps: {
          introduced: 1,
          persistent: 0,
          noLongerActive: 1
        },
        surfaces: {
          introduced: 2,
          persistent: 1,
          noLongerObserved: 0
        }
      }
    });

    expect(metadata.project.identity.value).toHaveLength(64);
    expect(metadata.scan.identity.value).toHaveLength(64);
    expect(metadata.project.evidenceSources[0]?.provider).toBe("github");
    expect(metadata.change?.findings.accepted).toBe(1);
  });

  it("rejects inconsistent metadata counts", () => {
    const base = {
      schemaVersion: "0.1",
      type: "assurance-metadata",
      provider: "ship-check",
      project: {
        identity: { algorithm: "sha256", scope: "project-source-v1", value: "a".repeat(64) },
        identityBasis: "primary-evidence",
        evidenceSources: [{
          type: "source",
          provider: "local",
          acquisition: "local",
          executionLocation: "user-device",
          capabilities: ["source-files"]
        }]
      },
      scan: {
        identity: { algorithm: "sha256", scope: "scan-event-v1", value: "b".repeat(64) },
        generatedAt: "2026-09-19T08:45:00.000Z",
        engineVersion: "test",
        ruleset: {
          algorithm: "sha256",
          scope: "check-ruleset-v1",
          value: "c".repeat(64),
          checkCount: 1
        },
        packs: ["secure-build"],
        checkCount: 1
      },
      counts: {
        findings: 2,
        suppressed: 0,
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
        unverified: 0,
        resolved: 0,
        observed: 0,
        notAssessed: 0,
        checkErrors: 0
      },
      coverage: []
    };

    expect(() => ProjectHistoryMetadataSchema.parse(base)).toThrow(/severity counts/i);
    expect(() => ProjectHistoryMetadataSchema.parse({
      ...base,
      counts: { ...base.counts, findings: 1 },
      scan: { ...base.scan, checkCount: 2 }
    })).toThrow(/ruleset check count/i);
  });

  it("rejects raw labels and evidence from the metadata envelope", () => {
    expect(() => ProjectHistoryMetadataSchema.parse({
      schemaVersion: "0.1",
      type: "assurance-metadata",
      provider: "ship-check",
      project: {
        identity: {
          algorithm: "sha256",
          scope: "project-source-v1",
          value: "a".repeat(64)
        },
        identityBasis: "primary-evidence",
        evidenceSources: [{
          type: "source",
          provider: "local",
          acquisition: "local",
          executionLocation: "user-device",
          capabilities: ["source-files"],
          label: "/home/user/private-project"
        }]
      },
      scan: {
        identity: {
          algorithm: "sha256",
          scope: "scan-event-v1",
          value: "d".repeat(64)
        },
        generatedAt: "2026-09-19T08:45:00.000Z",
        engineVersion: "0.0.0-alpha.7",
        ruleset: {
          algorithm: "sha256",
          scope: "check-ruleset-v1",
          value: "e".repeat(64),
          checkCount: 1
        },
        packs: ["secure-build"],
        checkCount: 1
      },
      counts: {
        findings: 0,
        suppressed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        unverified: 0,
        resolved: 0,
        observed: 0,
        notAssessed: 0,
        checkErrors: 0
      },
      coverage: []
    })).toThrow();
  });
});

describe("ProjectHistoryTimelineSchema", () => {
  const event = ProjectHistoryMetadataSchema.parse({
    schemaVersion: "0.1",
    type: "assurance-metadata",
    provider: "ship-check",
    project: {
      identity: {
        algorithm: "sha256",
        scope: "project-source-v1",
        value: "a".repeat(64)
      },
      identityBasis: "primary-evidence",
      evidenceSources: [{
        type: "source",
        provider: "github",
        acquisition: "ci",
        executionLocation: "ci-runner",
        capabilities: ["source-files", "ci-context"]
      }]
    },
    scan: {
      identity: {
        algorithm: "sha256",
        scope: "scan-event-v1",
        value: "b".repeat(64)
      },
      generatedAt: "2026-09-19T09:00:00.000Z",
      engineVersion: "test",
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: "c".repeat(64),
        checkCount: 1
      },
      packs: ["secure-build"],
      checkCount: 1
    },
    counts: {
      findings: 0,
      suppressed: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      unverified: 0,
      resolved: 0,
      observed: 0,
      notAssessed: 0,
      checkErrors: 0
    },
    coverage: [{
      area: "secrets",
      status: "assessed",
      checkCount: 1
    }]
  });

  const timeline = {
    schemaVersion: "0.1",
    type: "project-history-timeline",
    provider: "ship-check",
    project: {
      identity: event.project.identity,
      identityBasis: event.project.identityBasis
    },
    eventCount: 1,
    firstScan: event.scan.identity,
    latestScan: event.scan.identity,
    firstAt: event.scan.generatedAt,
    latestAt: event.scan.generatedAt,
    latestAttention: {
      findings: 0,
      suppressed: 0,
      critical: 0,
      high: 0,
      unverified: 0,
      notAssessed: 0,
      checkErrors: 0,
      coverage: {
        assessed: 1,
        partial: 0,
        notAssessed: 0
      }
    },
    events: [{ event }]
  };

  it("accepts a source-free timeline envelope", () => {
    expect(ProjectHistoryTimelineSchema.parse(timeline).eventCount).toBe(1);
  });

  it("rejects inconsistent event counts and scan pointers", () => {
    expect(() => ProjectHistoryTimelineSchema.parse({
      ...timeline,
      eventCount: 2
    })).toThrow(/event count/i);

    expect(() => ProjectHistoryTimelineSchema.parse({
      ...timeline,
      firstScan: {
        ...event.scan.identity,
        value: "d".repeat(64)
      }
    })).toThrow(/firstScan/i);

    expect(() => ProjectHistoryTimelineSchema.parse({
      ...timeline,
      latestAttention: {
        ...timeline.latestAttention,
        findings: 1
      }
    })).toThrow(/latest attention/i);
  });
});

describe("Cloud history contracts", () => {
  const metadata = ProjectHistoryMetadataSchema.parse({
    schemaVersion: "0.1",
    type: "assurance-metadata",
    provider: "ship-check",
    project: {
      identity: { algorithm: "sha256", scope: "project-source-v1", value: "a".repeat(64) },
      identityBasis: "primary-evidence",
      evidenceSources: [{
        type: "source",
        provider: "github",
        acquisition: "ci",
        executionLocation: "ci-runner",
        capabilities: ["source-files"],
        count: 1
      }]
    },
    scan: {
      identity: { algorithm: "sha256", scope: "scan-event-v1", value: "b".repeat(64) },
      generatedAt: "2026-09-19T09:00:00.000Z",
      engineVersion: "test",
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: "c".repeat(64),
        checkCount: 1
      },
      packs: ["secure-build"],
      checkCount: 1
    },
    counts: {
      findings: 0,
      suppressed: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      unverified: 0,
      resolved: 0,
      observed: 0,
      notAssessed: 0,
      checkErrors: 0
    },
    coverage: []
  });

  it("keeps hosted account identity opaque and project sync metadata-only", () => {
    const account = CloudAccountSchema.parse({
      schemaVersion: "0.1",
      id: "11111111-1111-4111-8111-111111111111",
      authSubjectHash: "d".repeat(64),
      createdAt: "2026-09-19T09:00:00.000Z"
    });
    const project = CloudProjectSchema.parse({
      schemaVersion: "0.1",
      id: "22222222-2222-4222-8222-222222222222",
      accountId: account.id,
      projectIdentity: metadata.project.identity,
      identityBasis: metadata.project.identityBasis,
      displayName: "Example project",
      syncLevel: "assurance-metadata",
      retention: "90-days",
      createdAt: "2026-09-19T09:00:00.000Z",
      updatedAt: "2026-09-19T09:00:00.000Z"
    });

    expect(account.authSubjectHash).toHaveLength(64);
    expect(project.syncLevel).toBe("assurance-metadata");
    expect(project.retention).toBe("90-days");
  });

  it("accepts only verified-hash service principals and metadata-only connect/update requests", () => {
    expect(CloudAuthenticatedPrincipalSchema.parse({
      schemaVersion: "0.1",
      authSubjectHash: "d".repeat(64)
    }).authSubjectHash).toHaveLength(64);

    expect(CloudProjectConnectRequestSchema.parse({
      schemaVersion: "0.1",
      event: metadata,
      retention: "90-days",
      displayName: "Example project"
    }).event.type).toBe("assurance-metadata");

    expect(CloudRetentionUpdateRequestSchema.parse({
      schemaVersion: "0.1",
      projectId: "22222222-2222-4222-8222-222222222222",
      retention: "30-days"
    }).retention).toBe("30-days");

    expect(CloudProjectNameUpdateRequestSchema.parse({
      schemaVersion: "0.1",
      projectId: "22222222-2222-4222-8222-222222222222",
      displayName: null
    }).displayName).toBeNull();

    expect(() => CloudAuthenticatedPrincipalSchema.parse({
      schemaVersion: "0.1",
      authSubjectHash: "d".repeat(64),
      issuer: "https://auth.example",
      subject: "raw-user"
    })).toThrow();
  });

  it("rejects raw auth subject fields, unsupported retention and non-metadata ingest", () => {
    expect(() => CloudAccountSchema.parse({
      schemaVersion: "0.1",
      id: "11111111-1111-4111-8111-111111111111",
      authSubjectHash: "d".repeat(64),
      authSubject: "raw-user-id",
      createdAt: "2026-09-19T09:00:00.000Z"
    })).toThrow();

    expect(() => CloudProjectSchema.parse({
      schemaVersion: "0.1",
      id: "22222222-2222-4222-8222-222222222222",
      accountId: "11111111-1111-4111-8111-111111111111",
      projectIdentity: metadata.project.identity,
      identityBasis: metadata.project.identityBasis,
      syncLevel: "assurance-metadata",
      retention: "forever",
      createdAt: "2026-09-19T09:00:00.000Z",
      updatedAt: "2026-09-19T09:00:00.000Z"
    })).toThrow();

    expect(() => CloudHistoryIngestRequestSchema.parse({
      schemaVersion: "0.1",
      projectId: "22222222-2222-4222-8222-222222222222",
      event: { type: "full-scan-report" }
    })).toThrow();
  });
});

describe("ShipCheckConfigSchema", () => {
  it("accepts exact finding suppressions with version and rationale", () => {
    const config = ShipCheckConfigSchema.parse({
      schemaVersion: "0.1",
      suppressions: [{
        findingId: "cost.vercel-cron-frequency:0:/api/cron/heartbeat",
        checkVersion: "2",
        rationale: "This five-minute health check is intentionally lightweight and measured."
      }]
    });
    expect(config.suppressions).toHaveLength(1);
  });

  it("rejects missing or token rationales and malformed rule versions", () => {
    expect(() => ShipCheckConfigSchema.parse({
      schemaVersion: "0.1",
      suppressions: [{ findingId: "secure.example:demo", checkVersion: "2", rationale: "ok" }]
    })).toThrow();
    expect(() => ShipCheckConfigSchema.parse({
      schemaVersion: "0.1",
      suppressions: [{ findingId: "secure.example:demo", checkVersion: "alpha", rationale: "This has a proper explanation." }]
    })).toThrow();
  });
});
