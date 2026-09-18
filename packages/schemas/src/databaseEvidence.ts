import { z } from "zod";
import { ProjectEvidenceSourceSchema } from "./projectEvidence.js";

export const DatabasePlatformSchema = z.enum(["postgres", "supabase", "neon"]);
export type DatabasePlatform = z.infer<typeof DatabasePlatformSchema>;

export const DatabasePrivilegeSchema = z.enum([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER"
]);
export type DatabasePrivilege = z.infer<typeof DatabasePrivilegeSchema>;

export const SupabaseClientRoleSchema = z.enum(["anon", "authenticated", "service_role"]);
export type SupabaseClientRole = z.infer<typeof SupabaseClientRoleSchema>;

export const DatabaseRoleGrantSchema = z.object({
  role: SupabaseClientRoleSchema,
  privileges: z.array(DatabasePrivilegeSchema).min(1)
}).strict();
export type DatabaseRoleGrant = z.infer<typeof DatabaseRoleGrantSchema>;

export const PostgresTableMetadataSchema = z.object({
  schema: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  rlsEnabled: z.boolean(),
  forceRls: z.boolean(),
  policyCount: z.number().int().nonnegative(),
  grants: z.array(DatabaseRoleGrantSchema).default([])
}).strict();
export type PostgresTableMetadata = z.infer<typeof PostgresTableMetadataSchema>;

export const DatabaseMetadataSnapshotSchema = z.object({
  schemaVersion: z.literal("0.1"),
  source: ProjectEvidenceSourceSchema,
  engine: z.literal("postgres"),
  platform: DatabasePlatformSchema,
  inspection: z.object({
    readOnlyTransaction: z.literal(true),
    fixedMetadataQueriesOnly: z.literal(true),
    rowDataRead: z.literal(false),
    tableLimit: z.number().int().positive().max(5000),
    tablesTruncated: z.boolean(),
    inspectorSuperuser: z.boolean(),
    inspectorBypassRls: z.boolean()
  }).strict(),
  tables: z.array(PostgresTableMetadataSchema),
  acquiredAt: z.string().datetime()
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.source.type !== "database") {
    ctx.addIssue({ code: "custom", message: "Database metadata evidence must use a database evidence source.", path: ["source", "type"] });
  }
  if (!snapshot.source.capabilities.includes("database-metadata")) {
    ctx.addIssue({ code: "custom", message: "Database metadata evidence must declare the database-metadata capability.", path: ["source", "capabilities"] });
  }
  if (snapshot.tables.length > snapshot.inspection.tableLimit) {
    ctx.addIssue({ code: "custom", message: "Database metadata tables cannot exceed the declared inspection limit.", path: ["tables"] });
  }
});
export type DatabaseMetadataSnapshot = z.infer<typeof DatabaseMetadataSnapshotSchema>;
