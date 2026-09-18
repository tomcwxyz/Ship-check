import { createHash } from "node:crypto";
import pg from "pg";
import {
  DatabaseMetadataSnapshotSchema,
  type DatabaseMetadataSnapshot,
  type DatabasePlatform,
  type DatabasePrivilege,
  type DatabaseRoleGrant,
  type PostgresTableMetadata,
  type SupabaseClientRole
} from "@ship-check/schemas/databaseEvidence";

const { Client } = pg;
const DEFAULT_TABLE_LIMIT = 1000;
const MAX_TABLE_LIMIT = 5000;
const CONNECTION_TIMEOUT_MS = 10_000;

const BEGIN_READ_ONLY_SQL = "BEGIN TRANSACTION READ ONLY";
const STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '5000ms'";
const LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '1000ms'";
const READ_ONLY_SQL = "SHOW transaction_read_only";
const INSPECTOR_ROLE_SQL = `
SELECT r.rolsuper AS inspector_superuser,
       r.rolbypassrls AS inspector_bypass_rls
FROM pg_catalog.pg_roles r
WHERE r.rolname = CURRENT_USER
`;
const TABLE_METADATA_SQL = `
SELECT n.nspname::text AS schema_name,
       c.relname::text AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls,
       COALESCE(p.policy_count, 0)::int AS policy_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
  SELECT polrelid, count(*)::int AS policy_count
  FROM pg_catalog.pg_policy
  GROUP BY polrelid
) p ON p.polrelid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_toast'
ORDER BY n.nspname, c.relname
LIMIT $1
`;
const CLIENT_GRANTS_SQL = `
WITH bounded_tables AS (
  SELECT c.oid,
         c.relacl,
         c.relowner,
         n.nspname::text AS schema_name,
         c.relname::text AS table_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname !~ '^pg_toast'
  ORDER BY n.nspname, c.relname
  LIMIT $1
)
SELECT t.schema_name,
       t.table_name,
       r.rolname::text AS role_name,
       a.privilege_type::text AS privilege_type
FROM bounded_tables t
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(t.relacl, pg_catalog.acldefault('r', t.relowner))
) a
JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY t.schema_name, t.table_name, r.rolname, a.privilege_type
`;
const ROLLBACK_SQL = "ROLLBACK";

const allowedPrivileges = new Set<DatabasePrivilege>([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER"
]);
const allowedRoles = new Set<SupabaseClientRole>(["anon", "authenticated", "service_role"]);

export type InspectorQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
};

export type PostgresInspectorClient = {
  connect(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<InspectorQueryResult<Row>>;
  end(): Promise<void>;
};

export type PostgresInspectorClientFactory = (connectionString: string) => PostgresInspectorClient;

export type InspectPostgresDatabaseOptions = {
  connectionString: string;
  platform?: DatabasePlatform;
  tableLimit?: number;
  clientFactory?: PostgresInspectorClientFactory;
  now?: () => Date;
};

type TableRow = {
  schema_name: string;
  table_name: string;
  rls_enabled: boolean;
  force_rls: boolean;
  policy_count: number;
};

type GrantRow = {
  schema_name: string;
  table_name: string;
  role_name: string;
  privilege_type: string;
};

type InspectorRoleRow = {
  inspector_superuser: boolean;
  inspector_bypass_rls: boolean;
};

type ReadOnlyRow = {
  transaction_read_only: string;
};

function defaultClientFactory(connectionString: string): PostgresInspectorClient {
  const client = new Client({
    connectionString,
    application_name: "ship-check-database-inspector",
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS
  });
  return {
    connect: async () => {
      await client.connect();
    },
    query: async <Row extends Record<string, unknown>>(text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows as Row[] };
    },
    end: () => client.end()
  };
}

function tableLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_TABLE_LIMIT;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_TABLE_LIMIT) {
    throw new Error(`Database metadata table limit must be an integer between 1 and ${MAX_TABLE_LIMIT}.`);
  }
  return resolved;
}

function databaseIdentity(connectionString: string, platform: DatabasePlatform) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Database inspection requires a valid postgres:// or postgresql:// connection URL supplied through the configured environment variable.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database inspection requires a postgres:// or postgresql:// connection URL.");
  }
  if (!url.hostname) throw new Error("Database connection URL does not contain a host.");
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  const fingerprint = createHash("sha256")
    .update(`${url.hostname.toLowerCase()}:${port}/${database}`)
    .digest("hex")
    .slice(0, 20);
  const label = platform === "supabase"
    ? "Supabase database"
    : platform === "neon"
      ? "Neon database"
      : "Postgres database";
  return { id: `database:${platform}:${fingerprint}`, label };
}

export function redactDatabaseError(error: unknown, connectionString?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (connectionString) message = message.split(connectionString).join("[redacted-database-url]");
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "[redacted-database-url]")
    .slice(0, 1000);
}

