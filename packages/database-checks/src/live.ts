import type { DatabaseCheckDefinition } from "@ship-check/core/database";
import type { AssessmentGap, Finding, Observation } from "@ship-check/schemas";
import type { PostgresTableMetadata } from "@ship-check/schemas/databaseEvidence";

function clientGrants(table: PostgresTableMetadata) {
  return table.grants.filter((grant) => grant.role === "anon" || grant.role === "authenticated");
}

function tableLabel(table: PostgresTableMetadata): string {
  return `${table.schema}.${table.name}`;
}

function verifiedObservation(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  evidence: Observation["evidence"];
  resolvesCheckIds?: string[];
}): Observation {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
    area: "database",
    kind: "verified-control",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    ...(input.resolvesCheckIds?.length ? { resolvesCheckIds: input.resolvesCheckIds } : {})
  };
}

function metadataGap(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  detail: string;
  verify: string;
}): AssessmentGap {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
    area: "database",
    title: input.title,
    summary: input.summary,
    evidence: [{ kind: "configuration", detail: input.detail }],
    verify: input.verify
  };
}

function accessFinding(table: PostgresTableMetadata): Finding {
  const grants = clientGrants(table);
  const privileges = [...new Set(grants.flatMap((grant) => grant.privileges))].sort();
  const writable = privileges.some((privilege) => ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].includes(privilege));
  const roleSummary = grants
    .map((grant) => `${grant.role}: ${grant.privileges.join(", ")}`)
    .join("; ");

  return {
    id: `database.supabase-live-access:${table.schema}.${table.name}:rls-disabled`,
    checkId: "database.supabase-live-access",
    pack: "production-ready",
    title: "Client-granted Supabase table has RLS disabled",
    summary: `${tableLabel(table)} grants database privileges to Supabase client roles while Row Level Security is disabled.`,
    severity: writable ? "high" : "medium",
    confidence: "high",
    evidence: [{
      kind: "configuration",
      detail: `${tableLabel(table)} — ${roleSummary}; RLS disabled. No row data was read.`
    }],
    remediation: {
      why: "Supabase client roles with table privileges are constrained by grants and Row Level Security. When RLS is disabled, those grants are not narrowed by per-row policies.",
      fix: "Confirm the table is intended to be reachable through the Supabase Data API. Enable RLS and define the minimum required policies, or revoke client-role grants when the table should not be client-accessible.",
      verify: "Rerun the read-only database metadata check and confirm either RLS is enabled for the client-granted table or the anon/authenticated grants have been removed.",
      agentPrompt: `Review ${tableLabel(table)} as a Supabase Data API table. It currently has client-role grants with RLS disabled. Propose the minimum safe grants and RLS policies for the intended access, without changing data, and include a verification plan.`
    }
  };
}

export const databaseInspectionBoundaryCheck: DatabaseCheckDefinition = {
  id: "database.metadata-inspection-boundary",
  version: "1",
  pack: "production-ready",
  title: "Database inspection boundary",
  description: "Records that Ship Check received a fixed-query, read-only metadata snapshot with no row data and checks whether the inspection credential is narrower than superuser/BYPASSRLS scope.",
  coverage: [{ area: "database", status: "partial" }],
  async run(context) {
    const elevated = context.metadata.inspection.inspectorSuperuser || context.metadata.inspection.inspectorBypassRls;
    return {
      observations: [verifiedObservation({
        id: `${this.id}:bounded`,
        checkId: this.id,
        title: "Database inspection stayed inside the metadata boundary",
        summary: "The database evidence supplied to Ship Check was produced from a read-only transaction using fixed metadata queries, with no application row data included in the snapshot.",
        evidence: [{
          kind: "configuration",
          detail: `Inspection contract: read-only transaction = ${context.metadata.inspection.readOnlyTransaction}; fixed metadata queries only = ${context.metadata.inspection.fixedMetadataQueriesOnly}; row data read = ${context.metadata.inspection.rowDataRead}; table limit = ${context.metadata.inspection.tableLimit}; inventory truncated = ${context.metadata.inspection.tablesTruncated}.`
        }]
      })],
      ...(elevated ? {
        gaps: [metadataGap({
          id: `${this.id}:elevated-inspector-credential`,
          checkId: this.id,
          title: "Database inspector credential is broader than necessary",
          summary: "The connection used for metadata inspection has Postgres superuser or BYPASSRLS authority. Ship Check still used a read-only transaction and fixed metadata queries, but a narrower inspection credential would reduce the trust placed in the local inspection path.",
          detail: `Inspector privilege flags only: superuser = ${context.metadata.inspection.inspectorSuperuser}; BYPASSRLS = ${context.metadata.inspection.inspectorBypassRls}. The role name is not retained.`,
          verify: "Create or use a dedicated login that can connect and read the required system-catalog metadata without superuser or BYPASSRLS, then rerun the database inspection."
        })]
      } : {})
    };
  }
};

