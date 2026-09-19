# Roadmap

## Post-alpha.6: understandable, evidence-led review

- [x] Distinguish recognised public Supabase client keys from potential private credentials.
- [x] Explicit check applicability and source/scanner provenance.
- [x] Browser-data boundary questions and plain-language review cards with technical handoff.
- [ ] Native installer testing of the new review flow.
- [ ] Broaden reviewed guidance and data-flow coverage beyond the initial bounded rules.

See [implementation and limitations](./PLAIN_LANGUAGE_REVIEW.md).

Ship Check is an assurance tool, not a clean-bill-of-health generator. The roadmap therefore prioritises **defensible evidence depth** over simply adding more UI or more regex rules.

A scan should distinguish four things clearly:

1. **Finding** — project evidence supports a concrete concern.
2. **Observed** — useful project-visible architecture/evidence was discovered; this is neither a concern nor proof that the surface is safe.
3. **Unverified** — Ship Check found a relevant control or boundary but cannot establish it from the evidence available.
4. **Coverage** — the bounded areas Ship Check did or did not assess.

“No findings” must never imply that unassessed areas are safe, and “observed” must never be treated as “verified” unless a specific check establishes the control. Explicitly suppressed findings remain visible as accepted exceptions rather than disappearing from the evidence record.

## Strategic direction — from repository scanner to project assurance

The repository remains an important evidence source, but it should not become Ship Check's permanent product boundary. Increasingly, people build and deploy software in hosted environments where they may not work locally or directly with Git at all. Ship Check should therefore evolve towards checking a **project from the evidence sources the user can provide**, while remaining explicit about what each source can and cannot establish.

A project may combine evidence from:

- a local folder;
- GitHub or another source-control provider;
- an uploaded source archive;
- a hosted builder such as Lovable, Replit, Bolt or similar;
- a deployed application URL;
- a read-only database connection;
- CI/runtime execution;
- platform-specific configuration or metadata.

These sources should be normalised behind portable contracts rather than creating separate scanner implementations per platform. The canonical checking engine remains shared across local, CI and hosted execution.

The product promise should remain evidence-led: **give Ship Check what you have built, wherever you built it, and it should say what it can establish, what needs attention, and what it still cannot see.**

### Cloud/hybrid principles

- **Local-first remains a real option, not a legacy mode.** A user must be able to run Ship Check without sending source to Ship Check infrastructure.
- **Cloud is primarily a control plane before it is a hosted scanner.** History, comparison, collaboration and assurance metadata can provide value without centralising source code.
- **Execution location is explicit.** A scan may run locally, inside CI, or in a managed ephemeral runner; reports should record where and how evidence was acquired.
- **Source retention is not the default.** Managed source scans use isolated ephemeral workers and should not persist repository contents after the scan.
- **Secrets never become report data.** Existing credential-redaction and bounded-evidence rules apply regardless of execution location.
- **Evidence sources stay distinct.** Repository, runtime, database and platform evidence can corroborate one another, but provenance must remain visible.
- **Coverage follows evidence.** A live URL must never imply that source, database or server-side controls were assessed when they were not.
- **No fake score.** Cloud history should surface change, uncertainty and attention rather than collapsing assurance into a single green/red number.

## Alpha 0 — checking contract and CLI

- [x] Versioned finding/report schemas.
- [x] Local repository inventory with Git-aware tracked-file scope.
- [x] Secure Build starter checks: tracked env files, credential patterns, paid API endpoints without obvious controls, wildcard CORS and public secret-like env names.
- [x] Production Ready starter checks: dependency lock discipline and Next.js security-header evidence.
- [x] Plain and JSON CLI output.
- [x] Optional severity exit gate for CI/RACK use.
- [x] Risky/safe regression fixtures.
- [x] Self-contained native engine compilation and dogfood gate.
- [x] Standalone CLI repository source accepts either a local folder or a transient GitHub checkout.

## Alpha 1 — useful standalone repository review

