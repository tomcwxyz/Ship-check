import { createHmac, timingSafeEqual } from "node:crypto";
import type { CloudHistoryDatabase } from "@ship-check/adapters";
import type { IntelligenceNotice, MonitoredComponent } from "@ship-check/cloud-runtime";

type Range = {
  from: string; to: string;
  fromInclusive: boolean; toInclusive: boolean;
};
export type WordfenceAdvisory = {
  advisoryId: string;
  componentKind: "wordpress-core" | "wordpress-plugin" | "wordpress-theme";
  componentId: string;
  title: string;
  publishedAt: string;
  ranges: Range[];
  sourceUrl: string;
};
export type WordfenceChange = {
  upserts: WordfenceAdvisory[];
  deletions: string[];
};
type WordfenceRow = {
  advisory_id: string;
  component_kind: WordfenceAdvisory["componentKind"];
  component_id: string;
  title: string;
  published_at: string | Date;
  affected_ranges: Range[];
  source_url: string;
};

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const NUMBER_VERSION = /^\d+(?:\.\d+){0,5}$/;
const MAX_CHANGES = 50;

export function verifyWordfenceSignature(body: string, signature: string | null, secret: string): boolean {
  if (!secret || secret.length < 32 || !signature) return false;
  const value = signature.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(value)) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body, "utf8").digest("hex"), "hex");
  const supplied = Buffer.from(value, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}
function rangeList(raw: unknown): Range[] {
  if (!asRecord(raw)) return [];
  const values = Object.values(raw as Record<string, unknown>);
  if (values.length > 16) throw new Error("Too many affected ranges.");
  return values.flatMap(value => {
    const data = asRecord(value);
    if (!data) return [];
    const from = data.from_version, to = data.to_version;
    if (typeof from !== "string" || typeof to !== "string" ||
        from.length > 40 || to.length > 40) return [];
    return [{
      from, to,
      fromInclusive: data.from_inclusive === true,
      toInclusive: data.to_inclusive === true
    }];
  });
}
function iso(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.parse(fallback)
    ? new Date(timestamp).toISOString() : fallback;
}

export function parseWordfenceChange(payload: unknown, now: string): WordfenceChange {
  const root = asRecord(payload);
  const changes = asRecord(root?.vulnerabilities);
  if (!changes) throw new Error("Invalid Wordfence event.");
  const created = changes.created ?? [];
  const replaced = changes.replaced ?? [];
  const deleted = changes.deleted ?? [];
  if (!Array.isArray(created) || !Array.isArray(replaced) || !Array.isArray(deleted) ||
      created.length + replaced.length + deleted.length > MAX_CHANGES) {
    throw new Error("Wordfence update is too large.");
  }
  const deletions = deleted.filter((id): id is string => typeof id === "string" && UUID.test(id));
  const upserts: WordfenceAdvisory[] = [];
  for (const raw of [...created, ...replaced]) {
    const record = asRecord(raw);
    if (!record || typeof record.id !== "string" || !UUID.test(record.id)) continue;
    const software = record.software;
    if (!Array.isArray(software) || software.length > 20) continue;
    const title = typeof record.title === "string" ? record.title.slice(0, 280).trim() : "";
    if (!title) continue;
    const publishedAt = iso(record.published, now);
    for (const item of software) {
      const component = asRecord(item);
      if (!component || typeof component.type !== "string") continue;
      let kind: WordfenceAdvisory["componentKind"];
      if (component.type === "plugin") kind = "wordpress-plugin";
      else if (component.type === "theme") kind = "wordpress-theme";
      else if (component.type === "core") kind = "wordpress-core";
      else continue;
      const slug = kind === "wordpress-core" ? "wordpress" : component.slug;
      if (typeof slug !== "string" || !SLUG.test(slug)) continue;
      upserts.push({
        advisoryId: record.id,
        componentKind: kind,
        componentId: slug,
        title, publishedAt,
        ranges: rangeList(component.affected_versions),
        sourceUrl: "https://www.wordfence.com/threat-intel/vulnerabilities/id/" + record.id
      });
      if (upserts.length > 100) throw new Error("Too many software records.");
    }
  }
  return { upserts, deletions };
}