export const supabaseLiveAccessCheck: DatabaseCheckDefinition = {
  id: "database.supabase-live-access",
  version: "1",
  pack: "production-ready",
  title: "Live Supabase client-role access boundary",
  description: "Checks live metadata for client-role grants on public tables and verifies that those tables are protected by RLS.",
  principles: ["practice.preserve-safety"],
  coverage: [{ area: "database", status: "assessed" }, { area: "access-control", status: "partial" }],
  async appliesTo(context) {
    return context.metadata.platform === "supabase";
  },
  async run(context) {
    const publicTables = context.metadata.tables.filter((table) => table.schema === "public");
    const clientGranted = publicTables.filter((table) => clientGrants(table).length > 0);
    const unprotected = clientGranted.filter((table) => !table.rlsEnabled);

    if (unprotected.length > 0) {
      return {
        findings: unprotected.map(accessFinding),
        ...(context.metadata.inspection.tablesTruncated ? {
          gaps: [metadataGap({
            id: `${this.id}:table-inventory-truncated`,
            checkId: this.id,
            title: "Database access inventory is incomplete",
            summary: "Ship Check confirmed one or more RLS concerns in the bounded metadata it inspected, but the table inventory was truncated, so additional client-granted tables may not have been assessed.",
            detail: "The bounded database metadata inventory reached its configured table limit.",
            verify: "Rerun the database metadata inspection with a larger bounded table limit or a narrower database scope before treating the live access review as complete."
          })]
        } : {})
      };
    }

    if (context.metadata.inspection.tablesTruncated) {
      return {
        gaps: [metadataGap({
          id: `${this.id}:table-inventory-truncated`,
          checkId: this.id,
          title: "Database access inventory is incomplete",
          summary: `Ship Check inspected the first ${context.metadata.inspection.tableLimit} eligible database tables without finding an RLS/grant concern, but the inventory was truncated. It therefore cannot verify the complete Supabase client-role boundary.`,
          detail: "The bounded database metadata inventory reached its configured table limit.",
          verify: "Rerun the database metadata inspection with a larger bounded table limit or a narrower database scope before relying on this access-control result."
        })]
      };
    }

    if (clientGranted.length === 0) {
      return {
        observations: [verifiedObservation({
          id: `${this.id}:no-client-grants`,
          checkId: this.id,
          title: "No client-role table grants were observed in public",
          summary: `Ship Check inspected ${publicTables.length} public table${publicTables.length === 1 ? "" : "s"} and found no table privileges for the anon or authenticated roles. This verifies the current grant boundary, not future migrations or function access.`,
          evidence: [{
            kind: "configuration",
            detail: `${publicTables.length} public table${publicTables.length === 1 ? "" : "s"} inspected; no anon/authenticated table grants observed.`
          }],
          resolvesCheckIds: ["database.supabase-rls-provenance"]
        })]
      };
    }

    return {
      observations: [verifiedObservation({
        id: `${this.id}:rls-enabled`,
        checkId: this.id,
        title: "RLS is enabled on all client-granted public tables",
        summary: `Ship Check inspected ${clientGranted.length} public table${clientGranted.length === 1 ? "" : "s"} with anon/authenticated grants and found RLS enabled on all of them. This verifies the current RLS/grant boundary, not the correctness of individual policy expressions.`,
        evidence: clientGranted.slice(0, 12).map((table) => ({
          kind: "configuration" as const,
          detail: `${tableLabel(table)} — RLS enabled; ${table.policyCount} polic${table.policyCount === 1 ? "y" : "ies"}; client roles: ${clientGrants(table).map((grant) => grant.role).join(", ")}.`
        })),
        resolvesCheckIds: ["database.supabase-rls-provenance"]
      })]
    };
  }
};

export const liveDatabaseChecks: DatabaseCheckDefinition[] = [
  databaseInspectionBoundaryCheck,
  supabaseLiveAccessCheck
];
