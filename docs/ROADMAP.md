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
- [ ] Run the checks across a representative Good Ship app corpus and record false positives/false negatives.
- [ ] Add check metadata/versioning and suppression with explicit rationale.

## Alpha 1 — useful review surface

- [x] Dependency-light Tauri desktop shell following the RACK/TOPO local-first boundary without duplicating checker logic.
- [x] Native folder selection, local-engine status, scan progress and summary.
- [x] Finding review with severity/pack context, evidence, why it matters, fix, verification guidance, copy repair prompt and re-check.
- [ ] Optional focused one-finding-at-a-time review mode for larger scans.
- [ ] Local scan history with no source-content retention by default.
- [ ] Windows test installer automatically built from coherent changes on `main`.
- [ ] Manual unsigned Windows/Linux desktop alpha pre-release with explicit confirmation and the matching engine bundled as a local resource.

## Alpha 2 — stronger deterministic packs

- [ ] Semgrep adapter with pinned rulesets and provenance.
- [ ] Gitleaks adapter for mature secret scanning.
- [ ] dependency audit adapters (OSV/npm/pnpm) with explicit network boundary.
- [ ] framework/database checks for Next.js, Vercel, Neon and Supabase patterns.
- [x] First Cost Aware checks for high-frequency Vercel cron jobs and frequent network polling.
- [ ] Broaden abuse-cost checks for AI/email/scraping endpoints only after corpus evaluation.
- [ ] safe dynamic smoke tests against a local target.

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
