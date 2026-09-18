import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Finding, Observation } from "@ship-check/schemas";

const POSTGRES_PACKAGES = new Set([
  "pg",
  "postgres",
  "@neondatabase/serverless",
  "@supabase/supabase-js"
]);

const migrationArtifactPattern = /(?:^|\/)(?:prisma\/migrations\/|supabase\/migrations\/|drizzle\/|migrations?\/|db\/migrations?\/|database\/migrations?\/).+/i;
const schemaArtifactPattern = /(?:^|\/)(?:prisma\/schema\.prisma|(?:db\/|database\/)?schema\.sql)$/i;
const migrationSqlPattern = /(?:^|\/)(?:prisma\/migrations\/|supabase\/migrations\/|drizzle\/|migrations?\/|db\/migrations?\/|database\/migrations?\/).+\.sql$/i;
const sourceTextPattern = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/i;
const requestSurfacePathPattern = /(?:^|\/)(?:app|src\/app)\/api\/.+\/route\.(?:js|jsx|ts|tsx)$|(?:^|\/)(?:pages|src\/pages)\/api\/.+\.(?:js|jsx|ts|tsx)$|(?:^|\/)(?:api|functions)\/.+\.(?:js|jsx|ts|tsx)$/i;
const requestHandlerPattern = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)|["']use server["']/;
const privilegedCredentialPattern = /\b(?:SUPABASE_SERVICE_ROLE_KEY|DATABASE_ADMIN_URL|POSTGRES_ADMIN_URL|POSTGRES_SUPERUSER_URL|DB_ADMIN_URL|DB_SUPERUSER_URL)\b/g;

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function packageDependencies(manifest: unknown): Record<string, string> {
  if (!manifest || typeof manifest !== "object") return {};
  const record = manifest as { dependencies?: unknown; devDependencies?: unknown };
  const dependencies = record.dependencies && typeof record.dependencies === "object"
    ? record.dependencies as Record<string, string>
    : {};
  const devDependencies = record.devDependencies && typeof record.devDependencies === "object"
    ? record.devDependencies as Record<string, string>
    : {};
  return { ...dependencies, ...devDependencies };
}

async function postgresSignals(context: ProjectContext): Promise<string[]> {
  const signals = new Set<string>();

  if (context.hasFile("package.json")) {
    const text = await context.readText("package.json");
    if (text) {
      try {
        const dependencies = packageDependencies(JSON.parse(text));
        for (const name of Object.keys(dependencies)) {
          if (POSTGRES_PACKAGES.has(name)) signals.add(`package:${name}`);
        }
      } catch {
        // Invalid package.json is handled elsewhere; do not infer database evidence from it.
      }
    }
  }

  if (context.hasFile("prisma/schema.prisma")) {
    const text = await context.readText("prisma/schema.prisma");
    if (text && /provider\s*=\s*["']postgresql["']/i.test(text)) {
      signals.add("prisma:postgresql");
    }
  }

  for (const file of context.files.filter((candidate) => /(?:^|\/)drizzle\.config\.(?:js|mjs|cjs|ts)$/i.test(candidate))) {
    const text = await context.readText(file);
    if (text && /dialect\s*:\s*["'](?:postgresql|postgres)["']/i.test(text)) {
      signals.add(`drizzle:${file}`);
    }
  }

  if (context.hasFile("supabase/config.toml")) signals.add("supabase:config");
  return [...signals].sort();
}

function migrationArtifacts(context: ProjectContext): string[] {
  return context.files
    .filter((file) => migrationArtifactPattern.test(file) || schemaArtifactPattern.test(file))
    .sort();
}

function migrationSqlFiles(context: ProjectContext): string[] {
  return context.files.filter((file) => migrationSqlPattern.test(file)).sort();
}

function observation(input: {
  id: string;
  checkId: string;
  pack: Observation["pack"];
  title: string;
  summary: string;
  evidence: Observation["evidence"];
}): Observation {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: input.pack,
    area: "database",
    kind: "inventory",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence
  };
}

function gap(input: {
  id: string;
  checkId: string;
  pack: AssessmentGap["pack"];
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: input.pack,
    area: "database",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

function finding(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
    title: input.title,
    summary: input.summary,
    severity: "medium",
    confidence: "high",
    evidence: input.evidence,
    remediation: {
      why: input.why,
      fix: input.fix,
      verify: input.verify,
      agentPrompt: input.agentPrompt
    }
  };
}

export const postgresChangeProvenanceCheck: CheckDefinition = {
  id: "database.postgres-change-provenance",
  version: "1",
  pack: "production-ready",
  title: "Postgres change provenance",
  description: "Checks whether a Postgres-backed project contains repository-visible schema or migration artefacts.",
  coverage: [{ area: "database", status: "partial" }],
  async appliesTo(context) {
    return (await postgresSignals(context)).length > 0;
  },
  async run(context) {
    const signals = await postgresSignals(context);
    const artifacts = migrationArtifacts(context);
    if (artifacts.length > 0) {
      return {
        observations: [observation({
          id: "database.postgres-change-provenance:artifacts",
          checkId: this.id,
          pack: this.pack,
          title: "Database change artefacts are versioned with the project",
          summary: `Ship Check found ${artifacts.length} schema or migration artefact${artifacts.length === 1 ? "" : "s"} alongside Postgres source evidence. This establishes provenance, not whether every deployed database change matches source.`,
          evidence: artifacts.slice(0, 12).map((file) => ({
            kind: "file-presence" as const,
            path: file,
            detail: "Repository-visible database schema or migration artefact."
          }))
        })]
      };
    }

    return {
      gaps: [gap({
        id: "database.postgres-change-provenance:not-visible",
        checkId: this.id,
        pack: this.pack,
        title: "Database change provenance is not visible in source",
        summary: "The project contains Postgres-specific source evidence, but Ship Check did not find a recognised schema or migration history. Changes may be managed elsewhere, so this is an evidence gap rather than a defect.",
        evidence: [{
          kind: "configuration",
          detail: `Postgres source signals: ${signals.join(", ")}. No recognised migration/schema artefact was found.`
        }],
        verify: "Confirm where database schema changes are versioned and reviewed. If they are managed outside this project, record that boundary; otherwise add the canonical migrations/schema artefacts to source control."
      })]
    };
  }
};

const destructiveOperations = [
  { label: "DROP DATABASE", regex: /\bDROP\s+DATABASE\b/gi },
  { label: "DROP SCHEMA", regex: /\bDROP\s+SCHEMA\b/gi },
  { label: "DROP TABLE", regex: /\bDROP\s+TABLE\b/gi },
  { label: "TRUNCATE", regex: /\bTRUNCATE(?:\s+TABLE)?\b/gi },
  { label: "ALTER TABLE … DROP COLUMN", regex: /\bALTER\s+TABLE\b[\s\S]{0,240}?\bDROP\s+COLUMN\b/gi }
];

export const destructiveMigrationCheck: CheckDefinition = {
  id: "database.destructive-migration-operation",
  version: "1",
  pack: "production-ready",
  title: "Destructive database migration operations",
  description: "Surfaces explicit destructive SQL in recognised migration files for deliberate pre-ship review.",
  principles: ["practice.preserve-safety"],
  coverage: [{ area: "database", status: "partial" }],
  async appliesTo(context) {
    return (await postgresSignals(context)).length > 0 && migrationSqlFiles(context).length > 0;
  },
  async run(context) {
    const findings: Finding[] = [];
    for (const file of migrationSqlFiles(context)) {
      const text = await context.readText(file);
      if (!text) continue;
      for (const operation of destructiveOperations) {
        operation.regex.lastIndex = 0;
        const match = operation.regex.exec(text);
        if (!match) continue;
        findings.push(finding({
          id: `${this.id}:${file}:${operation.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          checkId: this.id,
          title: "Destructive migration operation needs review",
          summary: `${file} contains ${operation.label}. This may be intentional, but it can remove data or schema and should have an explicit rollout and recovery decision before production use.`,
          evidence: [{
            kind: "file-match",
            path: file,
            line: lineNumber(text, match.index),
            excerpt: `${operation.label} operation detected`,
            detail: "Ship Check records the operation type and location without retaining the surrounding SQL statement."
          }],
          why: "Destructive schema operations can cause irreversible data loss or make rollback unsafe when production data already depends on the affected structure.",
          fix: "Review the migration against production data and rollout expectations. Prefer a staged expand/migrate/contract change where data must be preserved, and confirm backup/recovery or an explicit irreversible-change decision.",
          verify: "Run the migration against a representative non-production database, verify the intended data outcome and rollback/recovery plan, then rerun Ship Check after any migration changes.",
          agentPrompt: `Review the ${operation.label} operation in ${file} as a production database migration. Do not remove it automatically. Determine whether data must be preserved, propose a staged migration if appropriate, and give me rollout, verification and recovery steps.`
        }));
      }
    }
    return { findings };
  }
};

export const privilegedRequestCredentialCheck: CheckDefinition = {
  id: "database.privileged-request-credential",
  version: "1",
  pack: "secure-build",
  title: "Privileged database credentials in request paths",
  description: "Identifies request-handling code that references explicitly privilege-bearing database credential names, then asks for role-scope verification.",
  principles: ["practice.preserve-safety"],
  coverage: [{ area: "database", status: "partial" }, { area: "access-control", status: "partial" }],
  async appliesTo(context) {
    if ((await postgresSignals(context)).length === 0) return false;
    return context.files.some((file) => sourceTextPattern.test(file));
  },
  async run(context) {
    const gaps: AssessmentGap[] = [];
    for (const file of context.files.filter((candidate) => sourceTextPattern.test(candidate))) {
      const text = await context.readText(file);
      if (!text) continue;
      const requestSurface = requestSurfacePathPattern.test(file) || requestHandlerPattern.test(text);
      if (!requestSurface) continue;

      privilegedCredentialPattern.lastIndex = 0;
      let match = privilegedCredentialPattern.exec(text);
      while (match) {
        const credentialName = match[0];
        gaps.push(gap({
          id: `${this.id}:${file}:${credentialName}`,
          checkId: this.id,
          pack: this.pack,
          title: "Request path references a privilege-bearing database credential",
          summary: `${file} references ${credentialName} in request-handling code. The variable name suggests elevated database authority, but source alone cannot establish the actual database role, grants or upstream authorisation boundary.`,
          evidence: [{
            kind: "file-match",
            path: file,
            line: lineNumber(text, match.index),
            excerpt: `${credentialName} reference`,
            detail: "Only the environment-variable name is recorded; no credential value is read into the evidence."
          }],
          verify: "Verify the credential's database role and grants, the authentication/authorisation boundary before this request path, and whether a narrower runtime role can perform the same operation. For Supabase service-role use, explicitly verify where RLS bypass is permitted."
        }));
        match = privilegedCredentialPattern.exec(text);
      }
    }
    return { gaps };
  }
};

export const databaseSourceChecks: CheckDefinition[] = [
  postgresChangeProvenanceCheck,
  destructiveMigrationCheck,
  privilegedRequestCredentialCheck
];
