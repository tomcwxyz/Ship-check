import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Finding, Observation } from "@ship-check/schemas";

const sqlMigration = /(?:^|\/)(?:drizzle|supabase\/migrations|prisma\/migrations|migrations?|db\/migrations?|database\/migrations?)\/.+\.sql$/i;
const drizzleSql = /(?:^|\/)drizzle\/([^/]+)\.sql$/i;
const drizzleJournal = /(?:^|\/)drizzle\/(?:meta|_meta)\/_journal\.json$/i;
const prismaMigration = /(?:^|\/)prisma\/migrations\/([^/]+)\/migration\.sql$/i;
const supabaseMigration = /(?:^|\/)supabase\/migrations\/(\d{14})_[^/]+\.sql$/i;
const plainMigration = /(?:^|\/)(?:migrations?|db\/migrations?|database\/migrations?)\/(\d{2,})[_-][^/]+\.sql$/i;

function sourceMigrations(context: ProjectContext): string[] {
  return context.files.filter((file) => sqlMigration.test(file)).sort();
}

function evidence(path: string, detail: string) {
  return [{ kind: "file-presence" as const, path, detail }];
}

function gap(checkId: string, suffix: string, title: string, summary: string, verify: string, path?: string): AssessmentGap {
  return {
    id: checkId + ":" + suffix, checkId, pack: "production-ready", area: "database",
    title, summary,
    evidence: [{ kind: "configuration", ...(path ? { path } : {}), detail: summary }],
    verify
  };
}

function finding(checkId: string, suffix: string, title: string, summary: string, path: string, fix: string): Finding {
  return {
    id: checkId + ":" + suffix, checkId, pack: "production-ready",
    title, summary, severity: "medium", confidence: "high",
    evidence: evidence(path, summary),
    remediation: {
      why: "Migration identity and ordering must be unambiguous for repeatable database changes.",
      fix,
      verify: "Check the migration tooling's recorded state against a disposable database, then rerun Ship Check.",
      agentPrompt: "Investigate " + path + " and its migration history. Preserve deployed data; do not rename or rewrite an applied migration without checking its database ledger first. " + fix
    }
  };
}

const ID = "database.migration-integrity";

