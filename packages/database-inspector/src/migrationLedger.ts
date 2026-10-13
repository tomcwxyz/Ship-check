import type { MigrationFramework, MigrationLedger } from "@ship-check/schemas/databaseEvidence";

/**
 * Only the three explicitly named, canonical migration tables may be read.
 * These are fixed, bounded metadata-only queries, never interpolated SQL.
 * Custom schemas, ambiguous tables and absent privileges remain unverified.
 */
export const migrationLedgerSql = {
  discover: `
SELECT n.nspname::text AS schema_name,
       c.relname::text AS table_name,
       pg_catalog.has_table_privilege(c.oid, 'SELECT') AS readable,
       array_agg(a.attname::text) FILTER (WHERE a.attname IS NOT NULL) AS column_names
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r','p')
  AND (
    (n.nspname = 'drizzle' AND c.relname = '__drizzle_migrations')
    OR (n.nspname = 'public' AND c.relname = '_prisma_migrations')
    OR (n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations')
  )
GROUP BY c.oid, n.nspname, c.relname
`,
  drizzle: `
SELECT created_at::text AS identifier, hash::text AS checksum, 'applied'::text AS state
FROM drizzle.__drizzle_migrations ORDER BY created_at, id LIMIT $1
`,
  prisma: `
SELECT migration_name::text AS identifier, checksum::text AS checksum,
       CASE WHEN rolled_back_at IS NOT NULL THEN 'rolledback'
            WHEN finished_at IS NOT NULL THEN 'applied'
            ELSE 'incomplete' END::text AS state
FROM public._prisma_migrations ORDER BY started_at, id LIMIT $1
`,
  supabase: `
SELECT version::text AS identifier, 'applied'::text AS state
FROM supabase_migrations.schema_migrations ORDER BY version LIMIT $1
`
} as const;

const specs: Record<MigrationFramework, { schema: string; table: string; columns: string[] }> = {
  drizzle: { schema: "drizzle", table: "__drizzle_migrations", columns: ["created_at", "hash", "id"] },
  prisma: { schema: "public", table: "_prisma_migrations", columns: ["migration_name", "checksum", "rolled_back_at", "finished_at", "started_at", "id"] },
  supabase: { schema: "supabase_migrations", table: "schema_migrations", columns: ["version"] }
};

type QueryClient = {
  query<Row extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};

type LedgerTable = { schema_name: string; table_name: string; readable: boolean; column_names: string[] | null };
type LedgerRecord = { identifier: string; checksum?: string | null; state: string };
const LIMIT = 1000;

export async function inspectMigrationLedger(
  client: QueryClient,
  framework: MigrationFramework
): Promise<MigrationLedger> {
  const base = { framework, limit: LIMIT };
  const empty = (status: MigrationLedger["status"]): MigrationLedger =>
    ({ ...base, status, entries: [], truncated: false });
  const spec = specs[framework];
  // Discover before querying: absence, privilege and unsupported schema are different outcomes.
  let tables: LedgerTable[];
  try {
    const discovery = await client.query<LedgerTable>(migrationLedgerSql.discover);
    tables = discovery.rows;
  } catch {
    // A failed query invalidates the current transaction. Caller must roll it back.
    return empty("unavailable");
  }
  const table = tables.find((entry) => entry.schema_name === spec.schema && entry.table_name === spec.table);
  if (!table) return empty("missing");
  if (!table.readable) return empty("unreadable");
  if (!spec.columns.every((column) => (table.column_names ?? []).includes(column))) return empty("unsupported");

  try {
    const result = await client.query<LedgerRecord>(migrationLedgerSql[framework], [LIMIT + 1]);
    const truncated = result.rows.length > LIMIT;
    const entries: MigrationLedger["entries"] = [];
    for (const row of result.rows.slice(0, LIMIT)) {
      const identifier = String(row.identifier ?? "");
      const state = row.state;
      const checksum = typeof row.checksum === "string" && /^[a-f0-9]{64}$/i.test(row.checksum)
        ? row.checksum.toLowerCase() : undefined;
      if (!identifier || identifier.length > 256 || !["applied", "incomplete", "rolledback"].includes(state)) {
        return empty("unsupported");
      }
      entries.push({
        identifier,
        state: state as "applied" | "incomplete" | "rolledback",
        ...(checksum ? { checksum } : {})
      });
    }
    return { ...base, status: "complete", entries, truncated };
  } catch {
    return empty("unavailable");
  }
}
