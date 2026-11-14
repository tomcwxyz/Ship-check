import type { IntelligenceNotice } from "@ship-check/cloud-runtime";

/**
 * Conservative reader for the official Drupal security feeds.
 * Only exact advisory IDs and explicitly supplied project machine names
 * can become matches. Versions affected are NOT inferred from the RSS feed.
 */
const FEEDS = [
  "https://www.drupal.org/security/contrib/rss.xml",
  "https://www.drupal.org/security/rss.xml"
] as const;
const MAX_RESPONSE = 1_250_000;
const MAX_NOTICES = 150;
const ADVISORY = /\bSA-(?:CONTRIB|CORE)-20\d{2}-\d{3}\b/i;
const MACHINE = /project\s+machine\s+name\s*:\s*([a-z][a-z0-9_]*)/i;

export type DrupalFeedResult = {
  provider: "drupal";
  notices: IntelligenceNotice[];
  checkedAt: string;
};

function decoded(value: string): string {
  const raw = value.trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1");
  return raw.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}
function content(item: string, tag: string): string {
  return decoded(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i").exec(item)?.[1] ?? "");
}
function flatText(value: string): string {
  return decoded(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function officialUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "https:" && parsed.hostname === "www.drupal.org"
      && !parsed.username && !parsed.password && parsed.pathname.length < 220
      ? parsed.origin + parsed.pathname
      : null;
  } catch {
    return null;
  }
}

export function parseDrupalRss(xml: string, checkedAt: string): IntelligenceNotice[] {
  if (xml.length > MAX_RESPONSE || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) {
    throw new Error("drupal-unrecognised-feed");
  }
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (!items.length || items.length > 200) throw new Error("drupal-unrecognised-feed");
  const notices: IntelligenceNotice[] = [];
  for (const [, item] of items) {
    if (!item) continue;
    const title = flatText(content(item, "title")).slice(0, 280);
    const id = ADVISORY.exec(title)?.[0]?.toUpperCase();
    const url = officialUrl(content(item, "link"));
    if (!id || !url) continue;
    const description = content(item, "description") + " " + content(item, "content:encoded");
    const plain = flatText(description);
    const machine = MACHINE.exec(plain)?.[1];
    const publishedRaw = content(item, "pubDate");
    const publication = Date.parse(publishedRaw);
    const publishedAt = Number.isFinite(publication) && publication <= Date.parse(checkedAt)
      ? new Date(publication).toISOString() : checkedAt;
    if (id.startsWith("SA-CONTRIB-")) {
      if (!machine) continue;
      notices.push({
        id: "drupal:" + id, kind: "vulnerability",
        componentKind: "drupal-package", componentId: "drupal/" + machine,
        publishedAt, fetchedAt: checkedAt, sourceUrl: url,
        summary: title + ". Version impact and deployment status require verification."
      });
    } else if (id.startsWith("SA-CORE-")) {
      for (const componentId of ["drupal/core", "drupal/core-recommended"]) {
        notices.push({
          id: "drupal:" + id, kind: "vulnerability",
          componentKind: "drupal-package", componentId,
          publishedAt, fetchedAt: checkedAt, sourceUrl: url,
          summary: title + ". Version impact and deployment status require verification."
        });
      }
    }
    if (notices.length >= MAX_NOTICES) break;
  }
  if (!notices.length) throw new Error("drupal-no-verified-projects");
  return notices;
}

async function getBody(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, {
    method: "GET", cache: "no-store", redirect: "error",
    headers: { accept: "application/rss+xml, application/xml" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("drupal-feed-http-error");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE) throw new Error("drupal-feed-too-large");
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE) throw new Error("drupal-feed-too-large");
  return raw;
}

export async function fetchDrupalFeeds(now: string, fetcher: typeof fetch = fetch): Promise<DrupalFeedResult> {
  const settled = await Promise.allSettled(FEEDS.map(async url => parseDrupalRss(await getBody(url, fetcher), now)));
  if (settled.some(entry => entry.status === "rejected")) throw new Error("drupal-feed-incomplete");
  const dedup = new Map<string, IntelligenceNotice>();
  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      for (const notice of entry.value) dedup.set(notice.id + ":" + notice.componentId, notice);
    }
  }
  return { provider: "drupal", notices: [...dedup.values()], checkedAt: now };
}