function grantsByTable(rows: GrantRow[]): Map<string, DatabaseRoleGrant[]> {
  const grouped = new Map<string, Map<SupabaseClientRole, Set<DatabasePrivilege>>>();
  for (const row of rows) {
    if (!allowedRoles.has(row.role_name as SupabaseClientRole)) continue;
    if (!allowedPrivileges.has(row.privilege_type as DatabasePrivilege)) continue;
    const key = `${row.schema_name}\u0000${row.table_name}`;
    let roleMap = grouped.get(key);
    if (!roleMap) {
      roleMap = new Map();
      grouped.set(key, roleMap);
    }
    const role = row.role_name as SupabaseClientRole;
    let privileges = roleMap.get(role);
    if (!privileges) {
      privileges = new Set();
      roleMap.set(role, privileges);
    }
    privileges.add(row.privilege_type as DatabasePrivilege);
  }

  const output = new Map<string, DatabaseRoleGrant[]>();
  for (const [key, roleMap] of grouped) {
    output.set(key, [...roleMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, privileges]) => ({
        role,
        privileges: [...privileges].sort()
      })));
  }
  return output;
}

function toTables(rows: TableRow[], grants: GrantRow[], limit: number): { tables: PostgresTableMetadata[]; truncated: boolean } {
  const truncated = rows.length > limit;
  const bounded = rows.slice(0, limit);
  const grantMap = grantsByTable(grants);
  const tables = bounded.map((row) => ({
    schema: row.schema_name,
    name: row.table_name,
    rlsEnabled: Boolean(row.rls_enabled),
    forceRls: Boolean(row.force_rls),
    policyCount: Number(row.policy_count) || 0,
    grants: grantMap.get(`${row.schema_name}\u0000${row.table_name}`) ?? []
  }));
  return { tables, truncated };
}

export async function inspectPostgresDatabase(
  options: InspectPostgresDatabaseOptions
): Promise<DatabaseMetadataSnapshot> {
  const platform = options.platform ?? "postgres";
  const limit = tableLimit(options.tableLimit);
  const identity = databaseIdentity(options.connectionString, platform);
  const client = (options.clientFactory ?? defaultClientFactory)(options.connectionString);
  const acquiredAt = (options.now ?? (() => new Date()))().toISOString();
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query(BEGIN_READ_ONLY_SQL);
    transactionStarted = true;
    await client.query(STATEMENT_TIMEOUT_SQL);
    await client.query(LOCK_TIMEOUT_SQL);

    const readOnly = await client.query<ReadOnlyRow>(READ_ONLY_SQL);
    const readOnlyValue = String(readOnly.rows[0]?.transaction_read_only ?? "").toLowerCase();
    if (readOnlyValue !== "on" && readOnlyValue !== "true") {
      throw new Error("Database inspector could not verify that its transaction is read-only.");
    }

    const inspectorRole = await client.query<InspectorRoleRow>(INSPECTOR_ROLE_SQL);
    const role = inspectorRole.rows[0];
    if (!role) throw new Error("Database inspector could not establish the current Postgres role scope.");

    const tableRows = await client.query<TableRow>(TABLE_METADATA_SQL, [limit + 1]);
    const grantRows = await client.query<GrantRow>(CLIENT_GRANTS_SQL, [limit]);
    const { tables, truncated } = toTables(tableRows.rows, grantRows.rows, limit);

    return DatabaseMetadataSnapshotSchema.parse({
      schemaVersion: "0.1",
      source: {
        schemaVersion: "0.1",
        id: identity.id,
        type: "database",
        provider: platform,
        label: identity.label,
        acquisition: "remote-readonly",
        executionLocation: "user-device",
        capabilities: ["database-metadata"],
        ephemeral: true,
        acquiredAt
      },
      engine: "postgres",
      platform,
      inspection: {
        readOnlyTransaction: true,
        fixedMetadataQueriesOnly: true,
        rowDataRead: false,
        tableLimit: limit,
        tablesTruncated: truncated,
        inspectorSuperuser: Boolean(role.inspector_superuser),
        inspectorBypassRls: Boolean(role.inspector_bypass_rls)
      },
      tables,
      acquiredAt
    });
  } catch (error) {
    throw new Error(`Database metadata inspection failed: ${redactDatabaseError(error, options.connectionString)}`);
  } finally {
    if (transactionStarted) {
      try {
        await client.query(ROLLBACK_SQL);
      } catch {
        // Preserve the original result/error; rollback is best-effort after a read-only transaction.
      }
    }
    try {
      await client.end();
    } catch {
      // Closing a failed connection must not replace the primary inspection result/error.
    }
  }
}

export const postgresInspectorSql = {
  beginReadOnly: BEGIN_READ_ONLY_SQL,
  statementTimeout: STATEMENT_TIMEOUT_SQL,
  lockTimeout: LOCK_TIMEOUT_SQL,
  verifyReadOnly: READ_ONLY_SQL,
  inspectorRole: INSPECTOR_ROLE_SQL,
  tables: TABLE_METADATA_SQL,
  clientGrants: CLIENT_GRANTS_SQL,
  rollback: ROLLBACK_SQL
} as const;
