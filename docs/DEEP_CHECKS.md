# Deep checks

Alpha 1.6 begins using mature external scanners where they provide better deterministic evidence than maintaining a growing set of Ship Check regexes.

The adapters remain part of Ship Check's evidence contract: third-party output is translated into bounded findings, source/secrets are minimised, scanner versions are pinned for desktop releases, and a missing scanner is never silently treated as a pass.

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

## Desktop binary provenance

Desktop release packaging pins exact upstream assets and SHA-256 digests for Windows x64, Linux x64 and macOS Apple Silicon. The release workflow refuses a scanner artifact whose digest does not match the pinned value.

Current pins:

- Gitleaks `8.30.1`
- OSV-Scanner `2.5.1`

macOS alpha packaging applies ad-hoc signatures to the nested scanner executables before Tauri builds the application bundle. Pilot distribution still requires the later Developer ID/notarisation work.

## What remains

- dogfood Gitleaks false positives/false negatives across the Good Ship corpus;
- dogfood OSV across representative package managers;
- record scanner/ruleset versions as first-class check provenance rather than evidence prose alone;
- add the first small pinned/local Semgrep ruleset;
- evaluate whether OSV should later support an offline vulnerability database mode for users who need a wholly offline scan.
