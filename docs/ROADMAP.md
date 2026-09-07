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
- [ ] Run the checks across a representative Good Ship app corpus and record false positives/false negatives.
- [ ] Add check metadata/versioning and suppression with explicit rationale.

## Alpha 1 — useful standalone repository review

- [x] Dependency-light Tauri desktop shell following the RACK/TOPO local-first boundary without duplicating checker logic.
- [x] Native folder selection, local-engine status, scan progress and summary.
- [x] GitHub repository mode with shallow temporary checkout, optional branch/tag and cleanup after the scan.
- [x] Finding review with severity/pack context, evidence, why it matters, fix, verification guidance, copy repair prompt and re-check.
- [ ] Corpus-led tuning of the three current packs before broadening the rule catalogue.
- [ ] Optional focused one-finding-at-a-time review mode for larger scans.
- [ ] Local scan history with no source-content retention by default.
- [ ] Compare against the last clean check so regressions and newly introduced findings are obvious.
- [x] Manual Windows x64/Linux x64/macOS Apple Silicon desktop alpha pre-release workflow with explicit confirmation and matching bundled engine.
- [ ] Dogfood the macOS alpha, including local-folder and GitHub/private-repository flows.
- [ ] Proper Windows signing and macOS Developer ID signing/notarisation for pilot distribution.

### Alpha 1.6 — first practice-evidence loop

Goal: prove that declared working practice and repository evidence can meet on the same stable principle identifiers without making Ship Check dependent on RACK, Honey or TOPO.

- [x] Introduce portable `practice.*` principle identifiers.
- [x] Map the current deterministic safety, dependency and cost checks onto bounded principle metadata.
- [x] Carry principle metadata through canonical check results.
- [x] Add `practiceEvidence` to the existing RACK gate result without inventing a new runtime dependency.
- [x] Do not infer a principle-level pass merely because a narrow Ship Check rule produced no finding.
- [x] Add a contract test proving a deterministic Ship Check concern can return the same `practice.preserve-safety` identifier used by RACK's Honey practice mapping.
- [ ] Run the first cross-repository test with RACK's Honey coding set-up and Ship Check's RACK output against a deliberately risky fixture and one real Good Ship repository.
- [ ] Record what was useful, noisy or missing before broadening the principle catalogue.
- [ ] Add diff-aware **Lean Change** checks for minimum useful change, dependency additions, duplicate repair surface and behavioural changes without matching verification.

The first shared principle vocabulary is deliberately small and neutral: Honey is provenance/inspiration for several principles, not a required runtime component. TOPO may later provide purpose-bound context that helps interpret evidence, but it must not alter or suppress deterministic findings.

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
