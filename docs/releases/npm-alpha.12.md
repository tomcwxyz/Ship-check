# Ship-check Alpha 12 — vulnerability intelligence

**Version:** `0.0.0-alpha.12` · **Status:** release candidate; publishing not yet dispatched.

Alpha 12 is a combined engine, npm CLI and unsigned/ad-hoc-signed desktop test build. The public playground stays on **published Alpha 11** until the new npm package is confirmed in the registry.

## What's improved

- **Node.js security intelligence:** With `--networked-dependency-scan`, compares exact Node.js versions declared in source files, Dockerfiles and CI with the official security release index and end-of-support schedule. Repository declarations do not establish the actual deployed runtime; broad version ranges and missing feeds remain unverified.
- **Dependency vulnerabilities:** OSV-Scanner uses a restricted manifest-only mirror; CVSS v3 ratings, missing severity and advisory-listed fixes are surfaced without pretending to know if a vulnerable code path is exploitable.
- **Known malicious packages:** OSV entries with explicit `MAL-YYYY-NNN` identifiers are shown as critical malicious-package findings, with containment and credential-review advice distinct from an ordinary upgrade. This is **not** a complete guarantee of malware detection; GitHub's separate malware advisory feed is not currently included.
- **Coverage correctness:** Uses OSV `--all-packages` to establish a package inventory. No extracted packages (scanner exit 128) or malformed/empty package output is marked **unverified**, not a clean dependency assessment.
- **Release alignment:** Root project, compiled CLI version, Tauri configuration and Cargo metadata are all Alpha 12.

## Security and privacy

All networked dependency intelligence remains opt-in on desktop and CLI. OSV may receive package/version information; official Node.js endpoints receive requests for public release data. Ship-check does not upload application source. Report severity is advisory evidence, not confirmation of exploitability. If source and production runtime differ, verify production independently.

## Release steps (in order)

1. Confirm all **Validate**, **NPM package validate**, **Desktop validate** and representative regression checks on the exact merged `main` commit.
2. In GitHub Actions **npm alpha publish**, select **Run workflow → main**, enter **version = 0.0.0-alpha.12**, **confirm = PUBLISH_ALPHA**, and run. Publishing uses trusted GitHub OIDC credentials and six platform scanner packages. Do not publish before validation.
3. Verify the registry contains `@good-ship/ship-check@0.0.0-alpha.12` and all six scanner variants. Run an end-to-end `npx` scan with `--networked-dependency-scan`, including a known vulnerable fixture and a benign lockfile.
4. Merge the *separate* playground pin update from Alpha 11 to Alpha 12 **only after npm publication**, then confirm Vercel production READY and run one opt-in GitHub repository scan from the public domain.
5. In GitHub Actions **Desktop alpha release**, select **Run workflow → main**, enter **version = 0.0.0-alpha.12**, **confirm = ALPHA**, and run. The workflow produces Windows x64 NSIS, Linux x64 DEB and macOS Apple Silicon app.zip in a **draft pre-release**, not a public signed download.
6. Verify each asset, release commit and bundled scanner/engine versions before sharing with alpha testers.

## Acceptance

```bash
npx --yes @good-ship/ship-check@0.0.0-alpha.12 --version
npx --yes @good-ship/ship-check@0.0.0-alpha.12 scan . --networked-dependency-scan --format markdown
```

Expected: a distinct warning for source-declared outdated Node.js; confirmed MAL records are not conflated with ordinary CVEs; missing or empty OSV extraction is recorded as unverified; a valid resolved-lockfile scan can complete. Reports must not contain secrets.

## Known limitations

- The Node.js check reads declared versions and release markers; it does not resolve specific CVE exposure per installation or identify the deployed runtime.
- OSV may miss malicious packages represented only in a separate provider's malware advisory feed.
- `--all-packages` provides evidence of extracted packages, but does not guarantee every package ecosystem is supported.
- Offline local-first scans do **not** silently query advisory servers.
- Desktop is unsigned on Windows and not Apple-notarised.