export const migrationIntegrityCheck: CheckDefinition = {
  id: ID,
  version: "1",
  pack: "production-ready",
  title: "Migration history integrity",
  description: "Checks repository migration naming and Drizzle journal consistency; does not claim to know applied database state.",
  coverage: [{ area: "database", status: "partial" }],
  appliesTo(context) {
    return sourceMigrations(context).length > 0 || context.files.some((file) => drizzleJournal.test(file));
  },
  async run(context) {
    const files = sourceMigrations(context);
    const findings: Finding[] = [];
    const gaps: AssessmentGap[] = [];
    const observations: Observation[] = [];
    const seen = new Map<string, string>();

    for (const file of files) {
      let key: string | undefined;
      const prisma = prismaMigration.exec(file);
      const supabase = supabaseMigration.exec(file);
      const plain = plainMigration.exec(file);
      const drizzle = drizzleSql.exec(file);
      if (prisma) key = "prisma:" + file.slice(0, file.lastIndexOf("/")) .replace(/\/[^/]+$/, "") + ":" + prisma[1];
      else if (supabase) key = "supabase:" + file.slice(0, file.lastIndexOf("/")) + ":" + supabase[1];
      else if (plain) key = "sql:" + file.slice(0, file.lastIndexOf("/")) + ":" + plain[1];
      // Drizzle uses a separate journal for identity; checking it below avoids false duplicate claims.
      if (!key || drizzle) continue;
      const other = seen.get(key);
      if (other) {
        findings.push(finding(ID, "duplicate:" + file, "Migration identifier is reused",
          file + " and " + other + " share a migration identifier in the same migration family.",
          file, "Resolve the duplicate identifier using the migration framework's supported process after confirming neither file was applied."));
      } else seen.set(key, file);
    }

    // Drizzle may also be used with hand-managed SQL. No journal is a verification
    // question, not evidence that migrations were never applied.
    const drizzleByRoot = new Map<string, string[]>();
    for (const file of files) {
      if (!drizzleSql.test(file)) continue;
      const root = file.slice(0, file.lastIndexOf("/"));
      drizzleByRoot.set(root, [...(drizzleByRoot.get(root) ?? []), file]);
    }
    for (const [root, sqlFiles] of drizzleByRoot) {
      if (!context.hasFile(root + "/meta/_journal.json") && !context.hasFile(root + "/_meta/_journal.json")) {
        gaps.push(gap(ID, "journal-not-visible:" + root,
          "Drizzle migration journal is not visible",
          sqlFiles.length + " direct Drizzle SQL file(s) exist in " + root + ", but no recognised Drizzle migration journal is present.",
          "Confirm whether migrations are managed by Drizzle Kit, a custom runner or manually. Locate the authoritative applied history before comparing to a database.", sqlFiles[0]));
      }
      const prefixes = new Map<string, string>();
      for (const sqlFile of sqlFiles) {
        const basename = sqlFile.slice(root.length + 1);
        const sequence = /^(\\d+)[_-]/.exec(basename)?.[1];
        if (!sequence) continue;
        const earlier = prefixes.get(sequence);
        if (earlier) gaps.push(gap(ID, "duplicate-drizzle-sequence:" + root + ":" + sequence,
          "Drizzle SQL filenames reuse a numeric sequence",
          sqlFile + " and " + earlier + " share numeric prefix " + sequence + ". This may be intentional for hand-managed migrations.",
          "Check the canonical Drizzle journal or custom migration runner to determine whether these SQL files are independently applied and safely ordered.", sqlFile));
        else prefixes.set(sequence, sqlFile);
      }
    }

    for (const journal of context.files.filter((file) => drizzleJournal.test(file))) {
      const text = await context.readText(journal);
      if (text === null) {
        gaps.push(gap(ID, "unreadable:" + journal, "Drizzle journal could not be read",
          "Ship Check could not read " + journal + " to compare it with migration SQL.",
          "Inspect the journal locally and confirm it tracks the migration SQL.", journal));
        continue;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch {
        findings.push(finding(ID, "invalid-json:" + journal, "Drizzle journal is not valid JSON",
          journal + " cannot be parsed as JSON.", journal, "Restore a valid Drizzle migration journal without rewriting applied history."));
        continue;
      }
      const entries = parsed && typeof parsed === "object" && "entries" in parsed
        ? (parsed as { entries?: unknown }).entries : undefined;
      if (!Array.isArray(entries)) {
        findings.push(finding(ID, "invalid-entries:" + journal, "Drizzle journal entries are missing",
          journal + " has no valid entries array.", journal, "Restore the framework's expected journal format."));
        continue;
      }
      const parent = journal.slice(0, journal.lastIndexOf("/"));
      const root = parent.slice(0, parent.lastIndexOf("/"));
      const seenTags = new Set<string>();
      const seenIndices = new Set<number>();
      for (const entry of entries) {
        if (!entry || typeof entry !== "object" || typeof entry.tag !== "string" || typeof entry.idx !== "number" || !Number.isInteger(entry.idx)) {
          gaps.push(gap(ID, "malformed-entry:" + journal, "Drizzle journal contains an unfamiliar entry",
            "Not all entries in " + journal + " have a string tag and integer index.",
            "Use the installed Drizzle tooling to inspect and validate the journal.", journal));
          continue;
        }
        const tag = entry.tag as string;
        const idx = entry.idx as number;
        if (seenTags.has(tag) || seenIndices.has(idx)) {
          findings.push(finding(ID, "duplicate-journal:" + journal + ":" + tag,
            "Drizzle journal reuses a migration identity",
            journal + " repeats a migration tag or index for " + tag + ".", journal,
            "Resolve the conflicting journal identity using the database's actual applied history."));
        }
        seenTags.add(tag);
        seenIndices.add(idx);
        if (!context.hasFile(root + "/" + tag + ".sql")) {
          findings.push(finding(ID, "missing-sql:" + journal + ":" + tag,
            "Drizzle journal references missing SQL",
            journal + " references " + tag + " but the matching SQL file is not present.", journal,
            "Recover the matching migration file from version control or reconcile the journal against the deployed database."));
        }
      }
      const unmatched = files.filter((file) => drizzleSql.test(file) && file.startsWith(root + "/") &&
        !seenTags.has(file.slice(root.length + 1, -4)));
      if (unmatched.length) gaps.push(gap(ID, "unjournalled:" + journal, "Drizzle SQL is not recorded in the journal",
        unmatched.length + " Drizzle SQL file(s) in " + root + " have no matching journal tag.",
        "Confirm whether these files are generated migrations or hand-written SQL; only reconcile genuine migrations.", unmatched[0]));
    }

    if (files.length > 0) {
      observations.push({
        id: ID + ":repository-migrations", checkId: ID, pack: "production-ready",
        area: "database", kind: "inventory",
        title: "Repository migration files located",
        summary: "Found " + files.length + " migration SQL file(s). This does not verify whether they ran on a real database.",
        evidence: evidence(files[0], "Representative source-controlled migration file.")
      });
    }
    return { findings, gaps, observations };
  }
};

const DOC_ID = "database.migration-documentation";
const docPath = /(?:^|\/)(?:README|CONTRIBUTING|DEPLOYMENT|RUNBOOK|DATABASE|MIGRATIONS?|OPERATIONS|RELEASE)(?:\.[^/]*)?\.md$|(?:^|\/)docs\/[^/]+\.md$/i;
const migrationInstructions = /\b(?:migrat(?:e|ion|ions)|drizzle-kit|prisma\s+migrate|supabase\s+db|db:push|db:migrate)\b/i;
const recoveryGuidance = /\b(?:rollback|roll\s?back|backups?|restore|recovery|expand[\/-]contract)\b/i;
const destructiveSql = /\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DROP\s+COLUMN)\b/i;

