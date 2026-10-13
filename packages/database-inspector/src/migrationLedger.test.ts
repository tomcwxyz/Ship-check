import { describe, expect, it } from "vitest";
import { inspectMigrationLedger, migrationLedgerSql } from "./migrationLedger.js";

const cases = {
  drizzle: { schema: "drizzle", name: "__drizzle_migrations", cols: ["created_at", "hash", "id"] },
  prisma: { schema: "public", name: "_prisma_migrations", cols: ["migration_name", "checksum", "started_at", "id", "finished_at", "rolled_back_at"] },
  supabase: { schema: "supabase_migrations", name: "schema_migrations", cols: ["version"] }
};

function client(input: {
  family?: keyof typeof cases;
  readable?: boolean;
  columns?: string[];
  entries?: Array<Record<string, unknown>>;
}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql === migrationLedgerSql.discover) {
        if (!input.family) return { rows: [] as Row[] };
        const spec = cases[input.family];
        return { rows: [{
          schema_name: spec.schema, table_name: spec.name,
          readable: input.readable ?? true,
          column_names: input.columns ?? spec.cols
        }] as unknown as Row[] };
      }
      return { rows: (input.entries ?? []) as Row[] };
    }
  };
}

describe("canonical migration ledger read boundary", () => {
  it("reads a bounded Drizzle ledger only after canonical table discovery", async () => {
    const fake = client({
      family: "drizzle",
      entries: [{ identifier: "1700000000000", checksum: "a".repeat(64), state: "applied" }]
    });
    const result = await inspectMigrationLedger(fake, "drizzle");
    expect(result).toMatchObject({ framework: "drizzle", status: "complete", truncated: false });
    expect(result.entries).toHaveLength(1);
    expect(fake.calls.map((item) => item.sql)).toEqual([migrationLedgerSql.discover, migrationLedgerSql.drizzle]);
    expect(fake.calls[1]?.values).toEqual([1001]);
  });

  it("does not query an absent, unreadable or unsupported ledger", async () => {
    const missing = client({});
    expect((await inspectMigrationLedger(missing, "supabase")).status).toBe("missing");
    expect(missing.calls).toHaveLength(1);
    const unreadable = client({ family: "prisma", readable: false });
    expect((await inspectMigrationLedger(unreadable, "prisma")).status).toBe("unreadable");
    expect(unreadable.calls).toHaveLength(1);
    const unsupported = client({ family: "drizzle", columns: ["hash"] });
    expect((await inspectMigrationLedger(unsupported, "drizzle")).status).toBe("unsupported");
    expect(unsupported.calls).toHaveLength(1);
  });

  it("uses dedicated fixed statements for Prisma and Supabase", async () => {
    for (const family of ["prisma", "supabase"] as const) {
      const fake = client({ family, entries: [{ identifier: "123", state: "applied" }] });
      const result = await inspectMigrationLedger(fake, family);
      expect(result.status).toBe("complete");
      expect(fake.calls[1]?.sql).toBe(migrationLedgerSql[family]);
    }
  });

  it("does not call a partial ledger complete", async () => {
    const fake = client({ family: "supabase", entries: Array.from({ length: 1001 }, (_, i) =>
      ({ identifier: String(i), state: "applied" })) });
    const result = await inspectMigrationLedger(fake, "supabase");
    expect(result.status).toBe("complete");
    expect(result.truncated).toBe(true);
    expect(result.entries).toHaveLength(1000);
  });
});
