# Roadmap

## Alpha 0 — checking contract and CLI

- [x] Versioned finding/report schemas.
- [x] Local repository inventory with Git-aware tracked-file scope.
- [x] Secure Build starter checks: tracked env files, credential patterns, paid API endpoints without obvious controls, wildcard CORS and public secret-like env names.
- [x] Production Ready starter checks: dependency lock discipline and Next.js security-header evidence.
- [x] Plain and JSON CLI output.
- [x] Optional severity exit gate for CI/RACK use.
- [x] Risky/safe regression fixtures.
- [ ] Run the checks across a representative Good Ship app corpus and record false positives/false negatives.
- [ ] Add check metadata/versioning and suppression with explicit rationale.

## Alpha 1 — useful review surface

- [ ] Tauri + React desktop shell following RACK/TOPO conventions.
- [ ] Folder selection, scan progress and summary.
- [ ] One finding at a time: evidence, why it matters, fix, copy repair prompt, re-check.
- [ ] Local scan history with no source-content retention by default.
- [ ] Windows test installer automatically built from coherent changes on `main`.
- [ ] Manual unsigned Windows/Linux alpha pre-release with explicit confirmation.

## Alpha 2 — stronger deterministic packs

- [ ] Semgrep adapter with pinned rulesets and provenance.
- [ ] Gitleaks adapter for mature secret scanning.
- [ ] dependency audit adapters (OSV/npm/pnpm) with explicit network boundary.
- [ ] framework/database checks for Next.js, Vercel, Neon and Supabase patterns.
- [ ] abuse-cost checks for AI/email/scraping endpoints.
- [ ] safe dynamic smoke tests against a local target.

## Alpha 3 — ecosystem bridges

- [ ] RACK Verification Plan adapter over the JSON/process contract.
- [ ] RACK repair-loop UI: run → evidence → repair prompt → rerun.
- [ ] Optional purpose-bound TOPO context packet, visually separate from scan evidence.
- [ ] Organisational OS assurance summary contract.

## Later packs

Responsible Data, AI Build, Accessible Build and Healthy Codebase remain candidate packs. They should only ship once we have reliable checks and clear human-review boundaries rather than broad LLM opinion.