export const migrationDocumentationCheck: CheckDefinition = {
  id: DOC_ID,
  version: "1",
  pack: "production-ready",
  title: "Database migration instructions",
  description: "Looks for repository-visible migration and recovery guidance; external runbooks remain unverified.",
  coverage: [{ area: "database", status: "partial" }],
  appliesTo(context) { return sourceMigrations(context).length > 0; },
  async run(context) {
    const files = sourceMigrations(context);
    const candidates = context.files.filter((file) => docPath.test(file)).slice(0, 80);
    let instructions = false;
    let recovery = false;
    for (const file of candidates) {
      const text = await context.readText(file);
      if (!text) continue;
      if (migrationInstructions.test(text)) instructions = true;
      if (recoveryGuidance.test(text)) recovery = true;
    }
    const gaps: AssessmentGap[] = [];
    if (!instructions) gaps.push(gap(DOC_ID, "instructions-not-visible",
      "Migration instructions are not visible",
      "No recognised database migration instructions were found in the scanned Markdown documentation.",
      "Find the team's authoritative migration commands and environment promotion instructions; document them in the repository or record the external runbook.", files[0]));
    let destructive = false;
    for (const file of files.slice(0, 200)) {
      const text = await context.readText(file);
      if (text && destructiveSql.test(text)) { destructive = true; break; }
    }
    if (destructive && !recovery) gaps.push(gap(DOC_ID, "recovery-not-visible",
      "Recovery instructions for destructive changes are not visible",
      "A migration contains potentially destructive SQL, but the inspected Markdown documentation did not establish a rollback or recovery procedure.",
      "Confirm a tested recovery/backup plan or an explicitly approved irreversible change. An external runbook may satisfy this control.", files[0]));
    return { gaps };
  }
};

/**
 * Dedicated source-control question, resolvable ONLY by a complete live-ledger
 * comparison; other structural migration questions remain independent.
 */
export const migrationAppliedHistoryCheck: CheckDefinition = {
  id: "database.migration-applied-history",
  version: "1",
  pack: "production-ready",
  title: "Applied migration history",
  description: "Asks for an environment-specific applied-migration comparison rather than assuming tracked SQL has been deployed.",
  coverage: [{ area: "database", status: "partial" }],
  appliesTo(context) { return sourceMigrations(context).length > 0; },
  async run(context) {
    return {
      gaps: [gap(this.id, "not-verified",
        "Applied migration history not verified",
        "Repository migrations are present, but the selected database environment's migration ledger has not been compared with source.",
        "Run an explicit, read-only migration-ledger comparison for a named database environment. Use a dedicated limited database credential.",
        sourceMigrations(context)[0])]
    };
  }
};
