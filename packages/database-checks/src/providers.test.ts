import { describe, expect, it } from "vitest";
import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import { neonConnectionEvidenceCheck } from "./neon.js";
import { supabaseRlsProvenanceCheck } from "./supabase.js";
import { supabasePrivilegedKeyBoundaryCheck } from "./supabaseKeys.js";

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
    acquiredAt: "2026-09-18T14:00:00.000Z"
  };

  return {
    root: "/project",
    files: names,
    gitRepository: true,
    inventorySource: "git-tracked",
    commit: "b".repeat(40),
    source,
    snapshot: {
      schemaVersion: "0.1",
      id: "22222222-2222-4222-8222-222222222222",
      source,
      inventory: {
        source: "git-tracked",
        fileCount: names.length,
        commit: "b".repeat(40)
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

async function run(check: CheckDefinition, context: ProjectContext) {
  const result = await check.run(context);
  return Array.isArray(result) ? { findings: result } : result;
}

describe("Supabase provider evidence", () => {
  it("records versioned RLS and policy-test evidence without claiming live correctness", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.0.0" } }),
      "supabase/config.toml": "project_id = 'example'",
      "supabase/migrations/001_people.sql": [
        "create table public.people (id uuid primary key);",
        "alter table public.people enable row level security;",
        "create policy people_select on public.people for select using (auth.uid() = id);"
      ].join("\n"),
      "supabase/tests/people_rls.sql": "select 1;"
    });

    expect(await supabaseRlsProvenanceCheck.appliesTo?.(context)).toBe(true);
    const result = await run(supabaseRlsProvenanceCheck, context);
    expect(result.gaps ?? []).toEqual([]);
    expect(result.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "database.supabase-rls-provenance:versioned-controls" }),
      expect.objectContaining({ id: "database.supabase-rls-provenance:policy-tests" })
    ]));
    expect(JSON.stringify(result)).toContain("source provenance");
  });

  it("keeps a public table without visible RLS as one aggregate evidence gap", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.0.0" } }),
      "supabase/migrations/001_people.sql": "create table public.people (id uuid primary key);",
      "supabase/migrations/002_notes.sql": "create table notes (id uuid primary key);"
    });

    const result = await run(supabaseRlsProvenanceCheck, context);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps?.[0]).toMatchObject({
      id: "database.supabase-rls-provenance:public-tables-without-visible-rls",
      area: "database"
    });
    expect(result.gaps?.[0]?.evidence).toHaveLength(2);
    expect(result.findings ?? []).toEqual([]);
  });

  it("does not require non-public schemas to use the public Data API RLS pattern", async () => {
    const context = project({
      "supabase/config.toml": "project_id = 'example'",
      "supabase/migrations/001_private.sql": "create table private.audit_log (id uuid primary key);"
    });

    const result = await run(supabaseRlsProvenanceCheck, context);
    expect(result.gaps).toContainEqual(expect.objectContaining({
      id: "database.supabase-rls-provenance:controls-not-visible"
    }));
    expect(JSON.stringify(result)).not.toContain("private.audit_log");
  });

  it("asks for caller and scope verification when current Supabase secret keys are read in a request path", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@supabase/server": "1.0.0" } }),
      "app/api/admin/route.ts": [
        "export async function POST() {",
        "  const keys = process.env.SUPABASE_SECRET_KEYS;",
        "  return Response.json({ configured: Boolean(keys) });",
        "}"
      ].join("\n")
    });

    const result = await run(supabasePrivilegedKeyBoundaryCheck, context);
    expect(result.gaps).toContainEqual(expect.objectContaining({
      id: "database.supabase-secret-key-boundary:app/api/admin/route.ts:SUPABASE_SECRET_KEYS",
      evidence: [expect.objectContaining({ excerpt: "SUPABASE_SECRET_KEYS reference" })]
    }));
    expect(JSON.stringify(result)).not.toContain("sb_secret_");
  });

  it("does not treat a publishable Supabase key name as privileged", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.0.0" } }),
      "app/api/profile/route.ts": "export async function GET() { return Response.json({ key: process.env.SUPABASE_PUBLISHABLE_KEY }); }"
    });

    const result = await run(supabasePrivilegedKeyBoundaryCheck, context);
    expect(result.gaps ?? []).toEqual([]);
  });
});

describe("Neon provider evidence", () => {
  it("records use of the serverless HTTP query helper", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@neondatabase/serverless": "1.0.0" } }),
      "src/db.ts": [
        "import { neon } from '@neondatabase/serverless';",
        "export const sql = neon(process.env.DATABASE_URL!);"
      ].join("\n")
    });

    expect(await neonConnectionEvidenceCheck.appliesTo?.(context)).toBe(true);
    const result = await run(neonConnectionEvidenceCheck, context);
    expect(result.gaps ?? []).toEqual([]);
    expect(result.observations).toContainEqual(expect.objectContaining({
      id: "database.neon-connection-evidence:src/db.ts:http"
    }));
  });

  it("records matching Client cleanup evidence", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@neondatabase/serverless": "1.0.0" } }),
      "src/worker.ts": [
        "import { Client } from '@neondatabase/serverless';",
        "const client = new Client(process.env.DATABASE_URL!);",
        "await client.connect();",
        "await client.query('select 1');",
        "await client.end();"
      ].join("\n")
    });

    const result = await run(neonConnectionEvidenceCheck, context);
    expect(result.gaps ?? []).toEqual([]);
    expect(result.observations).toContainEqual(expect.objectContaining({
      id: "database.neon-connection-evidence:src/worker.ts:client:closed"
    }));
  });

  it("keeps missing Neon Client cleanup as an evidence gap rather than declaring a leak", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@neondatabase/serverless": "1.0.0" } }),
      "app/api/report/route.ts": [
        "import { Client } from '@neondatabase/serverless';",
        "export async function GET() {",
        "  const db = new Client(process.env.DATABASE_URL!);",
        "  await db.connect();",
        "  return Response.json(await db.query('select 1'));",
        "}"
      ].join("\n")
    });

    const result = await run(neonConnectionEvidenceCheck, context);
    expect(result.findings ?? []).toEqual([]);
    expect(result.gaps).toContainEqual(expect.objectContaining({
      id: "database.neon-connection-evidence:app/api/report/route.ts:db:cleanup-not-visible"
    }));
  });

  it("keeps an unclassified Neon dependency as inventory rather than inventing a pooling defect", async () => {
    const context = project({
      "package.json": JSON.stringify({ dependencies: { "@neondatabase/serverless": "1.0.0" } }),
      "src/repository.ts": "export const repository = true;"
    });

    const result = await run(neonConnectionEvidenceCheck, context);
    expect(result.gaps ?? []).toEqual([]);
    expect(result.observations).toContainEqual(expect.objectContaining({
      id: "database.neon-connection-evidence:provider-detected"
    }));
  });
});
