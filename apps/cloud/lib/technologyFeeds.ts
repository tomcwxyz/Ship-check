import type { IntelligenceNotice } from "@ship-check/cloud-runtime";

const OPENAI_URL = "https://api.openai.com/v1/models";
const OPENAI_REFERENCE = "https://developers.openai.com/api/docs/deprecations";
const ANTHROPIC_URL = "https://platform.claude.com/docs/en/about-claude/model-deprecations";
const ID = /^[a-z0-9._/-]{1,160}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 1_000_000;

export type FeedResult = {
  provider: "openai" | "anthropic";
  notices: IntelligenceNotice[];
  checkedAt: string;
};

function calendarDate(input: string): boolean {
  if (!DATE.test(input)) return false;
  return new Date(input + "T00:00:00Z").toISOString().slice(0, 10) === input;
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.ok) throw new Error("feed-http-error");
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BODY) throw new Error("feed-too-large");
  const body = await response.text();
  if (body.length > MAX_BODY) throw new Error("feed-too-large");
  return body;
}

/** Uses the documented optional shutdown_date field, not disappearance from a list. */
export function parseOpenAIModels(payload: unknown, checkedAt: string): IntelligenceNotice[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as {data?:unknown}).data)) {
    throw new Error("invalid-openai-model-list");
  }
  const data = (payload as {data:unknown[]}).data;
  if (data.length > 5000) throw new Error("oversized-openai-model-list");
  const notices: IntelligenceNotice[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !ID.test(item.id)) continue;
    if (typeof item.shutdown_date !== "string" || !calendarDate(item.shutdown_date)) continue;
    const date = item.shutdown_date;
    notices.push({
      id: "openai-retirement:" + item.id + ":" + date,
      kind: "retirement",
      componentKind: "ai-model",
      componentId: item.id,
      effectiveDate: date,
      publishedAt: checkedAt, // Observed from API, not claimed announcement date.
      fetchedAt: checkedAt,
      sourceUrl: OPENAI_REFERENCE,
      summary: item.id + " has an OpenAI API shutdown date of " + date + ". Confirm production model selection."
    });
  }
  return notices;
}

const MONTHS: Record<string, string> = {
  january:"01", february:"02", march:"03", april:"04", may:"05", june:"06",
  july:"07", august:"08", september:"09", october:"10", november:"11", december:"12"
};
function explicitEnglishDate(value: string): string | null {
  const match = value.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (!match) return null;
  const date = match[3] + "-" + MONTHS[match[1]!.toLowerCase()] + "-" + match[2]!.padStart(2, "0");
  return calendarDate(date) ? date : null;
}

function cellText(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

/**
 * Strictly parse official HTML table rows with an explicit Deprecated or
 * Retired state. Ignore Active and "Not sooner than" dates completely.
 * If the layout changes, fail closed and keep the previous alerts.
 */
export function parseAnthropicTable(html: string, checkedAt: string): IntelligenceNotice[] {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const notices: IntelligenceNotice[] = [];
  let modelRows = 0;
  for (const row of rows) {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x => cellText(x[1]!));
    if (cells.length < 4) continue;
    const model = cells[0]?.match(/\bclaude-[a-z0-9.-]+\b/i)?.[0];
    if (!model || !ID.test(model)) continue;
    modelRows += 1;
    const state = cells[1]?.trim().toLowerCase();
    if (state !== "deprecated" && state !== "retired") continue;
    if (/not sooner than|to be announced|not announced/i.test(cells[3] ?? "")) continue;
    const date = explicitEnglishDate(cells[3] ?? "");
    if (!date) continue;
    notices.push({
      id: "anthropic-retirement:" + model + ":" + date,
      kind: "retirement",
      componentKind: "ai-model",
      componentId: model,
      effectiveDate: date,
      publishedAt: checkedAt,
      fetchedAt: checkedAt,
      sourceUrl: ANTHROPIC_URL,
      summary: model + " is listed as " + state + " with a retirement date of " + date + " on Anthropic-operated platforms. Other hosts can differ."
    });
  }
  if (modelRows < 3) throw new Error("anthropic-layout-unverified");
  return notices;
}

export async function fetchOpenAIFeed(key: string, now: string, fetcher: typeof fetch = fetch): Promise<FeedResult> {
  if (!key.trim()) throw new Error("openai-not-configured");
  const response = await fetcher(OPENAI_URL, {
    method: "GET",
    headers: { authorization: "Bearer " + key, accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000)
  });
  const body = await boundedBody(response);
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new Error("openai-invalid-json"); }
  return { provider: "openai", checkedAt: now, notices: parseOpenAIModels(parsed, now) };
}

export async function fetchAnthropicFeed(now: string, fetcher: typeof fetch = fetch): Promise<FeedResult> {
  const response = await fetcher(ANTHROPIC_URL, {
    method: "GET",
    headers: { accept: "text/html" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000)
  });
  const html = await boundedBody(response);
  return { provider: "anthropic", checkedAt: now, notices: parseAnthropicTable(html, now) };
}
