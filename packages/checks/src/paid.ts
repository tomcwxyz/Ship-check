import type { CheckDefinition, CheckExecution } from "@ship-check/core";
import type { Finding } from "@ship-check/schemas";
import { traceLocalImports, type TracedSource } from "./surface.js";

const API_HANDLER = /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i;
const TEST_SOURCE = /(?:^|\/)[^/]+\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/i;
const REQUEST_HANDLER = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)/;

// Match executable paid/metered operations rather than provider names,
// configuration, type signatures or prose comments. AI SDK calls are required
// to start an object-literal invocation so `interface { generateText(input) }`
// does not masquerade as runtime work.
export const PAID_OPERATION_PATTERN = /(?:\b(?:generateText|generateObject|streamText|embed|embedMany)\s*\(\s*\{|\.generateText\s*\(\s*\{|\bchat\.completions\.create\s*\(|\bresponses\.create\s*\(|\bmessages\.create\s*\(|\baudio\.transcriptions\.create\s*\(|\bemails\.send\s*\(|\b(?:scrapeUrl|crawlUrl)\s*\(|https:\/\/(?:api\.openai\.com|api\.anthropic\.com|api\.resend\.com|api\.firecrawl\.dev|api\.perplexity\.ai)\b)/i;

const ABUSE_CONTROL_PATTERN = /\b(?:rate.?limit|Ratelimit|turnstile|captcha|hcaptcha|recaptcha|requireAuth|requireUser|requireSession|getServerSession|currentUser|verifyToken|verifySession|auth\s*\(|getUser\s*\(|session\s*=|\.auth\.getContext\s*\(|constructEvent|verifyWebhook|verifySignature|webhooks\.verify|createHmac|timingSafeEqual|svix)\b/i;
const MAX_IMPORT_DEPTH = 2;

function isRuntimeApiHandler(file: string): boolean {
  return API_HANDLER.test(file) && !TEST_SOURCE.test(file);
}

function withoutComments(text: string): string {
  let output = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (current === "\n" || current === "\r") {
        lineComment = false;
        output += current;
      } else {
        output += " ";
      }
      continue;
    }

    if (blockComment) {
      if (current === "*" && next === "/") {
        output += "  ";
        blockComment = false;
        index += 1;
      } else {
        output += current === "\n" || current === "\r" ? current : " ";
      }
      continue;
    }

    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = null;
      continue;
    }

    if (current === "'" || current === '"' || current === "`") {
      quote = current;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function sourceHasPattern(source: TracedSource, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(withoutComments(source.text));
}

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
    if (sourceHasPattern(source, pattern)) return source;
  }
  return null;
}

export const calibratedPaidEndpointCheck: CheckDefinition = {
  appliesTo: (context) => context.files.some(isRuntimeApiHandler),
  id: "secure.paid-endpoint-abuse-control",
  version: "2",
  pack: "secure-build",
  title: "Paid public endpoints",
  description: "Trace bounded local imports from deployable API handlers and flag repository-visible paid operations only when no visible abuse-control or signed-webhook boundary is present.",
  principles: ["practice.preserve-safety", "practice.cost-discipline"],
  async run(context): Promise<CheckExecution> {
    const findings: Finding[] = [];
    for (const file of context.files.filter(isRuntimeApiHandler)) {
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