export async function applyWordfenceChange(
  db: CloudHistoryDatabase, change: WordfenceChange
): Promise<void> {
  await db.transaction(async tx => {
    const touched = new Set(change.upserts.map(item => item.advisoryId));
    for (const id of [...new Set([...change.deletions, ...touched])]) {
      await tx.query("DELETE FROM ship_check_wordfence_advisories WHERE advisory_id=$1", [id]);
      if (change.deletions.includes(id)) {
        await tx.query("UPDATE ship_check_technology_alerts SET active=false WHERE provider='wordpress' AND notice_id=$1",
          ["wordfence:" + id]);
      }
    }
    for (const item of change.upserts) {
      await tx.query(
        "INSERT INTO ship_check_wordfence_advisories (advisory_id,component_kind,component_id,title,published_at,affected_ranges,source_url) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)",
        [item.advisoryId,item.componentKind,item.componentId,item.title,
          item.publishedAt,JSON.stringify(item.ranges),item.sourceUrl]
      );
    }
    await tx.query(
      "INSERT INTO ship_check_technology_feed_status (provider,checked_at,success_at,last_error_code,notice_count) VALUES ('wordpress',now(),now(),NULL,$1) ON CONFLICT(provider) DO UPDATE SET checked_at=now(),success_at=now(),last_error_code=NULL,notice_count=EXCLUDED.notice_count",
      [change.upserts.length + change.deletions.length]
    );
  });
}

function compareNumericVersion(left: string, right: string): number | null {
  if (!NUMBER_VERSION.test(left) || !NUMBER_VERSION.test(right)) return null;
  const a=left.split(".").map(Number), b=right.split(".").map(Number);
  for (let i=0;i<Math.max(a.length,b.length);i++) {
    const delta=(a[i]??0)-(b[i]??0);
    if(delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}
/** true = affected, false = proven unaffected, null = cannot compare safely. */
export function affectedByWordfenceRanges(version: string | undefined, ranges: readonly Range[]): boolean | null {
  if (!version || !ranges.length) return null;
  let uncertain=false;
  for (const range of ranges) {
    const lower=range.from === "*" ? 1 : compareNumericVersion(version, range.from);
    const upper=range.to === "*" ? -1 : compareNumericVersion(version, range.to);
    if (lower === null || upper === null) { uncertain=true; continue; }
    const insideLower = lower > 0 || (lower === 0 && range.fromInclusive);
    const insideUpper = upper < 0 || (upper === 0 && range.toInclusive);
    if (insideLower && insideUpper) return true;
  }
  return uncertain ? null : false;
}

export function wordfenceNoticeForComponent(
  record: WordfenceAdvisory, component: MonitoredComponent, now: string
): IntelligenceNotice | null {
  if (component.kind !== record.componentKind || component.id !== record.componentId) return null;
  const affected=affectedByWordfenceRanges(component.version, record.ranges);
  if (affected === false) return null;
  return {
    id: "wordfence:" + record.advisoryId,
    kind: "vulnerability",
    componentKind: record.componentKind,
    componentId: record.componentId,
    ...(affected === true && component.version ? { affectedVersions: [component.version] } : {}),
    publishedAt: record.publishedAt,
    fetchedAt: now,
    sourceUrl: record.sourceUrl,
    summary: record.title + ". " + (affected === true
      ? "Source version falls within the recorded affected range; deployment must still be checked."
      : "Installed version or affected range could not be established.")
  };
}

export async function loadWordfenceAdvisories(db: CloudHistoryDatabase): Promise<WordfenceAdvisory[]> {
  const response = await db.query<WordfenceRow>(
    "SELECT DISTINCT w.advisory_id,w.component_kind,w.component_id,w.title,w.published_at,w.affected_ranges,w.source_url FROM ship_check_wordfence_advisories w INNER JOIN ship_check_technology_components c ON c.kind=w.component_kind AND c.component_id=w.component_id INNER JOIN ship_check_technology_monitoring m ON m.project_id=c.project_id ORDER BY w.published_at DESC LIMIT 2001"
  );
  if (response.rows.length > 2000) throw new Error("wordfence-capacity-exceeded");
  return response.rows.map(row => ({
    advisoryId: row.advisory_id, componentKind: row.component_kind, componentId: row.component_id,
    title: row.title, publishedAt: new Date(row.published_at).toISOString(),
    ranges: Array.isArray(row.affected_ranges) ? row.affected_ranges : [],
    sourceUrl: row.source_url
  }));
}
