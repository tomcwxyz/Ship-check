# Roadmap

Ship Check is an assurance tool, not a clean-bill-of-health generator. The roadmap therefore prioritises **defensible evidence depth** over simply adding more UI or more regex rules.

A scan should distinguish four things clearly:

1. **Finding** — repository evidence supports a concrete concern.
2. **Observed** — useful repository-visible architecture/evidence was discovered; this is neither a concern nor proof that the surface is safe.
3. **Unverified** — Ship Check found a relevant control or boundary but cannot establish it from the evidence available.
4. **Coverage** — the bounded areas Ship Check did or did not assess.

“No findings” must never imply that unassessed areas are safe, and “observed” must never be treated as “verified” unless a specific check establishes the control. Explicitly suppressed findings remain visible as accepted exceptions rather than disappearing from the evidence record.

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

### Next depth work inside 1.6

- [ ] Complete the representative Good Ship corpus pass and use it to tune the new checks and surface inventory for false positives/false negatives.
- [ ] Dogfood bundled Gitleaks on Windows and macOS, especially false positives, large repositories and proof that matched values never persist in diagnostics/reports.
- [ ] Dogfood opt-in OSV across representative package managers and compare Supply Chain coverage with the option off/on.
- [ ] Add a small **pinned local Semgrep ruleset** with provenance once its desktop packaging/runtime boundary is reproducible. Do not default to remote/`--config=auto` rules.
- [ ] Extend server-surface inventory to framework-specific auth callbacks and richer Server Action boundaries where corpus evidence supports reliable detection.
- [ ] Extend imported-helper tracing from the common `@/`/`~/` convention to explicit `tsconfig`/`jsconfig` path aliases where corpus evidence justifies it.

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

- [ ] Postgres Core source checks: migrations/schema provenance, privileged connection use, unsafe SQL construction, destructive operations and serverless connection/pooling patterns.
- [ ] Supabase enrichments: service-role boundaries, client/server credential separation, RLS evidence and migration/configuration patterns.
- [ ] Neon enrichments: privileged connection boundaries, branching/migration expectations and serverless connection configuration.
- [ ] Optional separate read-only database inspector with explicit user consent and least-privilege credentials.
- [ ] Keep repository evidence and live database evidence distinct in reports.

## Alpha 1.8 — opt-in runtime verification

Goal: verify controls that source inspection cannot establish, while keeping runtime activity bounded and non-destructive.

- [ ] Explicit user-provided deployment URL and consent boundary.
- [ ] Safe HTTP checks for HTTPS redirects, representative response security headers, cookie flags, basic CORS behaviour and obvious error disclosure.
- [ ] Declared-route smoke checks that do not mutate data or attempt exploit payloads.
- [ ] Clearly label runtime evidence with target URL, time and check provenance.
- [ ] Let runtime evidence resolve an `unverified` repository control where the evidence actually matches the same boundary.

## Alpha 2 — pilot hardening and stronger packs

- [ ] Mature the Gitleaks / OSV / pinned Semgrep adapters based on corpus evidence.
- [ ] Safe dynamic/local smoke-test adapters where they add evidence beyond repository inspection.
- [ ] Regression comparison: newly introduced, resolved and persistent findings/gaps across comparable scans.
- [ ] Optional focused one-finding-at-a-time review mode for larger scans.
- [ ] Local scan history without source-content retention by default.
- [ ] Stable check/ruleset provenance suitable for team/pilot use.

## Alpha 3 — ecosystem bridges

- [x] First RACK Verification Plan process/JSON result adapter with `pass | fail | uncertain | incomplete` outcomes.
- [x] Ship Check trusted verifier IDs registered in RACK as planned providers.
- [ ] RACK desktop executor for Ship Check trusted verifier IDs.
- [ ] RACK repair-loop UI: run → evidence → repair prompt → rerun.
- [x] TOPO purpose-bound context-request adapter matching the current OOS context-request shape; context remains separate from scan evidence.
- [x] Metadata-only Organisational OS technical-assurance summary contract.
- [ ] End-to-end TOPO authorisation/review UX from the Ship Check desktop.

## Later packs

Responsible Data, AI Build, Accessible Build and Healthy Codebase remain candidate packs. They should only ship once we have reliable checks and clear human-review boundaries rather than broad LLM opinion.
