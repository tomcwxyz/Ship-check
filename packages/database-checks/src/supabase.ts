import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Observation } from "@ship-check/schemas";

const SUPABASE_PACKAGES = new Set([
  "@supabase/supabase-js",
  "@supabase/server",
  "@supabase/ssr"
]);

const supabaseMigrationPattern = /(?:^|\/)supabase\/migrations\/.+\.sql$/i;
const supabasePolicyTestPattern = /(?:^|\/)supabase\/tests\/.+\.sql$/i;
const identifierPattern = `(?:"?[A-Za-z_][A-Za-z0-9_$]*"?\\.)?"?[A-Za-z_][A-Za-z0-9_$]*"?`;
const createTablePattern = new RegExp(`\\bCREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${identifierPattern})`, "gi");
const enableRlsPattern = new RegExp(`\\bALTER\\s+TABLE(?:\\s+IF\\s+EXISTS)?\\s+(${identifierPattern})\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\b`, "gi");
const createPolicyPattern = new RegExp(`\\bCREATE\\s+POLICY\\s+[^;]{1,240}?\\s+ON\\s+(${identifierPattern})`, "gi");

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

export async function supabaseSignals(context: ProjectContext): Promise<string[]> {
  const signals = new Set<string>();

  if (context.hasFile("package.json")) {
    const text = await context.readText("package.json");
    if (text) {
      try {
        const dependencies = packageDependencies(JSON.parse(text));
        for (const name of Object.keys(dependencies)) {
          if (SUPABASE_PACKAGES.has(name)) signals.add(`package:${name}`);
        }
      } catch {
        // Invalid package.json is handled by other checks.
      }
    }
  }

  if (context.hasFile("supabase/config.toml")) signals.add("supabase:config");
  if (context.files.some((file) => supabaseMigrationPattern.test(file))) signals.add("supabase:migrations");
  if (context.files.some((file) => /(?:^|\/)supabase\/functions\//i.test(file))) signals.add("supabase:functions");

  return [...signals].sort();
}

function canonicalTable(raw: string): { key: string; exposed: boolean } {
  const cleaned = raw.replaceAll('"', "").toLowerCase();
  const parts = cleaned.split(".");
  if (parts.length === 1) return { key: `public.${parts[0]}`, exposed: true };
  const schema = parts[0] ?? "public";
  const table = parts[1] ?? "";
  return { key: `${schema}.${table}`, exposed: schema === "public" };
}

function collectTables(pattern: RegExp, text: string): string[] {
  const tables = new Set<string>();
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    const raw = match[1];
    if (raw) {
      const table = canonicalTable(raw);
      if (table.exposed) tables.add(table.key);
    }
    match = pattern.exec(text);
  }
  return [...tables];
}

function observation(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  evidence: Observation["evidence"];
}): Observation {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
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
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
    area: "database",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

export const supabaseRlsProvenanceCheck: CheckDefinition = {
  id: "database.supabase-rls-provenance",
  version: "1",
  pack: "production-ready",
  title: "Supabase RLS provenance",
  description: "Checks whether repository-visible Supabase migrations carry Row Level Security controls for public tables created by the project.",
  principles: ["practice.preserve-safety"],
  coverage: [{ area: "database", status: "partial" }, { area: "access-control", status: "partial" }],
  async appliesTo(context) {
    return (await supabaseSignals(context)).length > 0;
  },
  async run(context) {
    const signals = await supabaseSignals(context);
    const migrationFiles = context.files.filter((file) => supabaseMigrationPattern.test(file)).sort();
    const policyTests = context.files.filter((file) => supabasePolicyTestPattern.test(file)).sort();

    if (migrationFiles.length === 0) {
      return {
        gaps: [gap({
          id: `${this.id}:migrations-not-visible`,
          checkId: this.id,
          title: "Supabase RLS provenance is not visible in source",
          summary: "Ship Check found Supabase project evidence but no versioned Supabase SQL migrations, so it cannot establish where RLS, grants or policy changes are reviewed.",
          evidence: [{
            kind: "configuration",
            detail: `Supabase source signals: ${signals.join(", ")}. No supabase/migrations/*.sql files were found.`
          }],
          verify: "Confirm where Supabase schema, grants and RLS policy changes are versioned. Prefer reproducible migrations; otherwise record the external change-management boundary and verify RLS/grants against the live database."
        })]
      };
    }

    const createdTables = new Set<string>();
    const rlsTables = new Set<string>();
    const policyTables = new Set<string>();
    const rlsEvidence: Observation["evidence"] = [];

    for (const file of migrationFiles) {
      const text = await context.readText(file);
      if (!text) continue;
      for (const table of collectTables(createTablePattern, text)) createdTables.add(table);
      const enabled = collectTables(enableRlsPattern, text);
      for (const table of enabled) {
        rlsTables.add(table);
        if (rlsEvidence.length < 12) {
          rlsEvidence.push({
            kind: "file-match",
            path: file,
            excerpt: `RLS enabled for ${table}`,
            detail: "Repository migration contains an explicit ENABLE ROW LEVEL SECURITY statement."
          });
        }
      }
      for (const table of collectTables(createPolicyPattern, text)) policyTables.add(table);
    }

    const observations: Observation[] = [];
    const missingRls = [...createdTables].filter((table) => !rlsTables.has(table)).sort();

    if (rlsTables.size > 0) {
      observations.push(observation({
        id: `${this.id}:versioned-controls`,
        checkId: this.id,
        title: "Supabase RLS controls are versioned with the project",
        summary: `Ship Check found explicit RLS enablement for ${rlsTables.size} public table${rlsTables.size === 1 ? "" : "s"} in Supabase migrations${policyTables.size > 0 ? ` and policy definitions for ${policyTables.size} table${policyTables.size === 1 ? "" : "s"}` : ""}. This establishes source provenance, not live grants or policy correctness.`,
        evidence: rlsEvidence.length > 0
          ? rlsEvidence
          : [{ kind: "configuration", detail: "RLS statements were present in versioned Supabase migrations." }]
      }));
    }

    if (policyTests.length > 0) {
      observations.push(observation({
        id: `${this.id}:policy-tests`,
        checkId: this.id,
        title: "Supabase database policy tests are versioned",
        summary: `Ship Check found ${policyTests.length} SQL test file${policyTests.length === 1 ? "" : "s"} under supabase/tests. Their presence is useful verification evidence but does not prove the tests cover every access path or currently pass.`,
        evidence: policyTests.slice(0, 12).map((file) => ({
          kind: "file-presence" as const,
          path: file,
          detail: "Repository-visible Supabase database test artefact."
        }))
      }));
    }

    if (createdTables.size > 0 && missingRls.length > 0) {
      return {
        observations,
        gaps: [gap({
          id: `${this.id}:public-tables-without-visible-rls`,
          checkId: this.id,
          title: "Some public Supabase tables lack repository-visible RLS enablement",
          summary: `Supabase migrations create ${createdTables.size} public table${createdTables.size === 1 ? "" : "s"}, but Ship Check could not find explicit RLS enablement for ${missingRls.length}. The control may be applied elsewhere or later, so this remains an evidence gap rather than a vulnerability claim.`,
          evidence: missingRls.slice(0, 12).map((table) => ({
            kind: "configuration" as const,
            detail: `No repository-visible ENABLE ROW LEVEL SECURITY statement was matched for ${table}.`
          })),
          verify: "Verify RLS and grants for the listed public tables in the deployed Supabase database. If RLS is intentional, add the enablement and related grant/policy changes to versioned migrations so the boundary is reproducible."
        })]
      };
    }

    if (createdTables.size === 0 && rlsTables.size === 0) {
      return {
        observations,
        gaps: [gap({
          id: `${this.id}:controls-not-visible`,
          checkId: this.id,
          title: "Supabase RLS controls are not visible in the migrations Ship Check can see",
          summary: "Supabase migrations are present, but Ship Check did not find public table creation or explicit RLS enablement. The database may be managed partly elsewhere, so source alone cannot establish the access-control boundary.",
          evidence: migrationFiles.slice(0, 12).map((file) => ({
            kind: "file-presence" as const,
            path: file,
            detail: "Supabase migration inspected; no matching public-table/RLS statement was established by this bounded check."
          })),
          verify: "Confirm which schemas are exposed through the Supabase Data API and verify RLS plus grants for those tables against the live database. Keep the authoritative controls in migrations where practical."
        })]
      };
    }

    return { observations };
  }
};

export const supabaseSourceChecks: CheckDefinition[] = [supabaseRlsProvenanceCheck];
