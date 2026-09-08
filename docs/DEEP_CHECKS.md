# Deep checks

Alpha 1.6 begins using mature external scanners where they provide better deterministic evidence than maintaining a growing set of Ship Check regexes.

The adapters remain part of Ship Check's evidence contract: third-party output is translated into bounded findings, source/secrets are minimised, scanner versions are pinned where reproducible desktop release assets exist, and a missing scanner is never silently treated as a pass.

## Gitleaks — local secret scanning

Desktop alpha builds bundle **Gitleaks 8.30.1**.

Ship Check does **not** point Gitleaks directly at an arbitrary local working tree. That would allow untracked/local-only files to leak into a report that otherwise claims Git-tracked provenance.

Instead Ship Check:

1. starts from its existing Git-aware repository inventory;
2. creates a temporary local mirror containing regular files from that inventory;
3. skips symlinks and individual files over the current 5 MB alpha limit;
4. runs Gitleaks `dir` against the temporary mirror with full report redaction;
5. copies only rule ID, description, file, line and a bounded fingerprint into Ship Check findings;
6. never copies Gitleaks `Secret`, `Match` or source-line contents into the canonical report;
7. removes the temporary mirror/report after the check.

If Gitleaks is unavailable, Ship Check runs its narrow built-in fallback detector and records **Deep secret scanning is unavailable** as an unverified Secrets gap. A fallback scan must not be presented as equivalent mature coverage.

Developer/CLI users may supply a trusted binary with `SHIP_CHECK_GITLEAKS_PATH`.

## OSV-Scanner — opt-in dependency vulnerability evidence

Desktop alpha builds bundle **OSV-Scanner 2.5.1**, but the check is **off by default**.

OSV vulnerability matching may use network services. Enabling the desktop control or CLI `--networked-dependency-scan` is therefore an explicit change to the scan boundary.

Ship Check minimises that boundary by creating a separate temporary mirror containing recognised dependency manifests and lockfiles only. Application source files are not copied into the OSV mirror.

Depending on the ecosystem and OSV behaviour, dependency package identifiers and versions may be sent across the network to retrieve known vulnerability data. The resulting Ship Check finding contains package/version/ecosystem, advisory identifiers and the local manifest path; it does not contain application source.

If the user requests OSV but the scanner is unavailable, Ship Check records an unverified Supply Chain gap rather than passing the area.

Developer/CLI users may supply a trusted binary with `SHIP_CHECK_OSV_PATH`.

## Semgrep CE — opt-in pinned local rules

Alpha.6 adds an explicitly opt-in local Semgrep adapter for a deliberately small Ship Check-owned ruleset.

Semgrep is **off by default** and is not bundled in the Alpha.6 desktop. Current Semgrep releases do not provide the same reproducible per-platform standalone binary boundary that Ship Check uses for Gitleaks and OSV, so Alpha.6 requires a trusted local Semgrep `1.176.x` CLI or `SHIP_CHECK_SEMGREP_PATH`.

When enabled, Ship Check:

1. starts from the same bounded repository inventory used by the canonical scan;
2. creates a temporary local mirror of readable regular files under the current 5 MB per-file limit;
3. writes the compiled Ship Check ruleset to a temporary file and verifies it against the pinned SHA-256 before execution;
4. runs Semgrep with only that local ruleset, `--metrics=off` and `--disable-version-check`;
5. never invokes Semgrep Registry rules or `--config=auto`;
6. accepts only results in the `ship-check.*` rule namespace;
7. keeps file/line, rule provenance and repair guidance but deliberately omits matched source text from canonical findings;
8. removes the temporary mirror and rules file after the scan.

Ruleset v1 contains only two high-confidence Node/JavaScript/TypeScript checks:

- explicit TLS certificate-verification bypass;
- explicit JWT expiry-verification bypass.

This remains partial Code Security coverage. A clean local Semgrep run is not broad static-analysis assurance.

If Semgrep is missing or outside the tested `1.176.x` compatibility line, the requested check returns an **unverified** Code Security gap rather than silently passing or changing analysis semantics.

CLI usage:

```bash
ship-check scan . --pack secure-build --local-semgrep-scan
```

## Desktop binary provenance

Desktop release packaging pins exact upstream assets and SHA-256 digests for Windows x64, Linux x64 and macOS Apple Silicon where those assets are available. The release workflow refuses a scanner artifact whose digest does not match the pinned value.

Current bundled pins:

- Gitleaks `8.30.1`
- OSV-Scanner `2.5.1`

Semgrep ruleset provenance is pinned inside Ship Check, but the Semgrep executable itself is intentionally not bundled in Alpha.6.

macOS alpha packaging applies ad-hoc signatures to the nested bundled scanner executables before Tauri builds the application bundle. Pilot distribution still requires the later Developer ID/notarisation work.

## What remains

- dogfood Gitleaks false positives/false negatives across the Good Ship corpus;
- dogfood OSV across representative package managers;
- dogfood the local Semgrep boundary with a compatible CLI and with Semgrep unavailable/unsupported;
- evaluate whether OSV should later support an offline vulnerability database mode for users who need a wholly offline scan;
- mature all three deep-check adapters from corpus evidence in Alpha 2 rather than broadening their scope during Alpha 1.6 testing.
