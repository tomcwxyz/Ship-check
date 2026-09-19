import { createHash } from "node:crypto";
import {
  ProjectHistoryChangeSchema,
  ProjectHistoryMetadataSchema,
  type ProjectEvidenceSource,
  type ProjectHistoryChange,
  type ProjectHistoryMetadata,
  type ScanReport
} from "@ship-check/schemas";

type MultiSourceLikeReport = ScanReport & {
  project: ScanReport["project"] & {
    evidenceSources?: ProjectEvidenceSource[];
  };
  resolvedGaps?: unknown[];
};

export type ProjectHistoryMetadataOptions = {
  projectIdentityKey?: string;
  change?: ProjectHistoryChange;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalRuntimeIdentity(value: string): string {
  const raw = value.replace(/^url:/, "");
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
  } catch {
    return raw.split("?")[0]?.split("#")[0] ?? raw;
  }
}

function canonicalGithubIdentity(source: ProjectEvidenceSource): string {
  const candidates = [source.id, source.label];
  for (const candidate of candidates) {
    const cleaned = String(candidate)
      .replace(/^github:/i, "")
      .replace(/^https:\/\/[^/@]+@github\.com\//i, "")
      .replace(/^https:\/\/github\.com\//i, "")
      .replace(/^git@github\.com:/i, "")
      .replace(/^ssh:\/\/git@github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
    const match = cleaned.match(/^([^/]+)\/([^/:]+)(?::(.+))?$/);
    if (match) {
      const owner = match[1]!.toLowerCase();
      const repository = match[2]!.toLowerCase();
      const subpath = match[3]?.replace(/^\/+|\/+$/g, "");
      return subpath
        ? `${owner}/${repository}:${subpath}`
        : `${owner}/${repository}`;
    }
  }
  return source.id.toLowerCase();
}

function canonicalProjectSourceKey(source: ProjectEvidenceSource): string {
  if (source.provider === "github") {
    return `source:github:${canonicalGithubIdentity(source)}`;
  }
  if (source.type === "deployment" || source.provider === "url") {
    return `runtime:${canonicalRuntimeIdentity(source.id || source.label)}`;
  }
  return `${source.type}:${source.provider}:${source.id}`;
}

function evidenceSourcesFor(report: MultiSourceLikeReport): ProjectEvidenceSource[] {
  if (report.project.evidenceSources?.length) return report.project.evidenceSources;
  return report.project.snapshot?.source ? [report.project.snapshot.source] : [];
}

function safeEvidenceSource(source: ProjectEvidenceSource) {
  return {
    type: source.type,
    provider: source.provider,
    acquisition: source.acquisition,
    executionLocation: source.executionLocation,
    capabilities: [...new Set(source.capabilities)].sort()
  };
}

function sortedEvidenceSources(sources: ProjectEvidenceSource[]) {
  const deduped = new Map<string, ReturnType<typeof safeEvidenceSource>>();
  for (const source of sources) {
    const safe = safeEvidenceSource(source);
    const key = JSON.stringify(safe);
    if (!deduped.has(key)) deduped.set(key, safe);
  }
  return [...deduped.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );
}

function projectIdentity(
  report: MultiSourceLikeReport,
  options: ProjectHistoryMetadataOptions
): { identity: ProjectHistoryMetadata["project"]["identity"]; identityBasis: ProjectHistoryMetadata["project"]["identityBasis"] } {
  const source = report.project.snapshot?.source;
  const explicit = options.projectIdentityKey?.trim();
  const basis = explicit ? "caller-provided" as const : "primary-evidence" as const;

  if (!explicit && !source) {
    throw new Error(
      "Metadata history requires project source provenance or an explicit projectIdentityKey."
    );
  }

  const key = explicit ?? canonicalProjectSourceKey(source!);
  return {
    identity: {
      algorithm: "sha256",
      scope: "project-source-v1",
      value: sha256(`project-source-v1\0${basis}\0${key}`)
    },
    identityBasis: basis
  };
}

function resolvedGapCount(report: MultiSourceLikeReport): number {
  return Array.isArray(report.resolvedGaps) ? report.resolvedGaps.length : 0;
}

function stableScanIdentity(input: {
  projectIdentity: string;
  generatedAt: string;
  engineVersion: string;
  ruleset: string;
  sourceFingerprint?: string;
  sourceFingerprintCompleteness?: string;
  commit?: string;
  packs: string[];
  counts: ProjectHistoryMetadata["counts"];
  evidenceSources: ProjectHistoryMetadata["project"]["evidenceSources"];
  coverage: ProjectHistoryMetadata["coverage"];
}): ProjectHistoryMetadata["scan"]["identity"] {
  const material = JSON.stringify({
    projectIdentity: input.projectIdentity,
    generatedAt: input.generatedAt,
    engineVersion: input.engineVersion,
    ruleset: input.ruleset,
    sourceFingerprint: input.sourceFingerprint ?? null,
    sourceFingerprintCompleteness: input.sourceFingerprintCompleteness ?? null,
    commit: input.commit ?? null,
    packs: [...input.packs].sort(),
    counts: input.counts,
    evidenceSources: input.evidenceSources,
    coverage: input.coverage
  });
  return {
    algorithm: "sha256",
    scope: "scan-event-v1",
    value: sha256(material)
  };
}

export function toProjectHistoryMetadata(
  input: ScanReport,
  options: ProjectHistoryMetadataOptions = {}
): ProjectHistoryMetadata {
  const report = input as MultiSourceLikeReport;
  const sources = evidenceSourcesFor(report);
  if (sources.length === 0) {
    throw new Error(
      "Metadata history requires recorded project evidence-source provenance."
    );
  }
  if (!report.ruleset) {
    throw new Error(
      "Metadata history requires stable ruleset provenance; rerun the scan with a current Ship Check engine."
    );
  }

  const project = projectIdentity(report, options);
  const sourceFingerprint = report.project.snapshot?.inventory.fingerprint;
  const commit = report.project.commit ?? report.project.snapshot?.inventory.commit;
  const counts: ProjectHistoryMetadata["counts"] = {
    findings: report.findings.length,
    suppressed: report.suppressedFindings?.length ?? report.summary.suppressed ?? 0,
    critical: report.summary.critical,
    high: report.summary.high,
    medium: report.summary.medium,
    low: report.summary.low,
    info: report.summary.info,
    unverified: report.gaps?.length ?? 0,
    resolved: resolvedGapCount(report),
    observed: report.observations?.length ?? 0,
    notAssessed: report.checks.filter((check) => check.status === "not-assessed").length,
    checkErrors: report.checks.filter((check) => check.status === "error").length
  };
  const packs = [...new Set(report.packs)].sort();
  const evidenceSources = sortedEvidenceSources(sources);
  const coverage: ProjectHistoryMetadata["coverage"] = (report.coverage ?? []).map((entry) => ({
    area: entry.area,
    status: entry.status,
    checkCount: entry.checkIds.length
  }));

  const metadata: ProjectHistoryMetadata = {
    schemaVersion: "0.1",
    type: "assurance-metadata",
    provider: "ship-check",
    project: {
      identity: project.identity,
      identityBasis: project.identityBasis,
      evidenceSources,
      ...(sourceFingerprint ? { sourceFingerprint } : {}),
      ...(commit ? { commit } : {})
    },
    scan: {
      identity: stableScanIdentity({
        projectIdentity: project.identity.value,
        generatedAt: report.generatedAt,
        engineVersion: report.tool.version,
        ruleset: report.ruleset.value,
        sourceFingerprint: sourceFingerprint?.value,
        sourceFingerprintCompleteness: sourceFingerprint?.completeness,
        commit,
        packs,
        counts,
        evidenceSources,
        coverage
      }),
      generatedAt: report.generatedAt,
      engineVersion: report.tool.version,
      ruleset: report.ruleset,
      packs,
      checkCount: report.checks.length
    },
    counts,
    coverage,
    ...(options.change ? { change: ProjectHistoryChangeSchema.parse(options.change) } : {})
  };

  return ProjectHistoryMetadataSchema.parse(metadata);
}
