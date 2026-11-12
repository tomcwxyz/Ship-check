import { createHash } from "node:crypto";

/**
 * Pure matching layer for a future, opt-in Cloud intelligence service.
 * No network requests, storage, scheduling or notification delivery occurs here.
 * Only reviewed notices and consented component inventories may be passed in.
 */
export type MonitoredComponent = {
  kind: "ai-model" | "wordpress-core" | "wordpress-plugin" | "wordpress-theme" | "drupal-package";
  id: string;
  version?: string;
  evidence: "source-declared" | "runtime-verified";
};

export type IntelligenceNotice = {
  id: string;
  kind: "retirement" | "vulnerability";
  componentKind: MonitoredComponent["kind"];
  componentId: string;
  /** Exact version identifiers only. Do not feed unparsed semver expressions here. */
  affectedVersions?: readonly string[];
  effectiveDate?: string;
  publishedAt: string;
  fetchedAt: string;
  sourceUrl: string;
  summary: string;
  replacement?: string;
};

export type AttentionMatch = {
  identity: string;
  noticeId: string;
  component: MonitoredComponent;
  status: "upcoming" | "urgent" | "past-due" | "needs-verification";
  scope: "source-only" | "runtime-confirmed";
  freshness: "current" | "stale";
  sourceUrl: string;
  summary: string;
  effectiveDate?: string;
  daysRemaining?: number;
  replacement?: string;
};

const DAY_MS = 86400000;
const isCalendarDate = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date + "T00:00:00Z"));

function daysBetween(from: string, until: string): number {
  return Math.round((Date.parse(until + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);
}

function ageDays(from: string, now: string): number {
  const elapsed = Date.parse(now) - Date.parse(from);
  return Math.floor(elapsed / DAY_MS);
}

function noticeMatchesComponent(notice: IntelligenceNotice, component: MonitoredComponent): boolean {
  return notice.componentKind === component.kind && notice.componentId === component.id;
}

/**
 * Match only exact, source-supported IDs and version identifiers.
 * A missing version never yields a confirmed vulnerability finding.
 * Stable identities support deduplication across repeated feed refreshes.
 * Expired feeds are marked stale, never treated as evidence of safety.
 */
export function matchIntelligenceNotices(input: {
  projectIdentity: string;
  components: readonly MonitoredComponent[];
  notices: readonly IntelligenceNotice[];
  now: string;
  urgentWithinDays?: number;
  staleAfterDays?: number;
}): AttentionMatch[] {
  const {
    projectIdentity, components, notices, now,
    urgentWithinDays = 30, staleAfterDays = 7
  } = input;
  if (!projectIdentity.trim()) throw new Error("Project identity is required.");
  if (!Number.isFinite(Date.parse(now))) throw new Error("Valid current time is required.");
  if (urgentWithinDays < 0 || staleAfterDays < 0) throw new Error("Day thresholds must be non-negative.");

  const today = now.slice(0, 10);
  const unique = new Map<string, AttentionMatch>();
  for (const component of components) {
    if (!component.id || !/^[a-z0-9._/-]{1,160}$/i.test(component.id)) continue;
    for (const notice of notices) {
      if (!noticeMatchesComponent(notice, component)) continue;
      if (!notice.id || !/^https:\/\//i.test(notice.sourceUrl)) continue;
      if (!Number.isFinite(Date.parse(notice.fetchedAt)) || !Number.isFinite(Date.parse(notice.publishedAt))) continue;
      if (notice.publishedAt > now) continue;
      const freshness = ageDays(notice.fetchedAt, now) > staleAfterDays ? "stale" : "current";
      let status: AttentionMatch["status"] = "needs-verification";
      let daysRemaining: number | undefined;
      if (notice.kind === "retirement") {
        if (!notice.effectiveDate || !isCalendarDate(notice.effectiveDate)) continue;
        daysRemaining = daysBetween(today, notice.effectiveDate);
        status = daysRemaining <= 0 ? "past-due" : daysRemaining <= urgentWithinDays ? "urgent" : "upcoming";
      } else {
        if (!notice.affectedVersions?.length || !component.version) {
          status = "needs-verification";
        } else if (!notice.affectedVersions.includes(component.version)) {
          continue; // Exact version not in the advisory; never guess ranges.
        } else {
          status = "urgent";
        }
      }
      const identity = createHash("sha256")
        .update([projectIdentity, component.kind, component.id, component.version ?? "", notice.id].join("\u0000"))
        .digest("hex");
      unique.set(identity, {
        identity,
        noticeId: notice.id,
        component,
        status,
        scope: component.evidence === "runtime-verified" ? "runtime-confirmed" : "source-only",
        freshness,
        sourceUrl: notice.sourceUrl,
        summary: notice.summary,
        ...(notice.effectiveDate ? { effectiveDate: notice.effectiveDate } : {}),
        ...(daysRemaining !== undefined ? { daysRemaining } : {}),
        ...(notice.replacement ? { replacement: notice.replacement } : {})
      });
    }
  }
  return [...unique.values()].sort((a, b) => a.identity.localeCompare(b.identity));
}
