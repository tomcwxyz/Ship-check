import type { CheckDefinition, CheckExecution } from "@ship-check/core";
import type { Finding } from "@ship-check/schemas";
import { traceLocalImports, type TracedSource } from "./surface.js";

const API_HANDLER = /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i;
const REQUEST_HANDLER = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)/;

// Intentionally match operations rather than provider names/configuration. Bare
// references such as OPENAI_API_KEY, Stripe types or provider configuration do
// not establish that a request can trigger paid work.
export const PAID_OPERATION_PATTERN = /(?:\b(?:generateText|generateObject|streamText)\s*\(|\bchat\.completions\.create\s*\(|\bresponses\.create\s*\(|\bmessages\.create\s*\(|\baudio\.transcriptions\.create\s*\(|\bemails\.send\s*\(|\b(?:scrapeUrl|crawlUrl)\s*\(|https:\/\/(?:api\.openai\.com|api\.anthropic\.com|api\.resend\.com|api\.firecrawl\.dev|api\.perplexity\.ai)\b)/i;

const ABUSE_CONTROL_PATTERN = /\b(?:rate.?limit|Ratelimit|turnstile|captcha|hcaptcha|recaptcha|requireAuth|requireUser|requireSession|getServerSession|currentUser|verifyToken|verifySession|auth\s*\(|getUser\s*\(|session\s*=|constructEvent|verifyWebhook|verifySignature|webhooks\.verify|createHmac|timingSafeEqual|svix)\b/i;
const MAX_IMPORT_DEPTH = 2;

function finding(input: {
  file: string;
  paidSource: TracedSource;
  helperCount: number;
}): Finding {
  return {
    id: `secure.paid-endpoint-abuse-control:${input.file}`,
    checkId: "secure.paid-endpoint-abuse-control",
    pack: "secure-build",
    title: "Paid API work appears reachable without an obvious abuse control",
    summary: `${input.file} reaches a repository-visible paid operation${input.paidSource.file !== input.file ? ` via ${input.paidSource.file}` : ""}, but Ship Check found no recognised authentication, rate-limit, bot-control or verified-webhook boundary in the handler or ${input.helperCount} traced local helper${input.helperCount === 1 ? "" : "s"}.`,
    severity: "high",
    confidence: "medium",
    evidence: [
      { kind: "file-match", path: input.file, detail: `Public request handler inspected with up to ${MAX_IMPORT_DEPTH} local import levels.` },
      ...(input.paidSource.file !== input.file
        ? [{ kind: "file-match" as const, path: input.paidSource.file, detail: "Paid operation reached through a traced local import." }]
        : [])
    ],
    remediation: {
      why: "Public endpoints that trigger metered or paid services can be scripted repeatedly, creating cost spikes or spam even when normal usage looks fine.",
      fix: "Add the narrowest appropriate server-side rate limit plus authentication, bot protection or provider-signature verification at a boundary that reliably executes before paid work. If protection exists outside the traced local import graph, document and test it.",
      verify: "Exercise the endpoint without the intended protection and above the intended rate threshold, confirm requests are rejected before paid work begins, then rerun Ship Check.",
      agentPrompt: `Review ${input.file} and its local call path to ${input.paidSource.file}. Add or prove the narrowest appropriate authentication/rate-limit/bot/signed-webhook boundary before paid work, preserve legitimate usage, and add an abuse-path test.`
    }
  };
}

function firstMatchingSource(sources: TracedSource[], pattern: RegExp): TracedSource | null {
  for (const source of sources) {
    pattern.lastIndex = 0;
    if (pattern.test(source.text)) return source;
  }
  return null;
}

export const calibratedPaidEndpointCheck: CheckDefinition = {
  appliesTo: (context) => context.files.some((file) => API_HANDLER.test(file)),
  id: "secure.paid-endpoint-abuse-control",
  version: "2",
  pack: "secure-build",
  title: "Paid public endpoints",
  description: "Trace bounded local imports from API handlers and flag repository-visible paid operations only when no visible abuse-control or signed-webhook boundary is present.",
  principles: ["practice.preserve-safety", "practice.cost-discipline"],
  async run(context): Promise<CheckExecution> {
    const findings: Finding[] = [];
    for (const file of context.files.filter((candidate) => API_HANDLER.test(candidate))) {
      const entryText = await context.readText(file);
      if (!entryText || !REQUEST_HANDLER.test(entryText)) continue;

      const sources = await traceLocalImports(context, file);
      const paidSource = firstMatchingSource(sources, PAID_OPERATION_PATTERN);
      if (!paidSource) continue;
      if (firstMatchingSource(sources, ABUSE_CONTROL_PATTERN)) continue;

      findings.push(finding({
        file,
        paidSource,
        helperCount: sources.filter((source) => source.depth > 0).length
      }));
    }

    return {
      findings,
      coverage: [
        { area: "access-control", status: "partial" },
        { area: "cost", status: "partial" }
      ]
    };
  }
};
