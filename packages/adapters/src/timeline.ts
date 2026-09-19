import {
  ProjectHistoryMetadataSchema,
  ProjectHistoryTimelineSchema,
  type ProjectHistoryAttention,
  type ProjectHistoryMetadata,
  type ProjectHistoryTimeline
} from "@ship-check/schemas";

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function fingerprintRelation(
  current: ProjectHistoryMetadata,
  previous: ProjectHistoryMetadata
): "changed" | "unchanged" | "uncertain" | "unknown" {
  const currentFingerprint = current.project.sourceFingerprint;
  const previousFingerprint = previous.project.sourceFingerprint;
  if (!currentFingerprint || !previousFingerprint) return "unknown";
  if (currentFingerprint.value !== previousFingerprint.value) return "changed";
  if (
    currentFingerprint.completeness === "complete" &&
    previousFingerprint.completeness === "complete"
  ) {
    return "unchanged";
  }
  return "uncertain";
}

function normalisedCoverage(event: ProjectHistoryMetadata): string {
  return stableJson(
    [...event.coverage]
      .sort((left, right) => left.area.localeCompare(right.area))
      .map((entry) => ({
        area: entry.area,
        status: entry.status,
        checkCount: entry.checkCount
      }))
  );
}

function normalisedEvidenceSources(event: ProjectHistoryMetadata): string {
  return stableJson(
    [...event.project.evidenceSources]
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
  );
}

function attention(event: ProjectHistoryMetadata): ProjectHistoryAttention {
  const coverage = { assessed: 0, partial: 0, notAssessed: 0 };
  for (const entry of event.coverage) {
    if (entry.status === "assessed") coverage.assessed += 1;
    else if (entry.status === "partial") coverage.partial += 1;
    else coverage.notAssessed += 1;
  }

  return {
    findings: event.counts.findings,
    suppressed: event.counts.suppressed,
    critical: event.counts.critical,
    high: event.counts.high,
    unverified: event.counts.unverified,
    notAssessed: event.counts.notAssessed,
    checkErrors: event.counts.checkErrors,
    coverage
  };
}

export function buildProjectHistoryTimeline(
  values: ProjectHistoryMetadata[]
): ProjectHistoryTimeline {
  if (values.length === 0) {
    throw new Error("A project history timeline requires at least one metadata event.");
  }

  const parsed = values.map((value) => ProjectHistoryMetadataSchema.parse(value));
  const projectIdentity = parsed[0]!.project.identity.value;
  const identityBasis = parsed[0]!.project.identityBasis;

  for (const event of parsed) {
    if (event.project.identity.value !== projectIdentity) {
      throw new Error("A project history timeline can only contain one opaque project identity.");
    }
    if (event.project.identityBasis !== identityBasis) {
      throw new Error("A project history timeline cannot mix project identity bases.");
    }
    if (
      event.change?.baselineScan?.value &&
      event.change.baselineScan.value === event.scan.identity.value
    ) {
      throw new Error("A project history change cannot use its own scan as the baseline.");
    }
  }

  const byScan = new Map<string, ProjectHistoryMetadata>();
  for (const event of parsed) {
    const key = event.scan.identity.value;
    const existing = byScan.get(key);
    if (!existing) {
      byScan.set(key, event);
      continue;
    }
    if (stableJson(existing) !== stableJson(event)) {
      throw new Error(
        `Conflicting metadata events share the same scan identity ${key.slice(0, 12)}.`
      );
    }
  }

  const events = [...byScan.values()].sort((left, right) => {
    const timestamp = left.scan.generatedAt.localeCompare(right.scan.generatedAt);
    return timestamp !== 0
      ? timestamp
      : left.scan.identity.value.localeCompare(right.scan.identity.value);
  });

  const entries = events.map((event, index) => {
    const previous = index > 0 ? events[index - 1] : undefined;
    if (!previous) return { event };

    return {
      event,
      continuity: {
        previousScan: previous.scan.identity,
        ruleset:
          event.scan.ruleset.value === previous.scan.ruleset.value
            ? "same" as const
            : "changed" as const,
        engine:
          event.scan.engineVersion === previous.scan.engineVersion
            ? "same" as const
            : "changed" as const,
        sourceSnapshot: fingerprintRelation(event, previous),
        coverageChanged:
          normalisedCoverage(event) !== normalisedCoverage(previous),
        evidenceSourcesChanged:
          normalisedEvidenceSources(event) !== normalisedEvidenceSources(previous)
      }
    };
  });

  const first = events[0]!;
  const latest = events.at(-1)!;

  return ProjectHistoryTimelineSchema.parse({
    schemaVersion: "0.1",
    type: "project-history-timeline",
    provider: "ship-check",
    project: {
      identity: first.project.identity,
      identityBasis: first.project.identityBasis
    },
    eventCount: events.length,
    firstScan: first.scan.identity,
    latestScan: latest.scan.identity,
    firstAt: first.scan.generatedAt,
    latestAt: latest.scan.generatedAt,
    latestAttention: attention(latest),
    events: entries
  });
}
