import { describe, expect, it } from "vitest";
import {
  ProjectHistoryMetadataSchema,
  type ProjectHistoryMetadata
} from "@ship-check/schemas";
import { buildProjectHistoryTimeline } from "./timeline.js";

function metadata(options: {
  scan?: string;
  project?: string;
  at?: string;
  engine?: string;
  ruleset?: string;
  fingerprint?: string;
  fingerprintCompleteness?: "complete" | "partial";
  findings?: number;
  high?: number;
  critical?: number;
  suppressed?: number;
  unverified?: number;
  notAssessed?: number;
  checkErrors?: number;
  coverage?: Array<{
    area: "secrets" | "configuration" | "runtime";
    status: "assessed" | "partial" | "not-assessed";
    checkCount: number;
  }>;
  acquisition?: "local" | "ci";
  executionLocation?: "user-device" | "ci-runner";
  identityBasis?: "primary-evidence" | "caller-provided";
  change?: ProjectHistoryMetadata["change"];
} = {}): ProjectHistoryMetadata {
  const findings = options.findings ?? 0;
  const high = options.high ?? findings;
  const critical = options.critical ?? 0;
  const info = findings - high - critical;
  return ProjectHistoryMetadataSchema.parse({
    schemaVersion: "0.1",
    type: "assurance-metadata",
    provider: "ship-check",
    project: {
      identity: {
        algorithm: "sha256",
        scope: "project-source-v1",
        value: options.project ?? "a".repeat(64)
      },
      identityBasis: options.identityBasis ?? "primary-evidence",
      evidenceSources: [{
        type: "source",
        provider: "github",
        acquisition: options.acquisition ?? "ci",
        executionLocation: options.executionLocation ?? "ci-runner",
        capabilities: ["source-files", "ci-context"],
        count: 1
      }],
      ...(options.fingerprint ? {
        sourceFingerprint: {
          algorithm: "sha256",
          scope: "source-inventory-v1",
          value: options.fingerprint,
          completeness: options.fingerprintCompleteness ?? "complete",
          entryCount: 2,
          hashedEntryCount: 2,
          skippedEntryCount: 0
        }
      } : {})
    },
    scan: {
      identity: {
        algorithm: "sha256",
        scope: "scan-event-v1",
        value: options.scan ?? "b".repeat(64)
      },
      generatedAt: options.at ?? "2026-09-19T09:00:00.000Z",
      engineVersion: options.engine ?? "0.0.0-test",
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: options.ruleset ?? "c".repeat(64),
        checkCount: 2
      },
      packs: ["secure-build"],
      checkCount: 2
    },
    counts: {
      findings,
      suppressed: options.suppressed ?? 0,
      critical,
      high,
      medium: 0,
      low: 0,
      info,
      unverified: options.unverified ?? 0,
      resolved: 0,
      observed: 0,
      notAssessed: options.notAssessed ?? 0,
      checkErrors: options.checkErrors ?? 0
    },
    coverage: options.coverage ?? [{
      area: "secrets",
      status: "assessed",
      checkCount: 1
    }],
    ...(options.change ? { change: options.change } : {})
  });
}

