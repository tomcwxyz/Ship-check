import path from "node:path";
import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Finding } from "@ship-check/schemas";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_IMPORT_DEPTH = 2;
const MAX_IMPORTED_FILES = 16;

function finding(input: {
  checkId: string;
  suffix: string;
  title: string;
  summary: string;
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: "secure-build",
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    confidence: input.confidence,
    evidence: input.evidence,
    remediation: {
      why: input.why,
      fix: input.fix,
      verify: input.verify,
      agentPrompt: input.agentPrompt
    }
  };
}

function gap(input: {
  checkId: string;
  area: AssessmentGap["area"];
  suffix: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: "secure-build",
    area: input.area,
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

function isApiHandler(file: string): boolean {
  return /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i.test(file);
}

function importSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function candidateBase(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  }
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return path.posix.normalize(specifier.slice(2));
  }
  return null;
}

function resolveLocalImport(context: ProjectContext, fromFile: string, specifier: string): string | null {
  const base = candidateBase(fromFile, specifier);
  if (!base || base.startsWith("../")) return null;
  const candidates = [base];
  if (!SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension))) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`));
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`));
  }
  return candidates.find((candidate) => context.hasFile(candidate)) ?? null;
}

export type TracedSource = { file: string; text: string; depth: number };

export async function traceLocalImports(
  context: ProjectContext,
  entryFile: string,
  maxDepth = MAX_IMPORT_DEPTH,
  maxFiles = MAX_IMPORTED_FILES
): Promise<TracedSource[]> {
  const queue: Array<{ file: string; depth: number }> = [{ file: entryFile, depth: 0 }];
  const visited = new Set<string>();
  const output: TracedSource[] = [];

  while (queue.length > 0 && output.length < maxFiles) {
    const current = queue.shift();
    if (!current || visited.has(current.file)) continue;
    visited.add(current.file);
    const text = await context.readText(current.file);
    if (!text) continue;
    output.push({ file: current.file, text, depth: current.depth });
    if (current.depth >= maxDepth) continue;
    for (const specifier of importSpecifiers(text)) {
      const resolved = resolveLocalImport(context, current.file, specifier);
      if (resolved && !visited.has(resolved)) queue.push({ file: resolved, depth: current.depth + 1 });
    }
  }

  return output;
}

function firstMatchingSource(sources: TracedSource[], pattern: RegExp): TracedSource | null {
  for (const source of sources) {
    pattern.lastIndex = 0;
    if (pattern.test(source.text)) return source;
  }
  return null;
}

function inspectedHelpers(sources: TracedSource[]): string[] {
  return sources.filter((source) => source.depth > 0).map((source) => source.file);
}

