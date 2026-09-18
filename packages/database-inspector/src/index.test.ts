import { describe, expect, it } from "vitest";
import {
  inspectPostgresDatabase,
  postgresInspectorSql,
  redactDatabaseError,
  type PostgresInspectorClient,
  type PostgresInspectorClientFactory
} from "./index.js";

function fakeClient(options: {
  readOnly?: string;
  superuser?: boolean;
  bypassRls?: boolean;
  tables?: Record<string, unknown>[];
  grants?: Record<string, unknown>[];
  failOn?: string;
} = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let connected = false;
  let ended = false;

  const client: PostgresInspectorClient = {
    async connect() {
      connected = true;
    },
    async query<Row extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (options.failOn && text.includes(options.failOn)) {
        throw new Error("connection postgres://reader:very-secret@example.neon.tech/app failed");
      }
      if (text === postgresInspectorSql.verifyReadOnly) {
        return { rows: [{ transaction_read_only: options.readOnly ?? "on" }] as unknown as Row[] };
      }
      if (text === postgresInspectorSql.inspectorRole) {
        return { rows: [{
          inspector_superuser: options.superuser ?? false,
          inspector_bypass_rls: options.bypassRls ?? false
        }] as unknown as Row[] };
      }
      if (text === postgresInspectorSql.tables) {
        return { rows: (options.tables ?? [{
          schema_name: "public",
          table_name: "profiles",
          rls_enabled: true,
          force_rls: false,
          policy_count: 2
        }]) as unknown as Row[] };
      }
      if (text === postgresInspectorSql.clientGrants) {
        return { rows: (options.grants ?? [{
          schema_name: "public",
          table_name: "profiles",
          role_name: "authenticated",
          privilege_type: "SELECT"
        }]) as unknown as Row[] };
      }
      return { rows: [] as Row[] };
    },
    async end() {
      ended = true;
    }
  };

  const factory: PostgresInspectorClientFactory = () => client;
  return {
    factory,
    queries,
    connected: () => connected,
    ended: () => ended
  };
}

const connectionString = "postgresql://reader:very-secret@example.neon.tech/app?sslmode=require";

describe("local Postgres database inspector", () => {
  it("uses a read-only transaction and emits only bounded metadata", async () => {
    const fake = fakeClient();
    const snapshot = await inspectPostgresDatabase({
      connectionString,
      platform: "neon",
      clientFactory: fake.factory,
      now: () => new Date("2026-09-18T15:00:00.000Z")
    });

    expect(fake.connected()).toBe(true);
    expect(fake.ended()).toBe(true);
    expect(fake.queries.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      postgresInspectorSql.beginReadOnly,
      postgresInspectorSql.statementTimeout,
      postgresInspectorSql.lockTimeout,
      postgresInspectorSql.verifyReadOnly,
      postgresInspectorSql.inspectorRole,
      postgresInspectorSql.tables,
      postgresInspectorSql.clientGrants,
      postgresInspectorSql.rollback
    ]));
    expect(fake.queries.find((entry) => entry.text === postgresInspectorSql.tables)?.values).toEqual([1001]);
    expect(fake.queries.find((entry) => entry.text === postgresInspectorSql.clientGrants)?.values).toEqual([1000]);
    expect(snapshot).toMatchObject({
      engine: "postgres",
      platform: "neon",
      source: {
        type: "database",
        provider: "neon",
        label: "Neon database",
        capabilities: ["database-metadata"]
      },
      inspection: {
        readOnlyTransaction: true,
        fixedMetadataQueriesOnly: true,
        rowDataRead: false,
        tableLimit: 1000,
        tablesTruncated: false,
        inspectorSuperuser: false,
        inspectorBypassRls: false
      }
    });
    expect(snapshot.tables[0]).toEqual({
      schema: "public",
      name: "profiles",
      rlsEnabled: true,
      forceRls: false,
      policyCount: 2,
      grants: [{ role: "authenticated", privileges: ["SELECT"] }]
    });
    expect(JSON.stringify(snapshot)).not.toContain("very-secret");
    expect(JSON.stringify(snapshot)).not.toContain("example.neon.tech");
    expect(JSON.stringify(snapshot)).not.toContain("reader");
  });

  it("marks a table inventory as truncated and never exceeds the requested bound", async () => {
    const fake = fakeClient({
      tables: [
        { schema_name: "public", table_name: "a", rls_enabled: true, force_rls: false, policy_count: 1 },
        { schema_name: "public", table_name: "b", rls_enabled: true, force_rls: false, policy_count: 1 }
      ],
      grants: []
    });
    const snapshot = await inspectPostgresDatabase({
      connectionString,
      platform: "postgres",
      tableLimit: 1,
      clientFactory: fake.factory
    });

    expect(snapshot.inspection.tablesTruncated).toBe(true);
    expect(snapshot.tables).toHaveLength(1);
    expect(snapshot.tables[0]?.name).toBe("a");
  });

  it("records only privilege booleans about the inspector role", async () => {
    const fake = fakeClient({ superuser: true, bypassRls: true });
    const snapshot = await inspectPostgresDatabase({
      connectionString,
      platform: "supabase",
      clientFactory: fake.factory
    });

    expect(snapshot.inspection.inspectorSuperuser).toBe(true);
    expect(snapshot.inspection.inspectorBypassRls).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/current_user|role_name/i);
  });

  it("refuses to continue when transaction read-only mode cannot be established", async () => {
    const fake = fakeClient({ readOnly: "off" });
    await expect(inspectPostgresDatabase({
      connectionString,
      clientFactory: fake.factory
    })).rejects.toThrow(/could not verify that its transaction is read-only/);
    expect(fake.queries.some((entry) => entry.text === postgresInspectorSql.rollback)).toBe(true);
    expect(fake.ended()).toBe(true);
  });

  it("redacts database URLs from failures", async () => {
    const fake = fakeClient({ failOn: "relrowsecurity" });
    await expect(inspectPostgresDatabase({
      connectionString,
      clientFactory: fake.factory
    })).rejects.toThrow(/\[redacted-database-url\]/);
    try {
      await inspectPostgresDatabase({ connectionString, clientFactory: fake.factory });
    } catch (error) {
      expect(String(error)).not.toContain("very-secret");
    }
    expect(redactDatabaseError(new Error(`failed ${connectionString}`), connectionString)).not.toContain("very-secret");
  });

  it("rejects non-Postgres connection URLs before connecting", async () => {
    const fake = fakeClient();
    await expect(inspectPostgresDatabase({
      connectionString: "https://example.com/database",
      clientFactory: fake.factory
    })).rejects.toThrow(/postgres:\/\/ or postgresql:\/\//);
    expect(fake.connected()).toBe(false);
  });
});