describe("buildProjectHistoryTimeline", () => {
  it("deduplicates and chronologically orders idempotent metadata events", () => {
    const first = metadata({
      scan: "1".repeat(64),
      at: "2026-09-19T09:00:00.000Z"
    });
    const second = metadata({
      scan: "2".repeat(64),
      at: "2026-09-19T09:05:00.000Z"
    });

    const timeline = buildProjectHistoryTimeline([second, first, second]);

    expect(timeline.eventCount).toBe(2);
    expect(timeline.firstScan.value).toBe("1".repeat(64));
    expect(timeline.latestScan.value).toBe("2".repeat(64));
    expect(timeline.firstAt).toBe("2026-09-19T09:00:00.000Z");
    expect(timeline.latestAt).toBe("2026-09-19T09:05:00.000Z");
    expect(timeline.events.map((entry) => entry.event.scan.identity.value))
      .toEqual(["1".repeat(64), "2".repeat(64)]);
  });

  it("derives provenance continuity without inventing finding transitions", () => {
    const first = metadata({
      scan: "1".repeat(64),
      at: "2026-09-19T09:00:00.000Z",
      fingerprint: "d".repeat(64),
      findings: 2,
      high: 2
    });
    const second = metadata({
      scan: "2".repeat(64),
      at: "2026-09-19T09:05:00.000Z",
      fingerprint: "e".repeat(64),
      ruleset: "f".repeat(64),
      engine: "0.0.0-next",
      findings: 1,
      high: 1,
      coverage: [{
        area: "secrets",
        status: "partial",
        checkCount: 1
      }],
      acquisition: "local",
      executionLocation: "user-device"
    });

    const timeline = buildProjectHistoryTimeline([first, second]);
    const continuity = timeline.events[1]?.continuity;

    expect(continuity).toEqual({
      previousScan: first.scan.identity,
      ruleset: "changed",
      engine: "changed",
      sourceSnapshot: "changed",
      coverageChanged: true,
      evidenceSourcesChanged: true
    });
    expect(timeline.events[1]?.event.change).toBeUndefined();
  });

  it("treats equal complete fingerprints as unchanged and equal partial fingerprints as uncertain", () => {
    const complete = buildProjectHistoryTimeline([
      metadata({
        scan: "1".repeat(64),
        fingerprint: "d".repeat(64),
        at: "2026-09-19T09:00:00.000Z"
      }),
      metadata({
        scan: "2".repeat(64),
        fingerprint: "d".repeat(64),
        at: "2026-09-19T09:01:00.000Z"
      })
    ]);
    expect(complete.events[1]?.continuity?.sourceSnapshot).toBe("unchanged");

    const partial = buildProjectHistoryTimeline([
      metadata({
        scan: "3".repeat(64),
        fingerprint: "e".repeat(64),
        fingerprintCompleteness: "partial",
        at: "2026-09-19T09:02:00.000Z"
      }),
      metadata({
        scan: "4".repeat(64),
        fingerprint: "e".repeat(64),
        fingerprintCompleteness: "partial",
        at: "2026-09-19T09:03:00.000Z"
      })
    ]);
    expect(partial.events[1]?.continuity?.sourceSnapshot).toBe("uncertain");
  });

  it("surfaces the latest bounded attention snapshot without a score", () => {
    const timeline = buildProjectHistoryTimeline([
      metadata({
        scan: "1".repeat(64),
        at: "2026-09-19T09:00:00.000Z"
      }),
      metadata({
        scan: "2".repeat(64),
        at: "2026-09-19T09:05:00.000Z",
        findings: 3,
        critical: 1,
        high: 1,
        suppressed: 2,
        unverified: 4,
        notAssessed: 5,
        checkErrors: 1,
        coverage: [
          { area: "secrets", status: "assessed", checkCount: 2 },
          { area: "configuration", status: "partial", checkCount: 1 },
          { area: "runtime", status: "not-assessed", checkCount: 0 }
        ]
      })
    ]);

    expect(timeline.latestAttention).toEqual({
      findings: 3,
      suppressed: 2,
      critical: 1,
      high: 1,
      unverified: 4,
      notAssessed: 5,
      checkErrors: 1,
      coverage: {
        assessed: 1,
        partial: 1,
        notAssessed: 1
      }
    });
    expect("score" in timeline.latestAttention).toBe(false);
  });

  it("preserves explicit transition metadata unchanged", () => {
    const baseline = metadata({
      scan: "1".repeat(64),
      at: "2026-09-19T09:00:00.000Z"
    });
    const change: NonNullable<ProjectHistoryMetadata["change"]> = {
      basis: "previous-comparable-scan",
      scope: "project",
      baselineScan: baseline.scan.identity,
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
    };
    const current = metadata({
      scan: "2".repeat(64),
      at: "2026-09-19T09:05:00.000Z",
      change
    });

    const timeline = buildProjectHistoryTimeline([current, baseline]);

    expect(timeline.events[1]?.event.change).toEqual(change);
  });

  it("rejects mixed projects and identity bases", () => {
    expect(() => buildProjectHistoryTimeline([
      metadata({ scan: "1".repeat(64) }),
      metadata({ scan: "2".repeat(64), project: "d".repeat(64) })
    ])).toThrow(/one opaque project identity/i);

    expect(() => buildProjectHistoryTimeline([
      metadata({ scan: "1".repeat(64) }),
      metadata({
        scan: "2".repeat(64),
        identityBasis: "caller-provided"
      })
    ])).toThrow(/identity bases/i);
  });

  it("rejects conflicting duplicate scan identities", () => {
    const scan = "1".repeat(64);
    expect(() => buildProjectHistoryTimeline([
      metadata({ scan, findings: 0 }),
      metadata({ scan, findings: 1, high: 1 })
    ])).toThrow(/conflicting metadata events/i);
  });

  it("rejects a change that points at its own scan as baseline", () => {
    const scan = {
      algorithm: "sha256" as const,
      scope: "scan-event-v1" as const,
      value: "1".repeat(64)
    };
    expect(() => buildProjectHistoryTimeline([
      metadata({
        scan: scan.value,
        change: {
          basis: "previous-comparable-scan",
          scope: "project",
          baselineScan: scan,
          sourceSnapshot: "unchanged",
          findings: {
            introduced: 0,
            persistent: 0,
            reactivated: 0,
            accepted: 0,
            noLongerActive: 0
          },
          gaps: {
            introduced: 0,
            persistent: 0,
            noLongerActive: 0
          },
          surfaces: {
            introduced: 0,
            persistent: 0,
            noLongerObserved: 0
          }
        }
      })
    ])).toThrow(/cannot use its own scan/i);
  });

  it("rejects an empty timeline", () => {
    expect(() => buildProjectHistoryTimeline([]))
      .toThrow(/at least one metadata event/i);
  });
});
