import { randomUUID } from "node:crypto";
import {
  ProjectEvidenceSourceSchema,
  ScanReportSchema,
  type AssessmentArea,
  type AssessmentGap,
  type CheckPack,
  type CheckResult,
  type CheckVersion,
  type CoverageEntry,
  type Finding,
  type Observation,
  type PracticePrincipleId,
  type ProjectEvidenceCapability,
  type ScanReport
} from "@ship-check/schemas";
import { createProjectSnapshot } from "./projectEvidence.js";
import { createRulesetProvenance } from "./ruleset.js";

const DEFAULT_CHECK_VERSION: CheckVersion = "1";
const RUNTIME_ORIGIN_PROBE = "https://ship-check.invalid";
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

const ASSESSMENT_AREAS: AssessmentArea[] = [
  "secrets",
  "access-control",
  "configuration",
  "supply-chain",
  "cost",
  "code-security",
  "database",
  "runtime"
];

const areaLabels: Record<AssessmentArea, string> = {
  secrets: "Secrets and credential exposure",
  "access-control": "Access control and exposed server boundaries",
  configuration: "Application and platform configuration",
  "supply-chain": "Dependency and supply-chain risk",
  cost: "Cost and background-work boundaries",
  "code-security": "Static code security",
  database: "Database permissions and data boundaries",
  runtime: "Deployed runtime behaviour"
};

export type SourceCheckDescriptor = {
  id: string;
  version?: CheckVersion;
  pack: CheckPack;
  principles?: PracticePrincipleId[];
  requiresEvidence?: ProjectEvidenceCapability[];
};

export type RuntimeHttpCookieEvidence = {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "strict" | "lax" | "none";
};

export type RuntimeHttpRedirectEvidence = {
  from: string;
  to: string;
  status: number;
};

export type RuntimeHttpEvidence = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  redirects: RuntimeHttpRedirectEvidence[];
  requestOrigin: string;
  headers: {
    strictTransportSecurity?: string;
    contentSecurityPolicy?: string;
    xContentTypeOptions?: string;
    referrerPolicy?: string;
    permissionsPolicy?: string;
    accessControlAllowOrigin?: string;
    accessControlAllowCredentials?: string;
  };
  cookies: RuntimeHttpCookieEvidence[];
  /** Public-page fingerprint only. Never evidence of installed extension versions. */
  cms?: { id: "wordpress" | "drupal"; confidence: "likely" | "possible"; signals: string[] };
};

export type RuntimeContext = {
  source: ReturnType<typeof ProjectEvidenceSourceSchema.parse>;
  target: URL;
  http: RuntimeHttpEvidence;
};

export type RuntimeCoverageContribution = {
  area: AssessmentArea;
  status: "assessed" | "partial";
};

export type RuntimeCheckExecution = {
  findings?: Finding[];
  gaps?: AssessmentGap[];
  observations?: Observation[];
  coverage?: RuntimeCoverageContribution[];
};

export type RuntimeCheckDefinition = {
  id: string;
  version?: CheckVersion;
  pack: CheckPack;
  title: string;
  description: string;
  principles?: PracticePrincipleId[];
  requiresEvidence?: ProjectEvidenceCapability[];
  coverage?: RuntimeCoverageContribution[];
  appliesTo?(context: RuntimeContext): boolean | Promise<boolean>;
  run(context: RuntimeContext): Promise<Finding[] | RuntimeCheckExecution>;
};

export type RuntimeScanOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  executionLocation?: "user-device" | "ci-runner" | "ship-check-managed" | "external-platform";
};

function normaliseRuntimeExecution(
  execution: Finding[] | RuntimeCheckExecution
): Required<RuntimeCheckExecution> {
  if (Array.isArray(execution)) {
    return { findings: execution, gaps: [], observations: [], coverage: [] };
  }
  return {
    findings: execution.findings ?? [],
    gaps: execution.gaps ?? [],
    observations: execution.observations ?? [],
    coverage: execution.coverage ?? []
  };
}