- [x] Dependency-light Tauri desktop shell following the RACK/TOPO local-first boundary without duplicating checker logic.
- [x] Native folder selection, local-engine status, scan progress and summary.
- [x] GitHub repository mode with shallow temporary checkout, optional branch/tag and cleanup after the scan.
- [x] Finding review with severity/pack context, evidence, why it matters, fix, verification guidance, copy repair prompt and re-check.
- [x] Manual Windows x64/Linux x64/macOS Apple Silicon desktop alpha pre-release workflow with explicit confirmation and matching bundled engine.
- [ ] Dogfood the macOS alpha, including local-folder and GitHub/private-repository flows.
- [ ] Proper Windows signing and macOS Developer ID signing/notarisation for pilot distribution.

## Alpha 1.5 — evidence-quality dogfood baseline

The `0.0.0-alpha.5` desktop build is the baseline for corpus testing. The purpose is to learn what is useful, noisy and missing before treating the current check catalogue as broad assurance.

Observed during first Windows dogfood:

- Next.js security-header absence was a frequent result even though the control may be owned by hosting infrastructure.
- high-frequency scheduler/polling findings were recurrent and often useful.
- several real repositories returned no findings, exposing that the product did not make its narrow assessment coverage visible enough.

Priorities:

- [x] Run the desktop against multiple real repositories and use results to identify repeated findings and obvious gaps.
- [x] Treat “no findings” as an assessment statement, not a clean bill of health.
- [x] Use the first corpus observations to define the Alpha 1.6 depth work.
- [ ] Continue recording findings as `useful`, `true-but-low-value`, `false-positive`, `uncertain`, plus important misses found manually.

## Alpha 1.6 — checking depth and honest coverage

Goal: make Ship Check materially more trustworthy before broadening it into database/runtime inspection. A user should be able to see **what was observed, what was assessed, what produced findings, what was consciously accepted, and what remains unverified or unassessed**.

The implementation target for this line is `0.0.0-alpha.6`. Once the matching desktop build is produced, Alpha 1.6 moves into the corpus/testing protocol in [`ALPHA_1_6_TESTING.md`](./ALPHA_1_6_TESTING.md); corpus calibration is testing work, not a reason to keep expanding the implementation surface.

### Implemented in the Alpha 1.6 line

- [x] Add an explicit assessment coverage model across: Secrets, Access Control, Configuration, Supply Chain, Cost, Code Security, Database and Runtime.
- [x] Add an `unverified` check state and first-class assessment gaps separate from findings.
- [x] Add first-class positive `observations` for inventory/verified-control evidence that should not be represented as findings or gaps.
- [x] Desktop and CLI say “No findings in assessed areas” rather than implying the repository is clean.
- [x] Desktop shows Partial / Not assessed coverage rather than a fake percentage.
- [x] Reclassify missing Next.js security-header evidence from a low-severity finding to an unverified configuration control.
- [x] Add bounded detection of dangerous execution primitives in server request handlers (`eval`/`Function`, unsafe raw SQL, shell execution).
- [x] Identify webhook receivers and record signature-verification evidence gaps without declaring an unverified handler vulnerable.
- [x] Trace Vercel cron declarations to Next.js handlers and record unverified scheduler-auth boundaries.
- [x] Carry unverified controls into RACK/assurance output as `uncertain` rather than `pass`.
- [x] Keep diagnostic history metadata-only while recording coverage/gap/observation/suppression counts, never observation paths/details, suppression rationales or source evidence.
- [x] Fix engine/CLI provenance so the alpha.5 code reports the matching version rather than the older alpha.4 constant.
- [x] Replace the narrow default credential-pattern scan with **Gitleaks 8.30.1**, pinned and bundled per desktop platform. Gitleaks scans a temporary mirror of Ship Check's tracked inventory and secret values never enter the canonical report.
- [x] Add **OSV-Scanner 2.5.1** as an explicitly opt-in networked dependency-vulnerability check. Only recognised dependency manifests/lockfiles are mirrored; the desktop makes the network boundary visible before the scan.
- [x] Verify third-party release artifacts against pinned SHA-256 digests during desktop packaging rather than downloading mutable `latest` binaries.
- [x] Trace up to two bounded local import levels for paid-service, webhook-verification and Vercel-cron controls, including common root/`src` `@/` aliases, while retaining the existing stable check IDs.
- [x] Add a first bounded Next.js/Vercel **server-surface inventory** covering API/request routes, Server Actions, webhook-like routes, Vercel cron declarations, auth/admin routes, paid-service request paths and database request paths. Discovery remains distinct from verification.
- [x] Compose Vercel cron **cadence × work** evidence so frequent model/paid-provider/database/fan-out work is prioritised over lightweight cadence alone, without inventing monetary cost estimates.
- [x] Add explicit per-check rule versions and tracked `.ship-check.json` suppressions bound to an exact finding ID + rule version + substantive rationale. Suppressed findings remain visible as accepted exceptions and old suppressions stop matching after a rule-version change.
- [x] Resolve repository-local `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths` aliases in bounded import tracing, including exact and single-wildcard mappings, nearest nested-config precedence and repository-boundary protection.
- [x] Upgrade `production.server-surface-inventory` to v2 with named module/inline Server Action enumeration plus explicit Auth.js/NextAuth, Supabase auth-callback, Clerk and Lucia request-surface detection; Auth.js callback configuration is inventoried separately without inferring authorisation or correctness.
- [x] Add an explicitly opt-in **pinned local Semgrep** adapter using only Ship Check-owned rules, SHA-256 ruleset provenance, disabled metrics/version checks, bounded temporary repository mirroring and no retained matched source. Alpha.6 deliberately does not bundle Semgrep itself; a compatible trusted local CLI is required.

