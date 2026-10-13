import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrationManifest } from "./migrationManifest.js";
const roots: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-ledger-manifest-"));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("source migration manifests", () => {
  it("extracts Drizzle journal timestamps and calculates SQL hashes", async () => {
    const root = await fixture({
      "drizzle/meta/_journal.json": JSON.stringify({ entries: [{ idx: 0, tag: "0000_initial", when: 1700000000000 }] }),
      "drizzle/0000_initial.sql": "CREATE TABLE example (id int);"
    });
    const result = await loadMigrationManifest(root, "drizzle");
    expect(result.status).toBe("complete");
    expect(result.entries).toEqual([expect.objectContaining({
      identifier: "1700000000000", path: "drizzle/0000_initial.sql",
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/)
    })]);
  });

  it("does not guess applied history when journal SQL is missing", async () => {
    const root = await fixture({
      "drizzle/meta/_journal.json": JSON.stringify({ entries: [{ idx: 0, tag: "0000_initial", when: 1 }] })
    });
    expect((await loadMigrationManifest(root, "drizzle")).status).toBe("invalid");
  });

  it("reads canonical Prisma SQL folders", async () => {
    const root = await fixture({ "prisma/migrations/20261012110000_init/migration.sql": "CREATE TABLE test (id int);" });
    const result = await loadMigrationManifest(root, "prisma");
    expect(result.status).toBe("complete");
    expect(result.entries[0]?.identifier).toBe("20261012110000_init");
    expect(result.entries[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads Supabase timestamps without asserting any checksum exists in its ledger", async () => {
    const root = await fixture({ "supabase/migrations/20261013123456_init.sql": "-- safe" });
    const result = await loadMigrationManifest(root, "supabase");
    expect(result).toMatchObject({
      status: "complete", entries: [{ identifier: "20261013123456" }]
    });
    expect(result.entries[0]).not.toHaveProperty("checksum");
  });

  it("requires an unambiguous canonical manifest", async () => {
    const root = await fixture({
      "a/drizzle/meta/_journal.json": JSON.stringify({ entries: [] }),
      "b/drizzle/meta/_journal.json": JSON.stringify({ entries: [] })
    });
    expect((await loadMigrationManifest(root, "drizzle")).status).toBe("ambiguous");
  });
});
