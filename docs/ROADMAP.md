# Roadmap

Ship Check is an assurance tool, not a clean-bill-of-health generator. The roadmap therefore prioritises **defensible evidence depth** over simply adding more UI or more regex rules.

A scan should distinguish three things clearly:

1. **Finding** — repository evidence supports a concrete concern.
2. **Verified/assessed evidence** — a bounded deterministic check completed without finding that concern.
3. **Unverified** — Ship Check found a relevant control or boundary but cannot establish it from the evidence available.

“No findings” must never imply that unassessed areas are safe.

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

Goal: make Ship Check materially more trustworthy before broadening it into database/runtime inspection. A user should be able to see **what was assessed, what produced findings, and what remains unverified or unassessed**.

### Implemented in the Alpha 1.6 line

- [x] Add an explicit assessment coverage model across: Secrets, Access Control, Configuration, Supply Chain, Cost, Code Security, Database and Runtime.
- [x] Add an `unverified` check state and first-class assessment gaps separate from findings.
- [x] Desktop and CLI say “No findings in assessed areas” rather than implying the repository is clean.
- [x] Desktop shows Partial / Not assessed coverage rather than a fake percentage.
- [x] Reclassify missing Next.js security-header evidence from a low-severity finding to an unverified configuration control.
- [x] Add bounded detection of dangerous execution primitives in server request handlers (`eval`/`Function`, unsafe raw SQL, shell execution).
- [x] Identify webhook receivers and record signature-verification evidence gaps without declaring an unverified handler vulnerable.
- [x] Trace Vercel cron declarations to Next.js handlers and record unverified scheduler-auth boundaries.
- [x] Carry unverified controls into RACK/assurance output as `uncertain` rather than `pass`.
- [x] Keep diagnostic history metadata-only while recording coverage/gap counts.
- [x] Fix engine/CLI provenance so the alpha.5 code reports the matching version rather than the older alpha.4 constant.

### Next depth work inside 1.6

- [ ] Complete the representative Good Ship corpus pass and use it to tune the new checks for false positives/false negatives.
- [ ] Add **Gitleaks** as the mature secret-scanning adapter rather than expanding the home-grown credential regex catalogue indefinitely.
- [ ] Add **OSV-Scanner** dependency vulnerability evidence with an explicit network/tool boundary and provenance.
- [ ] Add a small **pinned local Semgrep ruleset** with provenance. Do not default to remote/`--config=auto` rules because Ship Check should know exactly which rules ran and whether source/inventory metadata crosses a network boundary.
- [ ] Add check metadata/versioning and explicit suppression with a required rationale.
- [ ] Add a richer Next.js/Vercel server-surface inventory: API routes, Server Actions, webhooks, cron handlers, auth callbacks, admin routes, paid-service boundaries and database boundaries.
- [ ] Add imported-helper tracing for common auth, webhook and abuse-control patterns so evidence does not have to live in one file.
- [ ] Broaden cost analysis from cadence alone towards **cadence × work** evidence (paid providers, fan-out, database/model work) without inventing precise cost estimates.

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