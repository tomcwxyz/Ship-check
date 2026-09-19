import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPgCloudHistoryDatabase } from "./postgres.js";

function fakePool() {
  const directQuery = vi.fn(async () => ({
    rows: [{ value: 1 }],
    rowCount: 1
  }));
  const transactionQuery = vi.fn(async (text: string) => ({
    rows: text.startsWith("SELECT") ? [{ inside: true }] : [],
    rowCount: text.startsWith("SELECT") ? 1 : 0
  }));
  const release = vi.fn();
  const client = {
    query: transactionQuery,
    release
  };
  const connect = vi.fn(async () => client);
  const end = vi.fn(async () => undefined);
  const pool = {
    query: directQuery,
    connect,
    end
  } as unknown as Pool;

  return {
    pool,
    directQuery,
    transactionQuery,
    release,
    connect,
    end
  };
}

describe("Postgres Cloud history database adapter", () => {
  it("adapts direct queries without taking ownership of an injected pool", async () => {
    const fake = fakePool();
    const runtime = createPgCloudHistoryDatabase({ pool: fake.pool });

    await expect(runtime.database.query("SELECT 1")).resolves.toEqual({
      rows: [{ value: 1 }],
      rowCount: 1
    });

    await runtime.close();
    expect(fake.end).not.toHaveBeenCalled();
  });

  it("commits successful transactions and releases the client", async () => {
    const fake = fakePool();
    const runtime = createPgCloudHistoryDatabase({ pool: fake.pool });

    const result = await runtime.database.transaction(async (tx) => {
      const selected = await tx.query("SELECT true");
      return selected.rows[0];
    });

    expect(result).toEqual({ inside: true });
    expect(fake.transactionQuery.mock.calls.map(([text]) => text)).toEqual([
      "BEGIN",
      "SELECT true",
      "COMMIT"
    ]);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("rolls back failed transactions and keeps the original error", async () => {
    const fake = fakePool();
    const runtime = createPgCloudHistoryDatabase({ pool: fake.pool });
    const expected = new Error("operation failed");

    await expect(runtime.database.transaction(async () => {
      throw expected;
    })).rejects.toBe(expected);

    expect(fake.transactionQuery.mock.calls.map(([text]) => text)).toEqual([
      "BEGIN",
      "ROLLBACK"
    ]);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("rejects ambiguous or unsafe configuration shapes", () => {
    const fake = fakePool();

    expect(() => createPgCloudHistoryDatabase({
      pool: fake.pool,
      connectionString: "postgresql://user:secret@example/db"
    })).toThrow(/either an existing Postgres pool or a connection string/);

    expect(() => createPgCloudHistoryDatabase({
      connectionString: "https://example.com/db"
    })).toThrow(/PostgreSQL/);

    expect(() => createPgCloudHistoryDatabase({
      connectionString: "postgresql://example.com/"
    })).toThrow(/host and database/);

    expect(() => createPgCloudHistoryDatabase({
      connectionString: "postgresql://example.com/db",
      maxConnections: 100
    })).toThrow(/maxConnections/);
  });
});