### Alpha 1.6 testing gate

- [ ] Complete the representative Good Ship corpus pass and use it to tune the new checks and surface inventory for false positives/false negatives.
- [ ] Dogfood bundled Gitleaks on Windows and macOS, especially false positives, large repositories and proof that matched values never persist in diagnostics/reports.
- [ ] Dogfood opt-in OSV across representative package managers and compare Supply Chain coverage with the option off/on.
- [ ] Dogfood the pinned local Semgrep boundary with a compatible CLI and with Semgrep unavailable/unsupported; absence must remain an evidence gap, not a pass.

### Cross-product practice evidence already landed

- [x] Portable `practice.*` principle identifiers.
- [x] Map deterministic safety, dependency and cost checks onto bounded principle metadata.
- [x] Carry principle metadata through canonical check results and RACK gate output.
- [x] Never infer a principle-level pass merely because one narrow Ship Check rule produced no finding.
- [x] Contract test proving Ship Check concerns can use the same stable practice identifiers as RACK/Honey mappings.
- [ ] Run the first cross-repository RACK Honey + Ship Check test against a deliberately risky fixture and one real Good Ship repository.
- [ ] Add diff-aware **Lean Change** checks for minimum useful change, dependency additions, duplicate repair surface and behavioural changes without matching verification.

The shared principle vocabulary remains small and neutral. Honey is provenance/inspiration for several principles, not a runtime dependency. TOPO may later supply purpose-bound context, but context must never suppress deterministic evidence.

## Alpha 1.7 — Database Ready

Goal: add meaningful data-boundary assurance without turning Ship Check into a database administration tool.

### Landed

- [x] Postgres source evidence for migration/schema provenance, explicitly privileged connection names, destructive migration operations and existing bounded unsafe-SQL detection.
- [x] Supabase source enrichments for legacy service-role/current secret-key boundaries, recognised public client keys, versioned RLS/policy evidence and Supabase migration/configuration signals.
- [x] Neon source evidence for HTTP helper, `Pool` and explicit `Client` lifecycle/cleanup patterns without imposing a blanket pooling rule.
- [x] Optional local read-only Postgres metadata inspector with explicit user consent, fixed system-catalog queries, no application-row reads, rollback/cleanup and bounded table inventory.
- [x] Database connection URLs stay out of command arguments, reports and diagnostics; desktop credentials are session-only and passed to the bundled engine through a child-process environment variable.
- [x] Record whether the inspection credential is superuser / `BYPASSRLS` without retaining the role name; elevated inspector credentials remain an evidence gap rather than a silent pass.
- [x] Treat truncated metadata inventory as incomplete evidence so a bounded scan cannot become false reassurance.
- [x] Supabase live metadata checks correlate `anon` / `authenticated` table grants with live RLS state and can resolve the matching source RLS uncertainty when the complete bounded evidence establishes the same control.
- [x] Keep source and live database evidence distinct in report provenance; raw database metadata snapshots are not persisted wholesale into the canonical report.

