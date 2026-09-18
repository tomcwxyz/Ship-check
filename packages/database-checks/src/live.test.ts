import { describe, expect, it } from "vitest";
import type { DatabaseContext } from "@ship-check/core/database";
import { DatabaseMetadataSnapshotSchema } from "@ship-check/schemas/databaseEvidence";
import {
  databaseInspectionBoundaryCheck,
  supabaseLiveAccessCheck
} from "./live.js";

function context(tables: Array<{
  schema: string;
  name: string;
  rlsEnabled: boolean;
  forceRls?: boolean;
  policyCount?: number;
  grants?: Array<{ role: "anon" | "authenticated" | "service_role"; privileges: Array<"SELECT" | "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE" | "REFERENCES" | "TRIGGER"> }>;
}>): DatabaseContext {
  const metadata = DatabaseMetadataSnapshotSchema.parse({
    schemaVersion: "0.1",
    source: {
      schemaVersion: "0.1",
      id: "database:supabase-example",
      type: "database",
      provider: "supabase",
      label: "Supabase database",
      acquisition: "remote-readonly",
      executionLocation: "user-device",
      capabilities: ["database-metadata"],
      ephemeral: true,
      acquiredAt: "2026-09-18T14:40:00.000Z"
    },
    engine: "postgres",
    platform: "supabase",
    inspection: {
      readOnlyTransaction: true,
      fixedMetadataQueriesOnly: true,
      rowDataRead: false
    },
    tables: tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      rlsEnabled: table.rlsEnabled,
      forceRls: table.forceRls ?? false,
      policyCount: table.policyCount ?? 0,
      grants: table.grants ?? []
    })),
    acquiredAt: "2026-09-18T14:40:00.000Z"
  });
  return { source: metadata.source, metadata };
}

function structured(result: Awaited<ReturnType<typeof supabaseLiveAccessCheck.run>>) {
  return Array.isArray(result) ? { findings: result } : result;
}

describe("live database evidence", () => {
  it("records the inspector trust boundary without row data", async () => {
    const result = await databaseInspectionBoundaryCheck.run(context([]));
    const structuredResult = Array.isArray(result) ? { findings: result } : result;
    expect(structuredResult.observations).toContainEqual(expect.objectContaining({
      id: "database.metadata-inspection-boundary:bounded",
      kind: "verified-control"
    }));
    expect(JSON.stringify(structuredResult)).toContain("row data read = false");
  });

  it("surfaces a client-readable public table with RLS disabled", async () => {
    const result = structured(await supabaseLiveAccessCheck.run(context([{
      schema: "public",
      name: "profiles",
      rlsEnabled: false,
      grants: [{ role: "anon", privileges: ["SELECT"] }]
    }])));

    expect(result.findings).toContainEqual(expect.objectContaining({
      id: "database.supabase-live-access:public.profiles:rls-disabled",
      severity: "medium",
      confidence: "high"
    }));
  });

  it("raises severity when a client-granted table can be modified with RLS disabled", async () => {
    const result = structured(await supabaseLiveAccessCheck.run(context([{
      schema: "public",
      name: "submissions",
      rlsEnabled: false,
      grants: [{ role: "authenticated", privileges: ["SELECT", "INSERT", "UPDATE"] }]
    }])));

    expect(result.findings?.[0]).toMatchObject({
      id: "database.supabase-live-access:public.submissions:rls-disabled",
      severity: "high"
    });
  });

  it("verifies the live boundary when all client-granted public tables have RLS", async () => {
    const result = structured(await supabaseLiveAccessCheck.run(context([{
      schema: "public",
      name: "profiles",
      rlsEnabled: true,
      policyCount: 3,
      grants: [{ role: "authenticated", privileges: ["SELECT", "UPDATE"] }]
    }])));

    expect(result.findings ?? []).toEqual([]);
    expect(result.observations).toContainEqual(expect.objectContaining({
      id: "database.supabase-live-access:rls-enabled",
      kind: "verified-control",
      resolvesCheckIds: ["database.supabase-rls-provenance"]
    }));
  });

  it("can resolve source uncertainty when public tables have no anon/authenticated grants", async () => {
    const result = structured(await supabaseLiveAccessCheck.run(context([{
      schema: "public",
      name: "internal_jobs",
      rlsEnabled: false,
      grants: [{ role: "service_role", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] }]
    }])));

    expect(result.findings ?? []).toEqual([]);
    expect(result.observations).toContainEqual(expect.objectContaining({
      id: "database.supabase-live-access:no-client-grants",
      resolvesCheckIds: ["database.supabase-rls-provenance"]
    }));
  });
});
