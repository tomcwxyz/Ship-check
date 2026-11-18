import type { MonitoredComponent } from "@ship-check/cloud-runtime";
import type { CloudHistoryDatabase } from "@ship-check/adapters";

const KINDS = new Set(["ai-model", "wordpress-core", "wordpress-plugin", "wordpress-theme", "drupal-package"]);
const ID = /^[A-Za-z0-9._/-]{1,160}$/;
const VERSION = /^[A-Za-z0-9._+/-]{1,80}$/;
export const MAX_COMPONENTS = 50;

export type InventoryState = {
  enabled: boolean;
  autoDiscovery: boolean;
  components: MonitoredComponent[];
  discoveredComponents: MonitoredComponent[];
  cmsConnectors: Array<{id:string;cms:string;lastSeenAt:string|null;components:number}>;
  siteHints: Array<{cms:"wordpress"|"drupal";confidence:"likely"|"possible";lastSeenAt:string}>;
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
  const consent = await db.query<{ project_id: string; auto_discovery_enabled: boolean }>(
    "SELECT project_id, auto_discovery_enabled FROM ship_check_technology_monitoring WHERE project_id=$1 AND account_id=$2",
    [projectId, accountId]
  );
  const connectors = await db.query<{id:string;cms:string;last_seen_at:string|Date|null;components:string}>(
    `SELECT s.id,s.cms,s.last_seen_at,count(c.component_id)::text AS components
     FROM ship_check_cms_connectors s LEFT JOIN ship_check_cms_components c ON c.connector_id=s.id
     WHERE s.project_id=$1 AND s.account_id=$2 AND s.revoked_at IS NULL
     GROUP BY s.id,s.cms,s.last_seen_at ORDER BY s.created_at DESC`,[projectId,accountId]);
  const enabled = consent.rows.length > 0 || connectors.rows.length > 0;
  const hints = await db.query<{cms:"wordpress"|"drupal";confidence:"likely"|"possible";observed_at:string|Date}>(
    "SELECT cms,confidence,observed_at FROM ship_check_cms_site_hints WHERE project_id=$1 ORDER BY observed_at DESC",[projectId]
  );
  const [components, discovered, alerts, feeds] = await Promise.all([
    enabled ? db.query<ComponentRow>(
      "SELECT kind, component_id, version, evidence FROM ship_check_technology_components WHERE project_id=$1 ORDER BY kind, component_id",
      [projectId]
    ) : Promise.resolve({ rows: [] as ComponentRow[] }),
    enabled ? db.query<ComponentRow>(
      "SELECT kind, component_id, version, evidence FROM ship_check_discovered_components WHERE project_id=$1 ORDER BY kind, component_id",
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
    siteHints: hints.rows.map(h=>({cms:h.cms,confidence:h.confidence,lastSeenAt:asISO(h.observed_at)})),
    cmsConnectors: connectors.rows.map(r=>({id:r.id,cms:r.cms,lastSeenAt:r.last_seen_at?asISO(r.last_seen_at):null,components:Number(r.components)})),
    autoDiscovery: enabled && consent.rows[0]?.auto_discovery_enabled === true,
    discoveredComponents: discovered.rows.map(r => ({
      kind: r.kind, id: r.component_id,
      ...(r.version ? { version: r.version } : {}),
      evidence: r.evidence
    })),
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
         UNION ALL SELECT 1 FROM ship_check_discovered_components d WHERE d.project_id=a.project_id
           AND d.kind=a.component_kind AND d.component_id=a.component_id
           AND COALESCE(d.version,'')=COALESCE(a.component_version,'')
       )`,
      [projectId]
    );
  });
}

/** Consent is controlled only by a verified browser session with project ownership. */
export async function setAutomaticDiscovery(
  db: CloudHistoryDatabase, projectId: string, accountId: string, enabled: boolean
): Promise<void> {
  await db.transaction(async tx => {
    const owned = await tx.query(
      "SELECT id FROM ship_check_projects WHERE id=$1 AND account_id=$2 FOR UPDATE",
      [projectId, accountId]
    );
    if (owned.rows.length !== 1) throw new Error("Project unavailable.");
    if (enabled) {
      await tx.query(
        `INSERT INTO ship_check_technology_monitoring(project_id,account_id,auto_discovery_enabled)
         VALUES ($1,$2,true) ON CONFLICT(project_id) DO UPDATE
         SET auto_discovery_enabled=true,updated_at=now()
         WHERE ship_check_technology_monitoring.account_id=$2`,
        [projectId,accountId]
      );
    } else {
      await tx.query(
        "UPDATE ship_check_technology_monitoring SET auto_discovery_enabled=false,updated_at=now() WHERE project_id=$1 AND account_id=$2",
        [projectId,accountId]
      );
      // Disabling discovery deletes synced data, but preserves manual inventory.
      await tx.query("DELETE FROM ship_check_discovered_components WHERE project_id=$1", [projectId]);
      await tx.query(
        `DELETE FROM ship_check_technology_alerts AS a WHERE a.project_id=$1
         AND NOT EXISTS (SELECT 1 FROM ship_check_technology_components c
                         WHERE c.project_id=a.project_id AND c.kind=a.component_kind
                         AND c.component_id=a.component_id)`,[projectId]
      );
    }
  });
}

/** Existing CI sync still requires prior consent. A direct, user-triggered scan publish
 * may explicitly opt in, using the same account-scoped history:sync token.
 * A public CMS hint never becomes a verified installed component.
 */
export async function syncDiscoveredTechnologyInventory(
  db: CloudHistoryDatabase, projectId: string, accountId: string, components: MonitoredComponent[],
  options: {optIn?:boolean; replaceComponents?:boolean; siteHints?:Array<{cms:"wordpress"|"drupal";confidence:"likely"|"possible"}>} = {}
): Promise<boolean> {
  return db.transaction(async tx => {
    if(options.optIn) {
      const owned=await tx.query("SELECT id FROM ship_check_projects WHERE id=$1 AND account_id=$2 FOR UPDATE",[projectId,accountId]);
      if(owned.rows.length!==1) return false;
      await tx.query(`INSERT INTO ship_check_technology_monitoring(project_id,account_id,auto_discovery_enabled)
        VALUES($1,$2,true) ON CONFLICT(project_id) DO UPDATE SET auto_discovery_enabled=true,updated_at=now()
        WHERE ship_check_technology_monitoring.account_id=$2`,[projectId,accountId]);
    }
    const consent = await tx.query(
      `SELECT m.project_id FROM ship_check_technology_monitoring m
       JOIN ship_check_projects p ON p.id=m.project_id
       WHERE m.project_id=$1 AND m.account_id=$2 AND p.account_id=$2
         AND m.auto_discovery_enabled=true FOR UPDATE OF m`,[projectId,accountId]
    );
    if (consent.rows.length !== 1) return false;
    if(options.replaceComponents!==false) await tx.query("DELETE FROM ship_check_discovered_components WHERE project_id=$1",[projectId]);
    for (const hint of options.siteHints ?? []) {
      await tx.query(`INSERT INTO ship_check_cms_site_hints(project_id,cms,confidence,observed_at)
        VALUES($1,$2,$3,now()) ON CONFLICT(project_id,cms) DO UPDATE
        SET confidence=excluded.confidence,observed_at=now()`,[projectId,hint.cms,hint.confidence]);
    }
    for (const item of options.replaceComponents===false ? [] : components) {
      await tx.query(
        `INSERT INTO ship_check_discovered_components(project_id,kind,component_id,version,evidence)
         VALUES ($1,$2,$3,$4,'source-declared')`,
        [projectId,item.kind,item.id,item.version ?? null]
      );
    }
    await tx.query(
      `DELETE FROM ship_check_technology_alerts a WHERE a.project_id=$1 AND NOT EXISTS (
         SELECT 1 FROM ship_check_technology_components m
           WHERE m.project_id=a.project_id AND m.kind=a.component_kind
             AND m.component_id=a.component_id AND COALESCE(m.version,'')=COALESCE(a.component_version,'')
         UNION ALL
         SELECT 1 FROM ship_check_discovered_components d
           WHERE d.project_id=a.project_id AND d.kind=a.component_kind
             AND d.component_id=a.component_id AND COALESCE(d.version,'')=COALESCE(a.component_version,'')
       )`, [projectId]
    );
    return true;
  });
}

export async function stopTechnologyMonitoring(db: CloudHistoryDatabase, projectId: string, accountId: string): Promise<void> {
  await db.transaction(async tx => {
    const owned=await tx.query(
      "SELECT id FROM ship_check_projects WHERE id=$1 AND account_id=$2 FOR UPDATE",
      [projectId,accountId]
    );
    if (owned.rows.length!==1) throw new Error("Project unavailable.");
    // Revocation is irreversible for existing connector bearer tokens.
    await tx.query(
      "UPDATE ship_check_cms_connectors SET revoked_at=now() WHERE project_id=$1 AND account_id=$2 AND revoked_at IS NULL",
      [projectId,accountId]
    );
    await tx.query("DELETE FROM ship_check_cms_components WHERE project_id=$1",[projectId]);
    await tx.query(
      "DELETE FROM ship_check_technology_monitoring WHERE project_id=$1 AND account_id=$2",
      [projectId,accountId]
    );
    // For projects monitored via connector alone there may be no consent row.
    await tx.query("DELETE FROM ship_check_technology_alerts WHERE project_id=$1",[projectId]);
  });
}