### Still to do

- [ ] Interpret or test Supabase policy expressions beyond the current “RLS enabled + grant boundary” evidence.
- [ ] Add Neon-specific branching/deployment expectations and stronger provider-specific live assurance where they can be established defensibly.
- [ ] Broaden generic Postgres role/grant evidence without turning the inspector into an administration or arbitrary-query surface.
- [ ] Dogfood the live inspector across representative Supabase, Neon and plain Postgres projects using dedicated least-privilege credentials.

See [`DATABASE_INSPECTION.md`](./DATABASE_INSPECTION.md) for the current trust boundary and limitations.

## Alpha 1.8 — opt-in runtime verification

Goal: verify controls that source inspection cannot establish, while keeping runtime activity bounded and non-destructive. This line also proves that Ship Check can work from project evidence other than a repository.

### Landed

- [x] Explicit user-provided deployment URL with a visible runtime evidence boundary in CLI and desktop.
- [x] Bounded non-mutating HTTP acquisition with manual redirect following, selected browser security headers, visible cookie flags and synthetic-origin CORS evidence; response bodies and cookie values are not retained.
- [x] Clearly label runtime evidence with deployment source/provenance and acquisition time.
- [x] Let runtime verified-control observations resolve an `unverified` source control only through an explicit matching check ID.
- [x] Preserve resolved source questions as evidence records rather than silently deleting their history; desktop explains when another evidence source established the control.
- [x] Allow a **URL-only project check** that marks Source, Database and other unavailable evidence as not assessed.
- [x] Allow source + deployment + database evidence to be combined in the same canonical report without losing per-source provenance.

### Still to do

- [ ] Add carefully bounded error-disclosure evidence where it can be checked without retaining response bodies or sensitive content.
- [ ] Add declared-route smoke checks that do not mutate data or attempt exploit payloads.
- [ ] Extend source/runtime correlation beyond the first explicit security-header relationship only where the evidence really verifies the same control.

## Alpha 2 — pilot hardening and stronger packs

- [ ] Mature the Gitleaks / OSV / pinned Semgrep adapters based on corpus evidence.
- [ ] Safe dynamic/local smoke-test adapters where they add evidence beyond repository inspection.
- [x] Local desktop regression comparison for comparable scans: newly introduced, persistent and resolved active findings/gaps are derived from opaque local identities, without retaining raw finding/gap IDs.
- [ ] Optional focused one-finding-at-a-time review mode for larger scans.
- [x] Local scan history remains metadata-only and capped; source contents, raw finding/gap IDs and local paths are not retained, while source/project and finding/gap identities are stored as SHA-256 digests for comparison.
- [x] Stable check/ruleset provenance suitable for team/pilot use: every new report records a `check-ruleset-v1` SHA-256 fingerprint over selected check IDs, versions and packs; engine/source/scanner provenance remain separate and desktop/CI comparisons prefer the fingerprint with legacy fallback.

## Alpha 2.1 — project evidence source abstraction

Goal: stop treating `repository` as the only useful unit of inspection without weakening the canonical engine or evidence model.

### Landed

- [x] Versioned `ProjectEvidenceSource` / `ProjectSnapshot` contracts with explicit source type, provider, acquisition, execution location and evidence capabilities.
- [x] Refactor local-folder and transient-GitHub inputs behind the same source/provenance boundary without changing the canonical checking engine.
- [x] Add bounded **project ZIP** snapshots with traversal protection, symlink/special-entry rejection, expansion/file limits, ephemeral extraction and explicit uploaded-snapshot provenance.
- [x] Record current local, transient-GitHub, uploaded, runtime and database evidence acquisition/provenance in canonical reports.
- [x] Let checks declare evidence requirements/capabilities so unavailable evidence becomes `not assessed` rather than a false pass.
- [x] Reuse the same canonical engine across CLI and desktop acquisition routes rather than introducing platform-specific scanner implementations.

### Still to do

