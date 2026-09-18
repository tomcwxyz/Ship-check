import { describe, expect, it } from "vitest";
import type { ProjectContext } from "@ship-check/core";
import {
  destructiveMigrationCheck,
  postgresChangeProvenanceCheck,
  privilegedRequestCredentialCheck
} from "./index.js";

function project(files: Record<string, string>): ProjectContext {
  const names = Object.keys(files).sort();
  const source = {
    schemaVersion: "0.1" as const,
    id: "local:/project",
    type: "source" as const,
    provider: "local",
    label: "/project",
    acquisition: "local" as const,
    executionLocation: "user-device" as const,
    capabilities: ["source-files" as const],
    ephemeral: false,
    acquiredAt: "2026-09-18T13:00:00.000Z"
  };

  return {
    root: "/project",
    files: names,
    gitRepository: true,
    inventorySource: "git-tracked",
    commit: "a".repeat(40),
    source,
    snapshot: {
      schemaVersion: "0.1",
      id: "11111111-1111-4111-8111-111111111111",
      source,
      inventory: {
        source: "git-tracked",
        fileCount: names.length,
        commit: "a".repeat(40)
      }
    },
    hasFile(relativePath) {
      return Object.hasOwn(files, relativePath);
    },
    isTracked(relativePath) {
      return Object.hasOwn(files, relativePath);
    },
    async readText(relativePath) {
      return files[relativePath] ?? null;
    }
  };
}

function structured(result: Awaited<ReturnType<NonNullable<typeof postgresChangeProvenanceCheck.run>>>) {
  return Array.isArray(result) ? { findings: result } : result;
}

describe("Postgres source evidence", () => {
  it("records versioned migration artefacts as an observation, not a safety claim", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { pg: "8.13.0" } }),
      "migrations/001_create_people.sql": "create table people (id uuid primary key);"
    });

    expect(await postgresChangeProvenanceCheck.appliesTo?.(context)).toBe(true);
    const result = structured(await postgresChangeProvenanceCheck.run(context));
    expect(result.gaps ?? []).toEqual([]);
    expect(result.observations).toContainEqual(expect.objectContaining({
      id: "database.postgres-change-provenance:artifacts",
      kind: "inventory",
      area: "database"
    }));
  });

  it("keeps missing migration provenance as an evidence gap", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@neondatabase/serverless": "1.0.0" } }),
      "src/db.ts": "export const database = true;"
    });

    const result = structured(await postgresChangeProvenanceCheck.run(context));
    expect(result.findings ?? []).toEqual([]);
    expect(result.gaps).toContainEqual(expect.objectContaining({
      id: "database.postgres-change-provenance:not-visible",
      area: "database"
    }));
  });

  it("surfaces destructive migration operations without retaining the SQL statement", async () => {
    const sql = "alter table people drop column legacy_identifier;";
    const context = project({
      "package.json": JSON.stringify({ dependencies: { postgres: "3.4.5" } }),
      "migrations/002_remove_legacy.sql": sql
    });

    expect(await destructiveMigrationCheck.appliesTo?.(context)).toBe(true);
    const result = structured(await destructiveMigrationCheck.run(context));
    expect(result.findings).toHaveLength(1);
    expect(result.findings?.[0]).toMatchObject({
      checkId: "database.destructive-migration-operation",
      severity: "medium",
      confidence: "high",
      evidence: [{
        path: "migrations/002_remove_legacy.sql",
        line: 1,
        excerpt: "ALTER TABLE … DROP COLUMN operation detected"
      }]
    });
    expect(JSON.stringify(result.findings)).not.toContain(sql);
  });

  it("asks for role-scope verification when request code uses an explicitly privileged credential", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.0.0" } }),
      "app/api/admin/route.ts": [
        "export async function POST() {",
        "  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;",
        "  return Response.json({ ok: Boolean(key) });",
        "}"
      ].join("\n")
    });

    const result = structured(await privilegedRequestCredentialCheck.run(context));
    expect(result.findings ?? []).toEqual([]);
    expect(result.gaps).toContainEqual(expect.objectContaining({
      checkId: "database.privileged-request-credential",
      area: "database",
      evidence: [expect.objectContaining({
        path: "app/api/admin/route.ts",
        line: 2,
        excerpt: "SUPABASE_SERVICE_ROLE_KEY reference"
      })]
    }));
    expect(JSON.stringify(result.gaps)).not.toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
  });

  it("does not treat a generic server-only DATABASE_URL name as proof of elevated privileges", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { pg: "8.13.0" } }),
      "app/api/people/route.ts": [
        "export async function GET() {",
        "  const url = process.env.DATABASE_URL;",
        "  return Response.json({ configured: Boolean(url) });",
        "}"
      ].join("\n")
    });

    const result = structured(await privilegedRequestCredentialCheck.run(context));
    expect(result.gaps ?? []).toEqual([]);
  });

  it("does not apply Postgres checks to a project with no Postgres-specific source evidence", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { sqlite3: "5.1.7" } }),
      "src/db.ts": "export const database = 'sqlite';"
    });

    expect(await postgresChangeProvenanceCheck.appliesTo?.(context)).toBe(false);
    expect(await privilegedRequestCredentialCheck.appliesTo?.(context)).toBe(false);
  });
});
