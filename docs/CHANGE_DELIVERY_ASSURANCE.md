# Change and delivery assurance

This work extends Ship Check's existing `production-ready` pack. Default checks remain source-only; an additional, explicitly authorised database inspection can compare selected migration ledger metadata. All checks use Finding / Observation / Unverified / Coverage semantics and are **not** a CI quality score or a certificate of database schema equivalence.

## Database migration integrity

`database.migration-integrity` recognises conventional SQL migration files, Supabase timestamped SQL and Drizzle migration SQL/journals. It checks duplicate numeric identifiers for timestamped Supabase and conventional SQL migrations, Drizzle journal JSON structure, duplicate journal tags/indices, and journal entries whose SQL is missing. Some SQL that is not represented in the journal is a verification question rather than a definite fault.

A repository migration observation is accompanied by the separate `database.migration-applied-history` verification question, which is resolved only when the live comparison can complete. The presence of SQL files or a Drizzle journal says nothing about which database environments actually applied those files.

`database.migration-documentation` looks for repository-visible migration instructions in common Markdown runbooks, and recovery guidance when potentially destructive SQL exists. Missing documentation is a question, because the authoritative instructions may be maintained outside Git. The presence of a keyword is not proof that the instructions are complete or have been tested.

**Still not checked:** custom or non-canonical applied-migration ledgers, production-versus-development comparisons, transactional safety, SQL semantics, actual schema equivalence, ability to restore backups or migration-order validity beyond the bounded identifiers. Live ledger access is only available through the separate opt-in documented below.

## CI quality evidence

`production.ci-quality` inspects repository-visible GitHub Actions files. It can:

- detect a test/lint/check/build command that explicitly masks failure using `|| true` or `; exit 0`;
- ask whether CI exists when a project declares quality scripts but contains no GitHub Actions workflows;
- flag absent PR verification evidence where the project has quality scripts and push-only workflows;
- ask for quality evidence when PR workflows have no recognised quality command;
- surface `continue-on-error: true` as a question, not automatically a broken gate;
- question whether PR path filters leave some changes unvalidated; and
- record a positive inventory observation when recognised PR quality commands are visible.

The separate `production.github-actions-supply-chain` rule continues to check broad workflow permissions and moving action references.

**Not yet checked:** required branch-protection statuses; live CI run outcomes or flakiness; test coverage or assertion quality; externally invoked/reusable workflows; other CI providers; step-level YAML semantics beyond the bounded patterns; environment-specific deployment gates; wasted minutes/credits.

## Safety and calibration

- Default checks are source-only and offline. The optional migration-ledger inspection opens one explicitly selected database connection, in a read-only transaction, and requires the separate opt-in; it has no write permissions or migration execution path.
- New checks retain stable IDs and explicit rule version `1`.
- Findings are reserved for demonstrable file-level contradictions. Missing external evidence remains unverified.
- The current source checks do not modify migrations, CI workflows or documentation.
- Live database comparisons require explicit opt-in, narrowly scoped read-only access and deliberate environment selection. Migration SQL itself is never executed by the checker.
- Feedback from real estate scans should calibrate false positives before making these checks enforcement gates.

## Follow-on work

1. Calibrate the new canonical live-ledger comparisons against disposable Drizzle/Neon, Prisma and Supabase environments, including unavailable and custom ledgers.
2. Extend to custom migration runners through an explicit, separately scoped adapter rather than guessing a table name.
3. Model actual GitHub branch rulesets and required checks (optional authenticated GitHub metadata) separately from source-only workflow observations.
4. Add CI execution history, missing/redundant builds, path-filter impact and duplicate work checks using real workflow run evidence.
5. Add diff-aware schema-change to verification evidence without enforcing one test-file-per-change conventions.

Run `pnpm test` and `pnpm check` after modifying the ruleset. The normal `ship-check scan` and estate review will include the new checks whenever the production-ready pack is selected.


## Opt-in live migration-history comparison

A **separate, explicit** migration opt-in extends read-only Postgres metadata inspection to one recognised migration ledger table. The checker does not apply, edit, repair, revert or execute SQL migrations and never reads application records. The ledger is application-owned migration **metadata**, and is distinct from the usual system-catalog-only inspection.

```bash
export SHIP_CHECK_DATABASE_URL='postgresql://readonly_user:...@host/database?sslmode=require'
pnpm ship-check -- scan ./my-project --inspect-database --inspect-migrations \
  --migration-framework drizzle --database-platform neon --format markdown
```

`--migration-framework` must be exactly `drizzle`, `prisma` or `supabase`. Ship Check reads *only one* fixed ledger table, corresponding to the selection:

| Framework | Canonical ledger | Comparison |
| --- | --- | --- |
| Drizzle | `drizzle.__drizzle_migrations` | Journal `when` timestamps and SHA-256 of migration SQL versus ledger `created_at`/`hash` |
| Prisma | `public._prisma_migrations` | Directory names and SQL SHA-256 versus ledger migration names/checksums and lifecycle |
| Supabase | `supabase_migrations.schema_migrations` | Migration versions only; the recognised ledger does not provide a comparable checksum |

The chosen database environment is the one encoded in the explicitly selected read-only connection URL; Ship Check **does not establish whether the URL is production, staging or development**. Select/label it carefully.

The ledger query is gated behind **both** `--inspect-database` and `--inspect-migrations`. No migration rows are queried during ordinary source, desktop, GitHub Action or system-catalog-only database scans. The ledger inventory is capped at 1,000 entries; if truncated, the comparison remains unverified. Missing tables, limited privileges, custom table/schema configurations, incomplete or conflicting source manifests also remain unverified, not clean. This first pass supports only canonical ledger locations and a single framework per invocation.

A complete ledger comparison resolves the source-only *applied history not verified* question. It does not resolve separate Drizzle journal integrity or migration documentation questions and does not prove deployed schema equivalence. Source migrations absent from the selected ledger may intentionally be pending; older applied migrations absent from source may have been archived elsewhere. Both are verification questions. A mismatch between a source migration's SHA-256 and an applied ledger checksum is a high-severity finding requiring human-led investigation, never an automatic fix.

Only aggregate counts, names of source files for detected mismatches and remediation/verification guidance flow into the canonical report. Raw ledger rows, credentials, and full SQL are not persisted to the report or Cloud metadata. Read-only access to the canonical ledger itself still requires explicit database privileges.
