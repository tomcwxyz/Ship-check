import { describe, expect, it, vi } from "vitest";
import type {
  CloudHistoryDatabase,
  CloudHistorySqlExecutor
} from "@ship-check/adapters";
import {
  createCloudRuntime,
  redactCloudRuntimeError
} from "./runtime.js";

function database(): CloudHistoryDatabase {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    async transaction<T>(
      run: (transaction: CloudHistorySqlExecutor) => Promise<T>
    ): Promise<T> {
      return run(this);
    }
  };
}

describe("Cloud runtime composition", () => {
  it("assembles services over an injected database without owning its lifecycle", async () => {
    const db = database();
    const runtime = createCloudRuntime({
      database: db,
      authenticateSession: async () => null
    });

    expect(runtime.handler).toBeTypeOf("function");
    expect(runtime.historyService).toBeDefined();
    expect(runtime.tokenService).toBeDefined();
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it("does not allow two database authorities at once", () => {
    expect(() => createCloudRuntime({
      database: database(),
      postgres: {
        connectionString: "postgresql://example.com/ship_check"
      },
      authenticateSession: async () => null
    })).toThrow(/either an existing Cloud database or Postgres configuration/);
  });

  it("redacts PostgreSQL URLs before application error hooks see them", () => {
    const error = new Error(
      "failed postgresql://user:super-secret@example.com/ship_check?sslmode=require"
    );
    const redacted = redactCloudRuntimeError(error);

    expect(redacted).toBeInstanceOf(Error);
    expect((redacted as Error).message).toContain("[redacted-postgres-url]");
    expect((redacted as Error).message).not.toContain("super-secret");
    expect((redacted as Error).stack).not.toContain("super-secret");
  });
});
