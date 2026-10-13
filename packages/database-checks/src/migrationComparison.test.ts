import { describe, expect, it } from "vitest";
import type { DatabaseContext } from "@ship-check/core/database";
import type { MigrationLedger } from "@ship-check/schemas/databaseEvidence";
import { createLiveMigrationComparisonCheck, type MigrationSourceManifest } from "./migrationComparison.js";

const manifest: MigrationSourceManifest = {
  framework: "drizzle", status: "complete", coversProjectMigrations: true,
  entries: [
    { identifier: "100", path: "drizzle/0000_initial.sql", checksum: "a".repeat(64) },
    { identifier: "200", path: "drizzle/0001_add.sql", checksum: "b".repeat(64) }
  ]
};

function ledger(entries: MigrationLedger["entries"], overrides: Partial<MigrationLedger> = {}): MigrationLedger {
  return { framework: "drizzle", status: "complete", entries, limit: 1000, truncated: false, ...overrides };
}

async function run(expected: MigrationSourceManifest, current: MigrationLedger | undefined) {
  const check = createLiveMigrationComparisonCheck(expected);
  const result = await check.run({
    metadata: { migrationLedger: current }
  } as DatabaseContext);
  if (Array.isArray(result)) throw new Error("Expected structured comparison evidence");
  return result;
}

describe("live migration history reconciliation", () => {
  it("resolves only the source applied-history question after a complete ledger comparison", async () => {
    const result = await run(manifest, ledger([
      { identifier: "100", checksum: "a".repeat(64), state: "applied" },
      { identifier: "200", checksum: "b".repeat(64), state: "applied" }
    ]));
    expect(result.findings ?? []).toHaveLength(0);
    expect(result.gaps ?? []).toHaveLength(0);
    expect(result.observations?.[0]).toMatchObject({
      kind: "verified-control",
      resolvesCheckIds: ["database.migration-applied-history"]
    });
  });

  it("identifies an applied migration whose checksum differs from source", async () => {
    const result = await run(manifest, ledger([
      { identifier: "100", checksum: "f".repeat(64), state: "applied" },
      { identifier: "200", checksum: "b".repeat(64), state: "applied" }
    ]));
    expect(result.findings?.[0]).toMatchObject({
      id: "database.live-migration-comparison:checksum-mismatch:100",
      severity: "high"
    });
    expect(JSON.stringify(result.findings)).not.toContain("f".repeat(64));
  });

  it("reports pending and extra migrations as questions, not destructive fixes", async () => {
    const result = await run(manifest, ledger([
      { identifier: "100", checksum: "a".repeat(64), state: "applied" },
      { identifier: "300", checksum: "c".repeat(64), state: "applied" }
    ]));
    expect(result.findings ?? []).toHaveLength(0);
    expect(result.gaps?.map((item) => item.id)).toEqual(expect.arrayContaining([
      "database.live-migration-comparison:not-applied",
      "database.live-migration-comparison:not-in-source"
    ]));
  });

  it("does not establish completeness from truncated or missing ledger data", async () => {
    const truncated = await run(manifest, ledger([
      { identifier: "100", state: "applied" }
    ], { truncated: true }));
    expect(truncated.observations ?? []).toHaveLength(0);
    expect(truncated.gaps?.[0]?.id).toBe("database.live-migration-comparison:ledger-truncated");
    const absent = await run(manifest, ledger([], { status: "missing" }));
    expect(absent.observations ?? []).toHaveLength(0);
  });

  it("does not resolve all migration history when manual SQL exists outside the selected ledger", async () => {
    const result = await run({ ...manifest, coversProjectMigrations: false }, ledger([
      { identifier: "100", checksum: "a".repeat(64), state: "applied" },
      { identifier: "200", checksum: "b".repeat(64), state: "applied" }
    ]));
    expect(result.observations?.[0]?.resolvesCheckIds).toBeUndefined();
    expect(result.gaps?.map((item) => item.id)).toContain("database.live-migration-comparison:other-source-migrations");
  });

  it("does not compare ambiguous migration folders even when live ledger exists", async () {
    const result = await run({ ...manifest, status: "ambiguous", entries: [] }, ledger([]));
    expect(result.observations ?? []).toHaveLength(0);
    expect(result.gaps?.[0]?.id).toBe("database.live-migration-comparison:source-ambiguous");
  });

  it("never asserts a hash match for Supabase where its ledger has no checksum", async () => {
    const expected: MigrationSourceManifest = {
      framework: "supabase", status: "complete", coversProjectMigrations: true,
      entries: [{ identifier: "20261013123456", path: "supabase/migrations/20261013123456_initial.sql" }]
    };
    const result = await run(expected, {
      framework: "supabase", status: "complete", truncated: false, limit: 1000,
      entries: [{ identifier: "20261013123456", state: "applied" }]
    });
    expect(result.findings ?? []).toHaveLength(0);
    expect(result.gaps ?? []).toHaveLength(0);
  });
});
