/**
 * Client-side only: reduce recognised local tool exports to the minimal
 * component fields allowed by Cloud. The original file is never uploaded.
 */
export type ImportedComponent = {
  kind: "ai-model" | "wordpress-core" | "wordpress-plugin" | "wordpress-theme" | "drupal-package";
  id: string;
  version?: string;
  evidence: "source-declared";
};
const ID = /^[A-Za-z0-9._/-]{1,160}$/;
const VERSION = /^[A-Za-z0-9._+/-]{1,80}$/;
const KINDS = new Set(["ai-model","wordpress-core","wordpress-plugin","wordpress-theme","drupal-package"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function component(kind: string, id: unknown, version: unknown): ImportedComponent | null {
  if (!KINDS.has(kind) || typeof id !== "string" || !ID.test(id)) return null;
  if (version !== undefined && version !== null && (typeof version !== "string" || !VERSION.test(version))) return null;
  return {
    kind: kind as ImportedComponent["kind"],
    id,
    ...(typeof version === "string" ? { version } : {}),
    evidence: "source-declared"
  };
}

export function importTechnologyInventory(jsonText: string): ImportedComponent[] {
  if (jsonText.length > 2_000_000) throw new Error("Inventory import is limited to 2 MB.");
  let data: unknown;
  try { data = JSON.parse(jsonText); }
  catch { throw new Error("Choose a valid JSON export."); }

  let items: Array<ImportedComponent | null> = [];
  const root=record(data);
  if (root && root.schemaVersion === "ship-check-technology-inventory/0.1" && Array.isArray(root.components)) {
    if (root.components.length > 250) throw new Error("Too many components.");
    items = root.components.map(item => {
      const row=record(item);
      return row ? component(String(row.kind ?? ""),row.id,row.version) : null;
    });
  } else if (root && Array.isArray(root.packages)) {
    // Composer lock: only Drupal package IDs, not arbitrary dependencies.
    if (root.packages.length > 10000) throw new Error("Composer lockfile is too large.");
    items = root.packages.map(item => {
      const row=record(item);
      return row && typeof row.name === "string" && /^drupal\/[a-z0-9_-]+$/.test(row.name)
        ? component("drupal-package",row.name,row.version) : null;
    });
  } else if (Array.isArray(data)) {
    // WP-CLI: wp plugin list --format=json (installed plugins, not deployed proof).
    if (data.length > 500) throw new Error("Plugin list is too large.");
    items = data.map(item => {
      const row=record(item);
      return row ? component("wordpress-plugin",row.name,row.version) : null;
    });
  } else {
    throw new Error("Use a Ship Check inventory export, composer.lock, or WP-CLI plugin list JSON.");
  }
  const unique = new Map<string, ImportedComponent>();
  for (const item of items) {
    if (!item) continue;
    unique.set(item.kind + ":" + item.id,item);
  }
  if (!unique.size) throw new Error("No recognised technology components were found.");
  if (unique.size > 50) throw new Error("More than 50 components found. Reduce the list before importing.");
  return [...unique.values()];
}
