import type { DatabaseCheckDefinition } from "@ship-check/core/database";
import type { AssessmentGap, Finding, Observation } from "@ship-check/schemas";
import type { MigrationFramework, MigrationLedger } from "@ship-check/schemas/databaseEvidence";

export type MigrationSourceManifest = {
  framework: MigrationFramework;
  status: "complete" | "absent" | "ambiguous" | "invalid";
  entries: Array<{ identifier: string; checksum?: string; path: string }>;
};

const ID = "database.live-migration-comparison";

function gap(suffix: string, title: string, summary: string, verify: string): AssessmentGap {
  return {
    id: ID + ":" + suffix,
    checkId: ID, pack: "production-ready", area: "database", title, summary, verify,
    evidence: [{ kind: "configuration", detail: summary }]
  };
}

function changed(source: MigrationSourceManifest["entries"][number]): Finding {
  return {
    id: ID + ":checksum-mismatch:" + source.identifier,
    checkId: ID, pack: "production-ready",
    title: "Applied migration checksum differs from source",
    summary: source.path + " does not match the checksum recorded for its applied migration in the selected database.",
    severity: "high", confidence: "high",
    evidence: [{ kind: "configuration", path: source.path, detail: "Recorded applied checksum differs from the calculated source checksum; neither hash nor SQL is retained in the finding." }],
    remediation: {
      why: "Changing an already-applied migration can leave new environments with a different schema or migration history.",
      fix: "Do not overwrite applied migrations. Investigate the provenance of this checksum difference and use a new, reviewed migration for subsequent schema changes.",
      verify: "Compare migration histories with the appropriate framework tooling in a representative disposable environment. Confirm which revision was applied before attempting reconciliation.",
      agentPrompt: "Investigate migration checksum drift for " + source.path + ". Do not change production data, modify an applied ledger or rewrite migrations automatically. Identify the original applied migration and propose a reviewed recovery plan."
    }
  };
}

export function createLiveMigrationComparisonCheck(manifest: MigrationSourceManifest): DatabaseCheckDefinition {
  return {
    id: ID,
    version: "1",
    pack: "production-ready",
    title: "Live migration ledger versus repository",
    description: "Compares selected environment migration metadata with a single source migration framework; never executes migration SQL.",
    coverage: [{ area: "database", status: "partial" }],
    run(context) {
      const ledger: MigrationLedger | undefined = context.metadata.migrationLedger;
      const gaps: AssessmentGap[] = [];
      const findings: Finding[] = [];
      const observations: Observation[] = [];
      if (!ledger || ledger.framework !== manifest.framework) {
        return { gaps: [gap("not-collected", "Migration ledger evidence was not collected",
          "The database inspection did not supply a ledger for the selected migration framework.",
          "Enable the separate migration inspection opt-in with the correct framework and selected database.")] };
      }
      if (manifest.status !== "complete") {
        return { gaps: [gap("source-" + manifest.status, "Repository migration history cannot be compared",
          "Source migration manifest status: " + manifest.status + ". No reliable migration-to-database comparison is possible.",
          "Identify one canonical migration folder/journal and ensure all repository migration files are readable.")] };
      }
      if (ledger.status !== "complete") {
        return { gaps: [gap("ledger-" + ledger.status, "Database migration ledger could not be verified",
          "The recognised " + ledger.framework + " migration ledger is " + ledger.status + "; no applied-migration claims can be made.",
          "Confirm the database uses the canonical ledger table, that the inspection credential can SELECT its metadata, and that the connection points at the intended environment.")] };
      }
      if (ledger.truncated) {
        return { gaps: [gap("ledger-truncated", "Migration ledger inventory is incomplete",
          "The migration ledger exceeded " + ledger.limit + " records. A partial ledger cannot establish which migrations are missing.",
          "Inspect the complete ledger with the framework's administration tooling; Ship Check deliberately caps this read at " + ledger.limit + " records.")] };
      }

      const applied = ledger.entries.filter((entry) => entry.state === "applied");
      const incomplete = ledger.entries.filter((entry) => entry.state === "incomplete");
      const known = new Map(manifest.entries.map((entry) => [entry.identifier, entry]));
      const live = new Map(applied.map((entry) => [entry.identifier, entry]));
      const missing = manifest.entries.filter((entry) => !live.has(entry.identifier));
      const extra = applied.filter((entry) => !known.has(entry.identifier));
      let unverifiedChecksums = 0;
      for (const source of manifest.entries) {
        const record = live.get(source.identifier);
        if (!record || !source.checksum) continue;
        if (!record.checksum) {
          unverifiedChecksums += 1;
        } else if (record.checksum !== source.checksum) {
          findings.push(changed(source));
        }
      }
      if (missing.length) gaps.push(gap("not-applied",
        "Repository migrations are not recorded as applied",
        missing.length + " repository migration(s) are not recorded as applied in the selected environment. They may be deliberately pending.",
        "Confirm the target environment and deployment release. Apply pending migrations only through the project's reviewed migration procedure."));
      if (extra.length) gaps.push(gap("not-in-source",
        "Applied migration identities are absent from source",
        extra.length + " applied migration identity/identities are not represented in this repository checkout.",
        "Locate historical migrations or confirm whether the database was provisioned using another project or branch."));
      if (incomplete.length) gaps.push(gap("incomplete-ledger",
        "Migration runs did not all complete",
        incomplete.length + " ledger record(s) were marked incomplete.",
        "Use the framework's recovery tooling to inspect these records before any further migration."));
      if (unverifiedChecksums) gaps.push(gap("no-checksum-evidence",
        "Migration checksum evidence is incomplete",
        unverifiedChecksums + " migration checksum(s) could not be verified from the ledger.",
        "Confirm the exact migration framework's checksum conventions and reconcile its ledger with source."));
      if (new Set(applied.map((entry) => entry.identifier)).size !== applied.length) gaps.push(gap("duplicate-applied",
        "An applied migration identifier occurs more than once",
        "The selected database ledger contains repeated applied migration identities.",
        "Inspect the ledger with the framework's supported migration tooling and establish which records are authoritative."));

      observations.push({
        id: ID + ":compared",
        checkId: ID,
        pack: "production-ready",
        area: "database",
        kind: "verified-control",
        title: "Selected migration ledger compared with source",
        summary: "Compared " + manifest.entries.length + " source migrations with " + applied.length +
          " applied ledger entries for " + ledger.framework + ". This is a migration-ledger comparison, not proof of deployed schema equivalence.",
        evidence: [{ kind: "configuration", detail: "One explicitly selected framework and database ledger were compared inside a bounded read-only inspection." }],
        resolvesCheckIds: ["database.migration-applied-history"]
      });
      return { findings, gaps, observations };
    }
  };
}