const requestHandlerPattern = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)/;
const paidProviderPattern = /\b(?:OpenAI|Anthropic|Resend|Firecrawl|Stripe|generateText|generateObject|streamText|chat\.completions|responses\.create|messages\.create)\b/i;
const abuseControlPattern = /\b(?:rate.?limit|Ratelimit|turnstile|captcha|hcaptcha|recaptcha|requireAuth|requireUser|getServerSession|currentUser|getUser|verifyToken|auth\s*\(|session)\b/i;

export const importedAwarePaidEndpointCheck: CheckDefinition = {
  id: "secure.paid-endpoint-abuse-control",
  pack: "secure-build",
  title: "Paid public endpoints",
  description: "Trace bounded local imports from API handlers before deciding whether paid-service work lacks visible auth or abuse controls.",
  principles: ["practice.preserve-safety", "practice.cost-discipline"],
  async run(context): Promise<CheckExecution> {
    const findings: Finding[] = [];
    for (const file of context.files.filter(isApiHandler)) {
      const entryText = await context.readText(file);
      if (!entryText || !requestHandlerPattern.test(entryText)) continue;
      const sources = await traceLocalImports(context, file);
      const paidSource = firstMatchingSource(sources, paidProviderPattern);
      if (!paidSource) continue;
      const controlSource = firstMatchingSource(sources, abuseControlPattern);
      if (controlSource) continue;
      const helpers = inspectedHelpers(sources);
      findings.push(finding({
        checkId: this.id,
        suffix: file,
        title: "Paid API work appears reachable without an obvious abuse control",
        summary: `${file} reaches paid-service code${paidSource.file !== file ? ` via ${paidSource.file}` : ""}, but Ship Check found no recognised authentication, rate-limit or bot-control marker in the handler or ${helpers.length} traced local helper${helpers.length === 1 ? "" : "s"}.`,
        severity: "high",
        confidence: helpers.length > 0 ? "medium" : "medium",
        evidence: [
          { kind: "file-match", path: file, detail: `Public request handler inspected with up to ${MAX_IMPORT_DEPTH} local import levels.` },
          ...(paidSource.file !== file ? [{ kind: "file-match" as const, path: paidSource.file, detail: "Paid-service marker reached through a traced local import." }] : [])
        ],
        why: "Public endpoints that trigger paid services can be scripted repeatedly, creating cost spikes or spam even when normal usage looks fine.",
        fix: "Add the narrowest appropriate server-side rate limit plus authentication or bot protection at a boundary that reliably executes before paid work. If protection exists outside the traced local import graph, document and test it.",
        verify: "Exercise the endpoint anonymously and above the intended rate threshold, confirm requests are rejected before paid work begins, then rerun Ship Check.",
        agentPrompt: `Review ${file} and its local call path to ${paidSource.file}. Add or prove the narrowest appropriate authentication/rate-limit/bot boundary before paid work, preserve legitimate usage, and add an abuse-path test.`
      }));
    }
    return { findings, coverage: [{ area: "access-control", status: "partial" }, { area: "cost", status: "partial" }] };
  }
};

const webhookMarkerPattern = /\b(?:stripe\.webhooks|svix|webhook)\b/i;
const webhookVerificationPattern = /\b(?:constructEvent|verifyWebhook|verifySignature|webhooks\.verify|createHmac|timingSafeEqual|svix)\b/i;

export const importedAwareWebhookCheck: CheckDefinition = {
  id: "secure.webhook-signature-verification",
  pack: "secure-build",
  title: "Webhook signature verification",
  description: "Trace bounded local imports from webhook handlers before recording a signature-verification evidence gap.",
  principles: ["practice.preserve-safety"],
  async run(context): Promise<CheckExecution> {
    const gaps: AssessmentGap[] = [];
    let candidates = 0;
    for (const file of context.files.filter(isApiHandler)) {
      const sources = await traceLocalImports(context, file);
      if (sources.length === 0) continue;
      const looksLikeWebhook = /webhooks?/i.test(file) || Boolean(firstMatchingSource(sources, webhookMarkerPattern));
      if (!looksLikeWebhook) continue;
      candidates += 1;
      if (firstMatchingSource(sources, webhookVerificationPattern)) continue;
      const helpers = inspectedHelpers(sources);
      gaps.push(gap({
        checkId: this.id,
        area: "access-control",
        suffix: file,
        title: "Webhook verification could not be established",
        summary: `${file} looks like a webhook receiver, but Ship Check found no recognised signature/HMAC verification marker in the handler or ${helpers.length} traced local helper${helpers.length === 1 ? "" : "s"}. Verification may still live in middleware, a package wrapper or upstream infrastructure.`,
        evidence: [{ kind: "file-match", path: file, detail: `Webhook-like request boundary inspected with up to ${MAX_IMPORT_DEPTH} local import levels.` }],
        verify: "Trace the deployed request from ingress to side effect and confirm the provider signature is verified against the correct/raw request material before any trusted action occurs."
      }));
    }
    return {
      gaps,
      coverage: candidates > 0 ? [{ area: "access-control", status: "partial" }] : []
    };
  }
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeForCronPath(files: string[], cronPath: string): string | undefined {
  const normalised = cronPath.replace(/^\/+|\/+$/g, "");
  if (!normalised.startsWith("api/")) return undefined;
  const escaped = escapeRegExp(normalised);
  const pattern = new RegExp(
    `(^|/)(?:app/${escaped}/route|pages/${escaped}(?:/index)?)\\.(?:js|jsx|ts|tsx)$`,
    "i"
  );
  return files.find((file) => pattern.test(file));
}

const cronAuthPattern = /\b(?:CRON_SECRET|cronSecret|verifyCron|requireCron|authorization|Bearer)\b/i;

export const importedAwareVercelCronAuthCheck: CheckDefinition = {
  id: "secure.vercel-cron-auth",
  pack: "secure-build",
  title: "Vercel cron endpoint authentication",
  description: "Trace bounded local imports from repository-declared Vercel cron handlers before recording scheduler-auth evidence gaps.",
  principles: ["practice.preserve-safety", "practice.cost-discipline"],
  async run(context): Promise<CheckExecution> {
    const text = await context.readText("vercel.json");
    if (!text) return [];
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      return [];
    }
    const crons = config && typeof config === "object" ? (config as { crons?: unknown }).crons : null;
    if (!Array.isArray(crons) || crons.length === 0) return [];

    const gaps: AssessmentGap[] = [];
    for (const [index, item] of crons.entries()) {
      if (!item || typeof item !== "object") continue;
      const cronPath = (item as { path?: unknown }).path;
      if (typeof cronPath !== "string") continue;
      const route = routeForCronPath(context.files, cronPath);
      if (!route) {
        gaps.push(gap({
          checkId: this.id,
          area: "access-control",
          suffix: `${index}:${cronPath}:missing-route`,
          title: "Cron route authentication could not be traced",
          summary: `${cronPath} is scheduled in vercel.json, but Ship Check could not map it to a recognised Next.js route file.`,
          evidence: [{ kind: "configuration", path: "vercel.json", excerpt: cronPath, detail: "Scheduled route exists but its request handler was not resolved from the repository inventory." }],
          verify: "Locate the deployed handler for this cron path and confirm it rejects requests that do not carry the intended scheduler credential."
        }));
        continue;
      }
      const sources = await traceLocalImports(context, route);
      if (firstMatchingSource(sources, cronAuthPattern)) continue;
      const helpers = inspectedHelpers(sources);
      gaps.push(gap({
        checkId: this.id,
        area: "access-control",
        suffix: `${index}:${cronPath}`,
        title: "Cron endpoint authentication could not be established",
        summary: `${cronPath} maps to ${route}, but Ship Check found no recognised scheduler-secret or Authorization check in the handler or ${helpers.length} traced local helper${helpers.length === 1 ? "" : "s"}. Protection may still live in middleware or hosting configuration.`,
        evidence: [
          { kind: "configuration", path: "vercel.json", excerpt: cronPath, detail: "Vercel cron route declaration." },
          { kind: "file-match", path: route, detail: `Mapped handler inspected with up to ${MAX_IMPORT_DEPTH} local import levels.` }
        ],
        verify: "Call the cron endpoint without its scheduler credential and confirm it is rejected before expensive work or side effects begin."
      }));
    }

    return {
      gaps,
      coverage: [
        { area: "access-control", status: "partial" },
        { area: "cost", status: "partial" }
      ]
    };
  }
};

export const surfaceChecks: CheckDefinition[] = [
  importedAwarePaidEndpointCheck,
  importedAwareWebhookCheck,
  importedAwareVercelCronAuthCheck
];