function summarise(findings: Finding[]): ScanReport["summary"] {
  const summary = { total: findings.length, suppressed: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}

function summariseCoverage(
  contributions: Array<RuntimeCoverageContribution & { checkId: string }>
): CoverageEntry[] {
  return ASSESSMENT_AREAS.map((area) => {
    const matches = contributions.filter((entry) => entry.area === area);
    const checkIds = [...new Set(matches.map((entry) => entry.checkId))].sort();
    if (matches.length === 0) {
      return {
        area,
        status: "not-assessed" as const,
        checkIds,
        detail: `${areaLabels[area]} was not assessed by the available runtime evidence.`
      };
    }
    const status = matches.some((entry) => entry.status === "assessed") ? "assessed" as const : "partial" as const;
    return {
      area,
      status,
      checkIds,
      detail: status === "assessed"
        ? `${areaLabels[area]} has deterministic runtime evidence from ${checkIds.length} check${checkIds.length === 1 ? "" : "s"}.`
        : `${areaLabels[area]} was partially assessed from bounded runtime evidence; this is not full verification.`
    };
  });
}

export function parseRuntimeTargetUrl(value: string): URL | null {
  let target: URL;
  try {
    target = new URL(value.trim());
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (target.username || target.password) {
    throw new Error("Do not put credentials in a deployment URL.");
  }
  target.hash = "";
  return target;
}

function cookieEvidence(setCookie: string): RuntimeHttpCookieEvidence | null {
  const parts = setCookie.split(";").map((part) => part.trim()).filter(Boolean);
  const pair = parts[0];
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator <= 0) return null;
  const attributes = parts.slice(1).map((part) => part.toLowerCase());
  const sameSiteAttribute = attributes.find((part) => part.startsWith("samesite="));
  const sameSiteValue = sameSiteAttribute?.slice("samesite=".length);
  const sameSite = sameSiteValue === "strict" || sameSiteValue === "lax" || sameSiteValue === "none"
    ? sameSiteValue
    : undefined;
  return {
    name: pair.slice(0, separator),
    secure: attributes.includes("secure"),
    httpOnly: attributes.includes("httponly"),
    ...(sameSite ? { sameSite } : {})
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        origin: RUNTIME_ORIGIN_PROBE,
        "user-agent": "Ship-Check/runtime-probe"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function selectedHeaders(headers: Headers): RuntimeHttpEvidence["headers"] {
  const value = (name: string) => headers.get(name) ?? undefined;
  return {
    ...(value("strict-transport-security") ? { strictTransportSecurity: value("strict-transport-security") } : {}),
    ...(value("content-security-policy") ? { contentSecurityPolicy: value("content-security-policy") } : {}),
    ...(value("x-content-type-options") ? { xContentTypeOptions: value("x-content-type-options") } : {}),
    ...(value("referrer-policy") ? { referrerPolicy: value("referrer-policy") } : {}),
    ...(value("permissions-policy") ? { permissionsPolicy: value("permissions-policy") } : {}),
    ...(value("access-control-allow-origin") ? { accessControlAllowOrigin: value("access-control-allow-origin") } : {}),
    ...(value("access-control-allow-credentials") ? { accessControlAllowCredentials: value("access-control-allow-credentials") } : {})
  };
}

function setCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") return extended.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

/** Inspects a bounded HTML prefix and public HTTP metadata, without retaining HTML.
 * A single generic asset path is only a possible hint; generator/REST markers
 * support a likely classification. Conflicting CMS signals are inconclusive.
 */
export function detectPublicCms(headers: Headers, html = ""):
  RuntimeHttpEvidence["cms"] {
  const generator = headers.get("x-generator") ?? "";
  const links = headers.get("link") ?? "";
  const signals = {
    wordpress: [
      /\bwordpress(?:[ /][0-9.]+)?\b/i.test(generator) || /<meta\s+[^>]*name\s*=\s*["']generator["'][^>]*content\s*=\s*["']WordPress\b/i.test(html) ? "WordPress generator" : null,
      /api\.w\.org/i.test(links) || /<link\s+[^>]*rel\s*=\s*["']https:\/\/api\.w\.org\//i.test(html) ? "WordPress REST discovery" : null,
      /\/wp-content\/(?:themes|plugins)\//i.test(html) ? "WordPress asset path" : null
    ],
    drupal: [
      /\bdrupal\b/i.test(generator) || /<meta\s+[^>]*content\s*=\s*["']Drupal\b/i.test(html) ? "Drupal generator" : null,
      /\bdrupalSettings\b|data-drupal-selector\s*=/i.test(html) ? "Drupal front-end attributes" : null,
      /\/sites\/(?:default|all)\/files\//i.test(html) ? "Drupal asset path" : null
    ]
  };
  const wp = signals.wordpress.filter((x): x is string => x !== null);
  const dr = signals.drupal.filter((x): x is string => x !== null);
  if (wp.length && dr.length) return undefined;
  const id = wp.length ? "wordpress" : dr.length ? "drupal" : undefined;
  if (!id) return undefined;
  const observed = id==="wordpress" ? wp : dr;
  const confidence = observed.some(x=>x.includes("generator")||x.includes("REST")||x.includes("front-end")) || observed.length > 1
    ? "likely" : "possible";
  return {id,confidence,signals:observed};
}

async function readPublicHtmlPrefix(response: Response): Promise<string> {
  if (!/\btext\/html\b|\bapplication\/xhtml\+xml\b/i.test(response.headers.get("content-type")??"")) {
    await response.body?.cancel();
    return "";
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const limit = 32 * 1024;
  const timer = setTimeout(()=>{void reader.cancel().catch(()=>{});},3000);
  try {
    while (size < limit) {
      const {done,value} = await reader.read();
      if (done) break;
      const chunk = value.subarray(0,limit-size);
      chunks.push(chunk);
      size += chunk.byteLength;
      if (chunk.length < value.length) break;
    }
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  return new TextDecoder("utf-8",{fatal:false}).decode(Buffer.concat(chunks,size));
}

export async function probeRuntimeTarget(
  target: URL,
  options: Pick<RuntimeScanOptions, "fetchImpl" | "timeoutMs"> = {}
): Promise<RuntimeHttpEvidence> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const redirects: RuntimeHttpRedirectEvidence[] = [];
  let current = new URL(target);

  for (let index = 0; index <= MAX_REDIRECTS; index += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(fetchImpl, current, timeoutMs);
    } catch (error) {
      throw new Error(`Runtime probe could not reach ${current.toString()}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (index === MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new Error(`Runtime probe stopped after ${MAX_REDIRECTS} redirects.`);
      }
      const next = new URL(location, current);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        await response.body?.cancel();
        throw new Error(`Runtime probe refused a redirect to unsupported protocol ${next.protocol}.`);
      }
      redirects.push({ from: current.toString(), to: next.toString(), status: response.status });
      await response.body?.cancel();
      current = next;
      continue;
    }

    const cookies = setCookieHeaders(response.headers)
      .map(cookieEvidence)
      .filter((cookie): cookie is RuntimeHttpCookieEvidence => cookie !== null);
    const html = await readPublicHtmlPrefix(response);
    const cms = detectPublicCms(response.headers,html);
    const evidence: RuntimeHttpEvidence = {
      ...(cms ? {cms} : {}),
      requestedUrl: target.toString(),
      finalUrl: current.toString(),
      status: response.status,
      redirects,
      requestOrigin: RUNTIME_ORIGIN_PROBE,
      headers: selectedHeaders(response.headers),
      cookies
    };
    return evidence;
  }

  throw new Error("Runtime probe did not produce a response.");
}

export async function scanRuntimeTarget(
  targetValue: string,
  sourceChecks: SourceCheckDescriptor[],
  runtimeChecks: RuntimeCheckDefinition[],
  version = "0.0.0-alpha.7",
  options: RuntimeScanOptions = {}
): Promise<ScanReport> {
  const target = parseRuntimeTargetUrl(targetValue);
  if (!target) throw new Error("Ship Check runtime scans require an http:// or https:// deployment URL.");

  const source = ProjectEvidenceSourceSchema.parse({
    schemaVersion: "0.1",
    id: `url:${target.toString()}`,
    type: "deployment",
    provider: "url",
    label: target.toString(),
    acquisition: "runtime-probe",
    executionLocation: options.executionLocation ?? "user-device",
    capabilities: ["runtime-http"],
    ephemeral: true,
    acquiredAt: new Date().toISOString()
  });
  const snapshot = createProjectSnapshot({
    source,
    inventorySource: "filesystem",
    fileCount: 0
  });
  const http = await probeRuntimeTarget(target, options);
  const context: RuntimeContext = { source, target, http };
  const findings: Finding[] = [];
  const gaps: AssessmentGap[] = [];
  const observations: Observation[] = [];
  const results: CheckResult[] = [];
  const coverageContributions: Array<RuntimeCoverageContribution & { checkId: string }> = [];

  for (const check of sourceChecks) {
    const requiredEvidence = check.requiresEvidence ?? ["source-files"];
    const missingEvidence = requiredEvidence.filter(
      (capability) => !source.capabilities.includes(capability)
    );
    results.push({
      checkId: check.id,
      checkVersion: check.version ?? DEFAULT_CHECK_VERSION,
      pack: check.pack,
      principles: check.principles ?? [],
      status: "not-assessed",
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : ["source-files"],
      findingCount: 0,
      suppressedCount: 0,
      gapCount: 0,
      observationCount: 0,
      durationMs: 0
    });
  }

  for (const check of runtimeChecks) {
    const started = performance.now();
    const checkVersion = check.version ?? DEFAULT_CHECK_VERSION;
    const requiredEvidence = check.requiresEvidence ?? ["runtime-http"];
    const missingEvidence = requiredEvidence.filter(
      (capability) => !source.capabilities.includes(capability)
    );
    if (missingEvidence.length > 0) {
      results.push({
        checkId: check.id,
        checkVersion,
        pack: check.pack,
        principles: check.principles ?? [],
        status: "not-assessed",
        missingEvidence,
        findingCount: 0,
        suppressedCount: 0,
        gapCount: 0,
        observationCount: 0,
        durationMs: Math.max(0, Math.round(performance.now() - started))
      });
      continue;
    }

    try {
      if (check.appliesTo && !(await check.appliesTo(context))) {
        results.push({
          checkId: check.id,
          checkVersion,
          pack: check.pack,
          principles: check.principles ?? [],
          status: "not-applicable",
          missingEvidence: [],
          findingCount: 0,
          suppressedCount: 0,
          gapCount: 0,
          observationCount: 0,
          durationMs: Math.max(0, Math.round(performance.now() - started))
        });
        continue;
      }
      const execution = normaliseRuntimeExecution(await check.run(context));
      findings.push(...execution.findings);
      gaps.push(...execution.gaps);
      observations.push(...execution.observations);
      for (const contribution of [...(check.coverage ?? []), ...execution.coverage]) {
        coverageContributions.push({ ...contribution, checkId: check.id });
      }
      results.push({
        checkId: check.id,
        checkVersion,
        pack: check.pack,
        principles: check.principles ?? [],
        status: execution.findings.length > 0
          ? "findings"
          : execution.gaps.length > 0
            ? "unverified"
            : "passed",
        missingEvidence: [],
        findingCount: execution.findings.length,
        suppressedCount: 0,
        gapCount: execution.gaps.length,
        observationCount: execution.observations.length,
        durationMs: Math.max(0, Math.round(performance.now() - started))
      });
    } catch (error) {
      results.push({
        checkId: check.id,
        checkVersion,
        pack: check.pack,
        principles: check.principles ?? [],
        status: "error",
        missingEvidence: [],
        findingCount: 0,
        suppressedCount: 0,
        gapCount: 0,
        observationCount: 0,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return ScanReportSchema.parse({
    schemaVersion: "0.1",
    tool: { name: "ship-check", version },
    project: {
      path: target.toString(),
      gitRepository: false,
      inventorySource: "filesystem",
      fileCount: 0,
      snapshot
    },
    packs: [...new Set([...sourceChecks, ...runtimeChecks].map((check) => check.pack))],
    checks: results,
    ruleset: createRulesetProvenance([...sourceChecks, ...runtimeChecks]),
    findings: findings.sort((a, b) => `${a.severity}:${a.id}`.localeCompare(`${b.severity}:${b.id}`)),
    suppressedFindings: [],
    gaps: gaps.sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`)),
    observations: observations.sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`)),
    coverage: summariseCoverage(coverageContributions),
    summary: summarise(findings),
    generatedAt: new Date().toISOString()
  });
}
