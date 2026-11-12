import type { CloudHistoryDatabase } from "@ship-check/adapters";
import { matchIntelligenceNotices, type IntelligenceNotice, type MonitoredComponent } from "@ship-check/cloud-runtime";
import { fetchAnthropicFeed, fetchOpenAIFeed, type FeedResult } from "./technologyFeeds";

type ComponentRow = {
  project_id: string;
  kind: MonitoredComponent["kind"];
  component_id: string;
  version: string | null;
  evidence: MonitoredComponent["evidence"];
};

export type RefreshSummary = {
  checkedAt: string;
  providers: Array<{ provider: string; status: "ok" | "unavailable"; noticeCount?: number }>;
  projects: number;
  matchingAlerts: number;
};

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const known = new Set([
    "openai-not-configured", "openai-invalid-json", "invalid-openai-model-list",
    "oversized-openai-model-list", "anthropic-layout-unverified",
    "feed-http-error", "feed-too-large"
  ]);
  return known.has(message) ? message : "feed-unavailable";
}

async function recordFeed(db: CloudHistoryDatabase, provider: string, now: string, count: number | null, error: string | null): Promise<void> {
  await db.query(
    \`INSERT INTO ship_check_technology_feed_status (provider, checked_at, success_at, last_error_code, notice_count)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider) DO UPDATE SET checked_at=EXCLUDED.checked_at,
       success_at=CASE WHEN EXCLUDED.last_error_code IS NULL THEN EXCLUDED.success_at ELSE ship_check_technology_feed_status.success_at END,
       last_error_code=EXCLUDED.last_error_code,
       notice_count=CASE WHEN EXCLUDED.last_error_code IS NULL THEN EXCLUDED.notice_count ELSE ship_check_technology_feed_status.notice_count END\`,
    [provider, now, error ? null : now, error, count ?? 0]
  );
}

/**
 * No outbound notifications: this refresh maintains account-isolated,
 * deduplicated notice records for consented projects only.
 * A feed failure must never clear or mark historical alerts resolved.
 */
export async function refreshTechnologyMonitoring(
  db: CloudHistoryDatabase,
  options: { now?: string; openAIKey?: string; loadOpenAI?: () => Promise<FeedResult>; loadAnthropic?: () => Promise<FeedResult> } = {}
): Promise<RefreshSummary> {
  const now = options.now ?? new Date().toISOString();
  const summary: RefreshSummary = { checkedAt: now, providers: [], projects: 0, matchingAlerts: 0 };

  const checks = [
    ["openai", options.loadOpenAI ?? (() => fetchOpenAIFeed(options.openAIKey ?? "", now))],
    ["anthropic", options.loadAnthropic ?? (() => fetchAnthropicFeed(now))]
  ] as const;

  const results = await Promise.allSettled(checks.map(([, load]) => load()));
  const notices: IntelligenceNotice[] = [];
  for (const [index, result] of results.entries()) {
    const provider = checks[index]![0];
    if (result.status === "fulfilled" && result.value.provider === provider) {
      notices.push(...result.value.notices);
      summary.providers.push({ provider, status: "ok", noticeCount: result.value.notices.length });
      await recordFeed(db, provider, now, result.value.notices.length, null);
    } else {
      const code = errorCode(result.status === "rejected" ? result.reason : new Error("feed-unavailable"));
      summary.providers.push({ provider, status: "unavailable" });
      await recordFeed(db, provider, now, null, code);
    }
  }

  // Bound the job to a predictable amount of work. An oversized estate fails
  // visibly, without claiming to have checked every opted-in project.
  const rowset = await db.query<ComponentRow>(
    \`SELECT c.project_id,c.kind,c.component_id,c.version,c.evidence
     FROM ship_check_technology_components c
     INNER JOIN ship_check_technology_monitoring m ON m.project_id=c.project_id
     ORDER BY c.project_id,c.kind,c.component_id LIMIT 2001\`
  );
  if (rowset.rows.length > 2000) throw new Error("monitoring-capacity-exceeded");

  const groups = new Map<string, MonitoredComponent[]>();
  for (const row of rowset.rows) {
    const components = groups.get(row.project_id) ?? [];
    components.push({
      kind: row.kind, id: row.component_id,
      ...(row.version ? { version: row.version } : {}),
      evidence: row.evidence
    });
    groups.set(row.project_id, components);
  }
  summary.projects = groups.size;

  const healthyProviders = new Set(summary.providers.filter(p => p.status === "ok").map(p => p.provider));
  for (const [projectId, components] of groups) {
    const matches = matchIntelligenceNotices({
      projectIdentity: projectId, components, notices, now
    });
    for (const match of matches) {
      const provider = match.noticeId.startsWith("openai-retirement:") ? "openai"
        : match.noticeId.startsWith("anthropic-retirement:") ? "anthropic" : null;
      if (!provider || !healthyProviders.has(provider)) continue;
      // Do not retain a now-superseded notice for the same component/provider
      // if an explicit replacement date was observed from a successful feed.
      await db.query(
        \`UPDATE ship_check_technology_alerts SET active=false
         WHERE project_id=$1 AND provider=$2 AND component_kind=$3 AND component_id=$4 AND match_identity<>$5\`,
        [projectId, provider, match.component.kind, match.component.id, match.identity]
      );
      await db.query(
        \`INSERT INTO ship_check_technology_alerts
         (project_id,match_identity,notice_id,provider,component_kind,component_id,component_version,status,scope,source_url,summary,effective_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (project_id,match_identity) DO UPDATE
         SET status=EXCLUDED.status,scope=EXCLUDED.scope,source_url=EXCLUDED.source_url,
           summary=EXCLUDED.summary,effective_date=EXCLUDED.effective_date,
           last_seen_at=now(),active=true\`,
        [
          projectId, match.identity, match.noticeId, provider,
          match.component.kind, match.component.id, match.component.version ?? null,
          match.status, match.scope, match.sourceUrl, match.summary.slice(0, 500),
          match.effectiveDate ?? null
        ]
      );
      summary.matchingAlerts += 1;
    }
  }

  return summary;
}
