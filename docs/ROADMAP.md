# Roadmap

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

## Alpha 1.5 — evidence quality and dogfood

Alpha 1.5 is the current testing line. Keep finding behaviour stable while the Good Ship corpus is reviewed so changes are driven by evidence rather than by a larger speculative rule catalogue.

- [ ] Run the checks across the representative Good Ship app corpus in `docs/DOGFOOD.md` and record false positives/false negatives.
- [ ] Classify surfaced findings as `useful`, `true-but-low-value`, `false-positive` or `uncertain`.
- [ ] Record important manually discovered issues that Ship Check missed.
- [ ] Tune severity, confidence and remediation only where corpus evidence supports the change.
- [ ] Test repair prompts and re-check behaviour on useful findings where practical.
- [x] Privacy-minimised local diagnostics with source label, inventory provenance, timings and check outcomes.
- [x] Windows Git inventory fixes and fail-closed behaviour for invalid/empty repository inventories.

## Alpha 1.6 — regression-aware review

Alpha 1.6 should make repeated Ship Checks more useful without broadening the deterministic rule catalogue during 1.5 testing.

- [x] Prepare a privacy-preserving finding fingerprint/delta contract on an isolated development branch.
- [x] Prepare comparable-scan selection so local history can distinguish new, resolved and unchanged findings without retaining evidence or source contents.
- [ ] Surface **new since previous comparable check**, **resolved**, and **unchanged** counts in the desktop review flow.
- [ ] Track the most recent clean comparable scan and make regressions since that clean baseline explicit.
- [ ] Add focused one-finding-at-a-time review mode for larger scans.
- [ ] Add check metadata/versioning so a rule change can be distinguished from a product regression.
- [ ] Add finding suppression with an explicit rationale, scope and expiry/review boundary; never silently ignore a finding.
- [ ] Keep local history bounded and source-content-free by default.
- [ ] Decide, from 1.5 dogfood evidence, whether automatic Windows test installers should be produced from coherent `main` changes.

See `docs/ALPHA_1_6.md` for the working contract and merge boundary while 1.5 testing continues.

## Alpha 2 — stronger deterministic assurance

### Database Ready — Postgres first

Database checks become the first major Alpha 2 expansion because they extend Ship Check from repository evidence towards the deployed system boundary while remaining deterministic and inspectable.

- [ ] Add `Database Ready` as a first-class pack with **Postgres Core** rules and provider enrichments rather than separate duplicated Supabase/Neon implementations.
- [ ] Add repository-only Postgres checks for migrations, schema/configuration evidence, unsafe grants, risky `SECURITY DEFINER` patterns, destructive migrations, missing migration discipline and obvious connection/runtime hazards.
- [ ] Add Supabase enrichment for exposed schemas, RLS/policy evidence, `anon`/`authenticated` grants, service-role usage and database-function exposure.
- [ ] Add Neon enrichment for pooled-vs-direct runtime connection evidence, migration/runtime URL separation and production/preview branch configuration where repository-visible.
- [ ] Add a separate optional read-only database inspector with strict statement/query timeouts, metadata/catalogue queries only, no DDL, no table-content export and no retained credentials.
- [ ] Use connected Postgres inspection to check actual RLS state, roles/grants, `SECURITY DEFINER`, indexes, primary/foreign keys and operational catalogue evidence where defensible.
- [ ] Keep repository-only Database Ready fully usable without a network connection or provider account.
- [ ] Add deliberately risky/safe Postgres, Supabase and Neon fixtures before enabling database findings by default.

See `docs/DATABASE_READY.md` for the proposed architecture and evidence boundary.

### Existing deterministic expansion

- [ ] Semgrep adapter with pinned rulesets and provenance.
- [ ] Gitleaks adapter for mature secret scanning.
- [ ] Dependency audit adapters (OSV/npm/pnpm) with explicit network boundary.
- [ ] Framework checks for Next.js and Vercel patterns supported by corpus evidence.
- [x] First Cost Aware checks for high-frequency Vercel cron jobs and frequent network polling.
- [ ] Broaden abuse-cost checks for AI/email/scraping endpoints only after corpus evaluation.
- [ ] Safe dynamic smoke tests against a local target.

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
