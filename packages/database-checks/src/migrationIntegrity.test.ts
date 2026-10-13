import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { migrationIntegrityCheck, migrationDocumentationCheck, migrationAppliedHistoryCheck } from "./migrationIntegrity.js";

const roots: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-migrations-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const journal = (entries: Array<{ idx: number; tag: string }>) =>
  JSON.stringify({ version: "7", dialect: "postgresql", entries });
const migration = "CREATE TABLE example (id INT PRIMARY KEY);";

describe("repository migration integrity", () => {
  it("accepts consistent Drizzle journal files without asserting deployment state", async () => {
    const root = await fixture({
      "drizzle/0000_initial.sql": migration,
      "drizzle/meta/_journal.json": journal([{ idx: 0, tag: "0000_initial" }])
    });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps).toHaveLength(0);
    expect(report.observations[0]?.title).toContain("migration");
  });

  it("records applied-state uncertainty separately from structural integrity", async () => {
    const root = await fixture({ "drizzle/0000_initial.sql": migration });
    const report = await scanProject(root, [migrationIntegrityCheck, migrationAppliedHistoryCheck]);
    expect(report.gaps.map((item) => item.id)).toContain("database.migration-applied-history:not-verified");
  });

  it("keeps unjournalled duplicate Drizzle sequences as verification questions", async () => {
    const root = await fixture({
      "drizzle/0001_initial.sql": migration,
      "drizzle/0001_backfill.sql": migration
    });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps.map((item) => item.id)).toEqual(expect.arrayContaining([
      "database.migration-integrity:journal-not-visible:drizzle",
      "database.migration-integrity:duplicate-drizzle-sequence:drizzle:0001"
    ]));
  });

  it("flags a Drizzle journal referencing absent SQL", async () => {
    const root = await fixture({
      "drizzle/meta/_journal.json": journal([{ idx: 0, tag: "0000_initial" }])
    });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings.map((item) => item.id)).toContain(
      "database.migration-integrity:missing-sql:drizzle/meta/_journal.json:0000_initial"
    );
  });

  it("flags duplicate Drizzle journal indices", async () => {
    const root = await fixture({
      "drizzle/0000_initial.sql": migration,
      "drizzle/0001_second.sql": migration,
      "drizzle/meta/_journal.json": journal([
        { idx: 0, tag: "0000_initial" },
        { idx: 0, tag: "0001_second" }
      ])
    });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings.some((item) => item.title.includes("reuses a migration"))).toBe(true);
  });

  it("flags a malformed Drizzle journal", async () => {
    const root = await fixture({ "drizzle/meta/_journal.json": "{invalid" });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings[0]?.title).toBe("Drizzle journal is not valid JSON");
  });

  it("flags duplicate Supabase timestamp migration versions", async () => {
    const root = await fixture({
      "supabase/migrations/20260901123456_initial.sql": migration,
      "supabase/migrations/20260901123456_second.sql": migration
    });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings[0]?.title).toBe("Migration identifier is reused");
  });

  it("does not require arbitrary numbered SQL versions to be consecutive", async () => {
    const root = await fixture({
      "migrations/001_first.sql": migration,
      "migrations/005_later.sql": migration
    });
    const report = await scanProject(root, [migrationIntegrityCheck]);
    expect(report.findings).toHaveLength(0);
  });
});

describe("migration documentation evidence", () => {
  it("asks for documented migration instructions when absent", async () => {
    const root = await fixture({ "drizzle/0000_initial.sql": migration });
    const report = await scanProject(root, [migrationDocumentationCheck]);
    expect(report.gaps.map((item) => item.id)).toContain("database.migration-documentation:instructions-not-visible");
  });

  it("recognises repo-visible instructions", async () => {
    const root = await fixture({
      "drizzle/0000_initial.sql": migration,
      "docs/DATABASE.md": "Run the migration with pnpm db:migrate after reviewing the plan. Back up first."
    });
    const report = await scanProject(root, [migrationDocumentationCheck]);
    expect(report.gaps).toHaveLength(0);
  });

  it("asks for recovery evidence when destructive SQL has no documented recovery", async () => {
    const root = await fixture({
      "migrations/002_remove.sql": "DROP TABLE example;",
      "README.md": "Apply migrations with pnpm db:migrate before deployment."
    });
    const report = await scanProject(root, [migrationDocumentationCheck]);
    expect(report.gaps.map((item) => item.id)).toContain("database.migration-documentation:recovery-not-visible");
  });

  it("does not apply when no migration artefacts are present", async () => {
    const root = await fixture({ "package.json": "{}" });
    const report = await scanProject(root, [migrationDocumentationCheck]);
    expect(report.checks[0]?.status).toBe("not-applicable");
  });
});
