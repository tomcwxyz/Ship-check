# Desktop alpha.8 testing protocol

`0.0.0-alpha.8` is the current desktop calibration build. It keeps the expanded evidence model, adds the broader alpha.8 repository checks, and tests the clearer default review flow, distinct Finding/Observed/Unverified/Coverage language, and the new Ship Check inspection-instrument identity.

The work below is **dogfood/testing** for alpha.8. It should tune evidence quality, language and the packaged desktop experience before Database Ready work begins.

## What alpha.8 is testing

A useful scan should make four different evidence states understandable:

1. **Finding** — repository evidence supports a concrete concern.
2. **Observed** — Ship Check discovered a useful application surface or control; this is not a safety claim.
3. **Unverified** — a relevant boundary exists but repository evidence is not enough to establish it.
4. **Coverage** — the bounded areas Ship Check did or did not assess.

The test is not whether Ship Check finds lots of things. It is whether its claims are useful, defensible and appropriately bounded.

## Test corpus

Run the desktop build against the current Good Ship corpus:

| Repository | Main test focus |
| --- | --- |
| `tomcwxyz/attention-agent-pilot` | scheduled/agent work, paid APIs, Neon/database surfaces, auth and server routes |
| `tomcwxyz/glade` | paid endpoints, auth, Stripe/Resend, rate limiting and control recognition |
| `tomcwxyz/Event` | quieter modern repo; false positives and whether a low-finding scan remains informative |
| `tomcwxyz/Trader` | scheduled/data work, database boundaries and Cost Aware calibration |
| `tomcwxyz/the-list` | mature Supabase/Resend/Vercel patterns and legacy-repo noise |

Add one small non-Next repository if these five are too homogeneous.

## Pass A — default local scan

For each repository:

- run all three standard packs with OSV and Semgrep **off**;
- confirm repository inventory is `git-tracked` for Git repositories;
- review Findings, Observed, Unverified and Coverage rather than only the finding count;
- confirm zero-finding scans say **No findings in assessed areas** and do not imply the repository is safe;
- record any check error, unexpectedly slow check or missing application surface.

Gitleaks is part of the normal Secure Build path when its bundled binary is available. Check especially that secret values or matched source never appear in diagnostics or the canonical report.

## Pass B — pinned local Semgrep

Enable **Run pinned local Semgrep rules** with Secure Build selected.

The alpha ruleset is deliberately tiny. It currently looks only for explicit TLS certificate-verification bypass and JWT expiry-verification bypass patterns. Absence of a match is not broad code-security verification.

Confirm:

- the scan stays local;
- the UI clearly describes Semgrep as optional and local;
- an unavailable or unsupported Semgrep CLI becomes an `unverified` evidence gap rather than a pass;
- a successful run records ruleset/check provenance;
- any match includes file/line and repair guidance but never matched source text;
- rerunning after a repair resolves the finding cleanly.

alpha.8 does **not** bundle Semgrep itself. Use a trusted Semgrep `1.176.x` installation or `SHIP_CHECK_SEMGREP_PATH`.

CLI equivalent:

```bash
ship-check scan . --pack secure-build --local-semgrep-scan
```

## Pass C — opt-in OSV

Enable **OSV dependency check** with Production Ready selected.

Confirm the UI makes the network boundary clear before the scan. Application source must not be copied to the OSV mirror; only recognised dependency manifests/lockfiles are eligible.

Compare Supply Chain coverage with OSV off and on, and test at least the package-manager shapes represented by the corpus.

CLI equivalent:

```bash
ship-check scan . --pack production-ready --networked-dependency-scan
```

## Pass D — platform boundary

At minimum:

- Windows x64: local folder and GitHub repository scans, bundled Gitleaks, opt-in OSV, diagnostics copy/clear and rerun;
- macOS Apple Silicon: local folder and GitHub repository scans, including one private repository using existing Git credentials, bundled Gitleaks and opt-in OSV.

Operating-system signing warnings are expected for this alpha. Signing/notarisation remains a pilot-distribution task rather than an alpha.8 evidence-quality blocker.

## What to record

For each confirmed finding use one label:

- `useful`
- `true-but-low-value`
- `false-positive`
- `uncertain`

For each unverified control use one label:

- `useful-to-verify`
- `already-protected-elsewhere`
- `heuristic-missed-local-evidence`
- `not-useful`

Also record important manual misses. False negatives matter at least as much as noisy findings.

For each repository capture the metadata-only **Copy diagnostics** receipt after the final run. Do not copy source/evidence into a central corpus log unless needed to diagnose a specific issue.

## Cross-product check

Before declaring alpha.8 calibrated, run the existing RACK/Ship Check practice-evidence path against:

1. a deliberately risky fixture; and
2. one real Good Ship repository.

The result should preserve `pass | fail | uncertain | incomplete` semantics and must not turn a narrow Ship Check non-finding into a broad practice-level pass.

## Exit criteria for alpha.8 testing

alpha.8 is ready to freeze and move to Database Ready when:

- the representative corpus has been scanned with the default alpha.8 build;
- recurring high/medium findings have been classified and obvious false positives tuned;
- obvious manually discovered misses have been reviewed for whether a defensible deterministic check is possible;
- Gitleaks has been exercised on Windows and macOS without secret/match persistence;
- opt-in OSV has been exercised on representative package managers;
- the local Semgrep boundary has been exercised at least once with a compatible CLI and once without one;
- no recurring scan error or misleading coverage state remains unresolved;
- the first RACK + Ship Check cross-product run has been completed.

Do not delay the next alpha for broad new feature ideas. New packs remain later work unless the corpus reveals a repeated, high-value risk with a clear evidence boundary.