- [ ] Add bounded tar/archive formats only if real hosted-builder/export journeys require them; ZIP is the current first-class export path.
- [x] Extend execution provenance to CI-provided source: the GitHub Action records `acquisition: ci`, `executionLocation: ci-runner` and `ci-context`; managed-hosted provenance remains future work.
- [x] Define bounded source fingerprinting for comparable history without retaining source content: `source-inventory-v1` records only an aggregate SHA-256 digest plus completeness/count metadata, and partial fingerprints never claim identical snapshots.
- [ ] Add explicit parity tests across future local, CI and managed execution locations rather than assuming equivalent results.

## Alpha 2.2 — cloud control plane, history and CI

Goal: create useful Cloud Ship Check without requiring source code to enter Ship Check infrastructure.

- [x] Portable metadata-only project-history event contract with opaque project/scan identities, engine/ruleset/source provenance, aggregate counts/coverage and optional scoped change counts; available via CLI `--format metadata` and the GitHub Action sidecar without network sync.
- [x] Portable source-free project timeline reducer/CLI over metadata events: stable ordering/deduplication, provenance continuity and latest aggregate attention, while transition semantics remain limited to explicit comparison blocks.

- [x] Hosted metadata-history persistence foundation: opaque account identity, account-scoped project identity, Postgres/Neon-compatible schema, idempotent metadata ingestion, portable timeline export, explicit retention and hard-delete semantics. No hosted infrastructure or auth/API is implied.
- [x] Framework-neutral authenticated account/project service boundary over the metadata store: verified auth-subject hashes only, connect/sync/export/rename/retention/delete semantics and bounded domain errors; no HTTP/auth-provider assumptions.
- [ ] Hosted auth/session verification + HTTP account/project API routes using the service boundary above without widening the metadata boundary.
- [ ] Optional report sync from local CLI/desktop with user-selectable data boundary: metadata only, structured findings, or bounded evidence.
- [ ] Hosted/persistent project timeline UI showing explicit newly introduced, persistent, reactivated, accepted and no-longer-active findings/gaps across stored comparable scans; the portable metadata reducer foundation is now landed.
- [ ] GitHub App for repository/project association, webhook triggers and PR/release status surfaces.
- [x] Ship Check GitHub Action using the canonical engine inside the repository owner's CI runner, with source remaining in the caller checkout, explicit CI provenance, bounded step-summary metadata and a portable JSON report retained in the caller workspace.
- [x] PR change summaries in the GitHub Action compare the exact base SHA with the current source using the same engine/rules, distinguishing new/persistent/reactivated findings, newly accepted exceptions, no-longer-active findings/gaps, still-unverified controls and newly observed inventory surfaces without treating disappearance as proof of remediation.
- [ ] Team review state for accepted exceptions, verification notes and evidence history without turning Ship Check into a generic issue tracker.
- [x] Keep a source-free metadata-only assurance export as the narrowest future cloud sync mode; the history envelope omits raw project locators and all finding/evidence detail, while OOS remains a separate organisational bridge.
- [x] Define persistence-layer retention/export/deletion semantics: explicit 30/90/180/365-day or until-deleted project policy, recalculated expiry, source-free timeline export, and project/account hard deletion with cascade receipts.
- [ ] Expose the landed rename/retention/export/deletion service controls through authenticated hosted HTTP/product flows and verify them end-to-end before private-project pilot use.

Suggested cloud sync levels:

1. **Local only** — nothing is sent to Ship Check Cloud.
2. **Assurance metadata** — project/commit identity, engine/ruleset provenance, coverage and counts.
3. **Structured findings** — findings/gaps/observations without raw source content or secret values.
4. **Bounded evidence** — selected evidence excerpts where the user or organisation permits it.
5. **Managed scan** — source is temporarily available to a Ship Check ephemeral runner under the managed-execution boundary below.

## Alpha 2.3 — managed ephemeral runner

Goal: provide the convenience of zero-install cloud scanning while preserving a strong and inspectable trust boundary.

