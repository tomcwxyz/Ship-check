import type { MonitoredComponent } from "@ship-check/cloud-runtime";
import type { CloudHistoryDatabase } from "@ship-check/adapters";

const KINDS = new Set(["ai-model", "wordpress-core", "wordpress-plugin", "wordpress-theme", "drupal-package"]);
const ID = /^[A-Za-z0-9._/-]{1,160}$/;
const VERSION = /^[A-Za-z0-9._+/-]{1,80}$/;
export const MAX_COMPONENTS = 50;

export type InventoryState = {
  enabled: boolean;
  components: MonitoredComponent[];
  alerts: Array<{
    identity: string;
    provider: string;
    componentId: string;
    status: string;
    scope: string;
    summary: string;
    sourceUrl: string;
    effectiveDate: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  feeds: Array<{ provider: string; checkedAt: string; successAt: string | null; errorCode: string | null }>;
};

export function parseComponents(value: unknown): MonitoredComponent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COMPONENTS) {
    throw new Error("Supply 1–50 technology components.");
  }
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid component.");
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some(key => !["kind", "id", "version", "evidence"].includes(key))) {
      throw new Error("Unsupported component field.");
    }
    if (typeof record.kind !== "string" || !KINDS.has(record.kind) ||
        typeof record.id !== "string" || !ID.test(record.id)) {
      throw new Error("Invalid component kind or identifier.");
    }
    if (record.version !== undefined && (typeof record.version !== "string" || !VERSION.test(record.version))) {
      throw new Error("Invalid component version.");
    }
    // API accepts manual/source inventory ONLY. Future runtime integrations
    // must prove their evidence through a separate server-owned contract.
    if (record.evidence !== undefined && record.evidence !== "source-declared") {
      throw new Error("Manual entries cannot claim verified runtime evidence.");
    }
    const key = record.kind + ":" + record.id;
    if (seen.has(key)) throw new Error("Duplicate component: " + record.id);
    seen.add(key);
    return {
      kind: record.kind as MonitoredComponent["kind"],
      id: record.id,
      ...(typeof record.version === "string" ? { version: record.version } : {}),
      evidence: "source-declared" as const
    };
  });
}

const asISO = (value: string | Date): string => new Date(value).toISOString();

type AlertRow = {
  match_identity: string; provider: string; component_id: string;
  status: string; scope: string; summary: string; source_url: string;
  effective_date: string | Date | null; first_seen_at: string | Date; last_seen_at: string | Date;
};
type FeedRow = {
  provider: string; checked_at: string | Date; success_at: string | Date | null; last_error_code: string | null;
};
type ComponentRow = {
  kind: MonitoredComponent["kind"]; component_id: string; version: string | null; evidence: MonitoredComponent["evidence"];
};

export async function getTechnologyInventory(
  db: CloudHistoryDatabase, projectId: string, accountId: string
): Promise<InventoryState> {
  const consent = await db.query<{ project_id: string }>(
    "SELECT project_id FROM ship_check_technology_monitoring WHERE project_id=$1 AND account_id=$2",
    [projectId, accountId]
  );
  const enabled = consent.rows.length > 0;
  const [components, alerts, feeds] = await Promise.all([
    enabled ? db.query<ComponentRow>(
      "SELECT kind, component_id, version, evidence FROM ship_check_technology_components WHERE project_id=$1 ORDER BY kind, component_id",
      [projectId]
    ) : Promise.resolve({ rows: [] as ComponentRow[] }),
    enabled ? db.query<AlertRow>(
      "SELECT match_identity, provider, component_id, status, scope, summary, source_url, effective_date, first_seen_at, last_seen_at FROM ship_check_technology_alerts WHERE project_id=$1 AND active=true ORDER BY first_seen_at DESC LIMIT 100",
      [projectId]
    ) : Promise.resolve({ rows: [] as AlertRow[] }),
    enabled ? db.query<FeedRow>(
      "SELECT provider, checked_at, success_at, last_error_code FROM ship_check_technology_feed_status WHERE provider IN ('openai','anthropic','drupal','wordpress') ORDER BY provider"
    ) : Promise.resolve({ rows: [] as FeedRow[] })
  ]);
  return {
    enabled,
    components: components.rows.map(r => ({
      kind: r.kind, id: r.component_id,
      ...(r.version ? { version: r.version } : {}),
      evidence: r.evidence
    })),
    alerts: alerts.rows.map(r => ({
      identity: r.match_identity, provider: r.provider, componentId: r.component_id,
      status: r.status, scope: r.scope, summary: r.summary, sourceUrl: r.source_url,
      effectiveDate: r.effective_date ? asISO(r.effective_date).slice(0, 10) : null,
      firstSeenAt: asISO(r.first_seen_at), lastSeenAt: asISO(r.last_seen_at)
    })),
    feeds: feeds.rows.map(r => ({
      provider: r.provider,
      checkedAt: asISO(r.checked_at),
      successAt: r.success_at ? asISO(r.success_at) : null,
      errorCode: r.last_error_code
    }))
  };
}

export async function saveTechnologyInventory(
  db: CloudHistoryDatabase, projectId: string, accountId: string, components: MonitoredComponent[]
): Promise<void> {
  await db.transaction(async tx => {
    const owned = await tx.query(
      "SELECT id FROM ship_check_projects WHERE id=$1 AND account_id=$2 FOR UPDATE",
      [projectId, accountId]
    );
    if (owned.rows.length !== 1) throw new Error("Project unavailable.");
    await tx.query(
      `INSERT INTO ship_check_technology_monitoring (project_id,account_id) VALUES ($1,$2)
       ON CONFLICT (project_id) DO UPDATE SET updated_at=now()
       WHERE ship_check_technology_monitoring.account_id=$2`,
      [projectId, accountId]
    );
    await tx.query("DELETE FROM ship_check_technology_components WHERE project_id=$1", [projectId]);
    for (const component of components) {
      await tx.query(
        `INSERT INTO ship_check_technology_components (project_id,kind,component_id,version,evidence)
         VALUES ($1,$2,$3,$4,'source-declared')`,
        [projectId, component.kind, component.id, component.version ?? null]
      );
    }
    // Do not show alerts for removed components or different versions.
    await tx.query(
      `DELETE FROM ship_check_technology_alerts AS a
       WHERE a.project_id=$1 AND NOT EXISTS (
         SELECT 1 FROM ship_check_technology_components AS c WHERE c.project_id=a.project_id
           AND c.kind=a.component_kind AND c.component_id=a.component_id
           AND COALESCE(c.version,'')=COALESCE(a.component_version,'')
       )`,
      [projectId]
    );
  });
}

export async function stopTechnologyMonitoring(db: CloudHistoryDatabase, projectId: string, accountId: string): Promise<void> {
  await db.query(
    "DELETE FROM ship_check_technology_monitoring WHERE project_id=$1 AND account_id=$2",
    [projectId, accountId]
  ); // Cascades all components and alert records.
}