- [ ] Per-scan isolated worker with ephemeral filesystem and automatic workspace destruction after report generation.
- [ ] Short-lived, read-only source-provider credentials; no credentials embedded into cloned repository URLs.
- [ ] Default-deny network egress during source inspection, with explicit bounded exceptions for checks such as OSV where the user enables them.
- [ ] Ensure source contents and detected secrets never enter application logs, job metadata or persistent report storage.
- [ ] Encrypt transient worker storage and inter-service traffic; document threat boundaries and operational responsibilities.
- [ ] Add scan time/resource limits and intelligent change-based execution to control cost without silently reducing stated coverage.
- [ ] Record runner image, engine version, ruleset versions and acquisition provenance for reproducibility.
- [ ] Provide a self-hosted/organisation runner path later if pilot users require source to remain inside their own infrastructure.

## Alpha 2.4 — hosted-builder and non-Git projects

Goal: let people use Ship Check even when their normal development surface is not a local folder or Git repository.

### Landed foundations

- [x] A hosted-builder export can already enter Ship Check as a bounded Project ZIP rather than being forced through Git.
- [x] The Lovable reference journey has usable fallback routes today: connected GitHub source, exported project ZIP and URL-only deployment evidence; direct provider source access remains conditional on a supported read-only integration.
- [x] Desktop acquisition UX is expressed as user intent — **Folder, GitHub, Project ZIP, Live site** — rather than requiring every user to understand Git internals.
- [x] Local multi-source projects can combine source, deployment and database evidence and resolve explicitly matched uncertainties without losing provenance.

### Still to do

- [ ] Add a provider-adapter contract for direct hosted-builder integrations rather than platform-specific scanner forks.
- [ ] Do not assume private/platform APIs exist. Each future adapter must advertise its actual evidence capabilities and degrade honestly when only export/runtime evidence is available.
- [ ] Explore Replit, Bolt, v0 and similar hosted-builder adapters using the same contract after the Lovable journey is validated.
- [ ] Show direct-provider acquisition routes in plain language when connectors exist, for example `Lovable → provider source`; current GitHub/export/runtime routes already retain their own provenance.
- [ ] Carry the same intent-led project-connect UX into the future cloud control plane.

## Alpha 2.5 — multi-source assurance

Goal: move from repeated scans towards a durable, evidence-backed assurance record for a project.

### Landed foundations

- [x] Correlate bounded source ↔ runtime and source ↔ database controls where an explicit `resolvesCheckIds` relationship states that the evidence verifies the same question.
- [x] Allow stronger evidence to resolve an earlier `unverified` state while preserving the resolved question as a first-class report record.
- [x] RACK/OOS gate regression tests ensure resolved uncertainty disappears from the active gap set without hiding separate active findings or missing evidence.

### Still to do

- [x] Surface first local project-level attention across comparable desktop scans: new, persistent and resolved active findings/gaps, plus source snapshot changed/unchanged/uncertain state.
- [ ] Add platform-evidence correlation and more cross-source relationships only where they are defensible.
- [ ] Keep contradictory evidence visible rather than automatically choosing one source as truth.
- [ ] Surface project-level attention across persisted history in product UI: the portable reducer now exposes latest aggregate attention and preserves explicit change blocks, but storage/UI and richer linked-history presentation remain future work.
- [ ] Add scheduled and event-triggered checks with change-aware scope rather than blindly rescanning all evidence sources on every event.
- [ ] Provide team/portfolio views across projects using counts, change and coverage rather than an invented assurance score.

## Alpha 3 — ecosystem bridges

- [x] First RACK Verification Plan process/JSON result adapter with `pass | fail | uncertain | incomplete` outcomes.
- [x] Ship Check trusted verifier IDs registered in RACK as planned providers.
- [ ] RACK desktop executor for Ship Check trusted verifier IDs.
- [ ] RACK repair-loop UI: run → evidence → repair prompt → rerun.
- [x] TOPO purpose-bound context-request adapter matching the current OOS context-request shape; context remains separate from scan evidence.
- [x] Metadata-only Organisational OS technical-assurance summary contract.
- [ ] End-to-end TOPO authorisation/review UX from the Ship Check desktop.
- [ ] Let RACK request Ship Check execution through an explicit local, CI or managed-runner policy rather than assuming one execution location.
- [ ] Let wider organisational assurance consume cloud/history metadata without requiring access to project source or bounded evidence unless separately authorised.

## Later packs

Responsible Data, AI Build, Accessible Build and Healthy Codebase remain candidate packs. They should only ship once we have reliable checks and clear human-review boundaries rather than broad LLM opinion.