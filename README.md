# Ship Check

**Know what needs attention before you ship — and what still needs checking.**

Ship Check is a local-first project assurance tool for software built quickly, including with AI-assisted development tools. Give it the project evidence you have — source, an exported project, a live deployment, or explicitly authorised database metadata — and it runs repeatable deterministic checks, explains the evidence in plain language, separates confirmed concerns from unanswered questions, and produces repair or verification instructions that can be handed back to an agent or developer.

The standalone CLI/desktop review is the primary product surface. The same canonical engine can also be invoked by [RACK](https://github.com/tomcwxyz/rack), informed by purpose-bound [TOPO](https://github.com/tomcwxyz/TOPO) context, and contribute metadata-only assurance signals to wider Organisational OS work.

## Evidence-led review

Ship Check is deliberately narrower than a penetration test or general-purpose AI code reviewer. It is built around four evidence states:

1. **Finding** — the available evidence supports a concrete concern.
2. **Observed** — useful project context was discovered; this is not automatically a safety claim.
3. **Unverified** — a relevant boundary exists but the available evidence is not enough to establish it.
4. **Coverage** — the bounded areas Ship Check did or did not assess.

A quiet scan therefore means **no confirmed findings in the areas checked**, not “safe to ship”. A stronger evidence source may resolve an earlier unanswered question only when a check explicitly declares that it verifies the same control.

The current review areas include:

- **Security boundaries** — tracked environment files and credentials, public secret-like configuration, paid endpoints, CORS, dangerous server execution, webhook and cron authentication questions, bounded object-level authorisation questions, and variable outbound-request destinations;
- **Production readiness** — dependency lock discipline, repository-visible and deployed security-header evidence, server-surface inventory, selected GitHub Actions supply-chain boundaries, and bounded database change/access evidence;
- **Cost boundaries** — Vercel cron cadence composed with the work it reaches, plus frequent network polling that can create continuous compute, database or paid-service usage;
- **Database evidence** — Postgres migration/change provenance, destructive migration review, privileged credential boundaries, Supabase RLS provenance/live grant evidence, and Neon connection-strategy evidence;
- **Runtime evidence** — HTTPS/redirect behaviour, representative browser security headers, visible cookie flags and bounded CORS evidence.

Ship Check uses mature deterministic scanners where they provide stronger evidence than growing a home-made regex catalogue. Gitleaks is part of the normal secret-scanning path. OSV dependency vulnerability checking is optional because it can use the network. A deliberately small pinned local Semgrep ruleset is also optional.

## Project evidence sources

The repository is an important source of evidence, but not the product boundary. Current inputs are:

- local folder;
- GitHub repository via shallow transient checkout;
- exported project ZIP, including hosted-builder exports such as Lovable;
- live `http://` / `https://` deployment URL;
- explicitly opted-in read-only Postgres metadata.

The desktop presents these around user intent: **Folder**, **GitHub**, **Project ZIP**, and **Live site**. A source-based review can optionally add a live deployment URL and/or database metadata so multiple evidence sources are combined into one report without losing provenance.

### Local folder

```bash
pnpm ship-check -- scan ./my-project
```

### GitHub repository

```bash
pnpm ship-check -- scan tomcwxyz/Ship-check
pnpm ship-check -- scan https://github.com/tomcwxyz/Ship-check --ref main
```

For a GitHub source, Ship Check asks the installed Git client to make a shallow temporary checkout, scans it with the same local engine, then removes the checkout. Existing Git credentials or SSH keys can be used for private repositories; credentials embedded in repository URLs are rejected.

### Exported project ZIP

```bash
pnpm ship-check -- scan ./lovable-export.zip
```

ZIP extraction is bounded and ephemeral. Archive traversal, symlinks/special entries and excessive expansion are rejected before the canonical source scanner sees the project.

### Live site

```bash
pnpm ship-check -- scan https://example.com
```

A URL-only review uses bounded, non-mutating HTTP evidence. Source, database and other unavailable areas remain explicitly `not assessed` rather than being treated as safe.

Source plus deployment:

```bash
pnpm ship-check -- scan ./my-project --deployment-url https://example.com
```

## Optional live database metadata

Database inspection is explicit and currently requires the Production Ready pack. Ship Check reads the connection URL from an environment variable; do not put a database URL on the command line.

```bash
export SHIP_CHECK_DATABASE_URL='postgresql://...'
pnpm ship-check -- scan ./my-project \
  --inspect-database \
  --database-platform supabase
```

Use another environment-variable name when preferred:

```bash
pnpm ship-check -- scan ./my-project \
  --inspect-database \
  --database-url-env MY_READONLY_DATABASE_URL \
  --database-platform neon
```

The local inspector opens a read-only transaction, verifies that boundary, runs only Ship Check-owned fixed system-catalog queries, reads no application rows, rolls back and closes the connection. Raw metadata is not embedded wholesale into the canonical report. Use a dedicated least-privilege metadata-reading credential where practical.

In the desktop, the connection URL is session-only: it is passed to the bundled engine through a child-process environment variable and cleared after the scan. It is not placed in command arguments, app state, reports or diagnostics.

See [`docs/DATABASE_INSPECTION.md`](./docs/DATABASE_INSPECTION.md) for the full trust and evidence boundary.

Source + deployment + database can be reviewed together:

```bash
export SHIP_CHECK_DATABASE_URL='postgresql://...'
pnpm ship-check -- scan ./my-project \
  --deployment-url https://example.com \
  --inspect-database \
  --database-platform supabase
```

## Scan scope and deeper checks

Run one pack from the CLI:

```bash
pnpm ship-check -- scan ./my-project --pack cost-aware
```

Run the optional known-dependency-vulnerability check:

```bash
pnpm ship-check -- scan ./my-project --networked-dependency-scan
```

Run the optional local Semgrep rules, when a compatible trusted Semgrep CLI is installed:

```bash
pnpm ship-check -- scan ./my-project --pack secure-build --local-semgrep-scan
```

JSON remains the complete portable report:

```bash
pnpm ship-check -- scan ./my-project --format json > ship-check-report.json
```

Every newly generated report also carries a `check-ruleset-v1` SHA-256 fingerprint over the selected check IDs, rule versions and packs. Engine version remains separate, so history/CI can distinguish “same rules under a newer Ship Check build” from an actual ruleset change without retaining source content.

## GitHub Actions

Ship Check can run inside the repository owner's GitHub Actions runner using the same canonical engine:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v4
  - uses: tomcwxyz/Ship-check@<pinned-ref>
    with:
      fail-on: high
```

The Action records the checked-out source as `github · ci · ci-runner`, writes the JSON report into the caller workspace, and does not upload source to Ship Check infrastructure. During the alpha, pin an exact reviewed commit or release tag rather than following a mutable branch.

On `pull_request` events it also compares the current source with the exact PR base SHA inside the same runner, using the same Ship Check revision and rule set. The step summary distinguishes new, persistent, reactivated, accepted and no-longer-active findings, unanswered controls and newly observed inventory surfaces without claiming that disappearance proves remediation.

The OSV dependency network check remains opt-in. Report artifact upload is also a separate explicit choice because the full report can contain bounded evidence and repair guidance.

See [`docs/CI.md`](./docs/CI.md) for inputs, outputs and the trust boundary.


## Ecosystem use

RACK-compatible gate output is deliberately smaller and has the same `pass | fail | uncertain | incomplete` outcome vocabulary as RACK verification:

```bash
pnpm ship-check -- scan ./my-project \
  --format rack \
  --gate ship-check-secure-build \
  --step-id release-security \
  --fail-on high
```

A metadata-only Organisational OS summary can be emitted without handing source code or evidence excerpts to the organisational layer:

```bash
pnpm ship-check -- scan ./my-project --format oos --gate ship-check
```

## Repository shape

Ship Check follows the same broad separation used by RACK and TOPO:

- `packages/schemas` — portable finding, evidence, project-source, database-metadata, report and assurance-gate contracts;
- `packages/core` — source inventory, runtime/database evidence runners, check orchestration and report assembly;
- `packages/checks` — Security and Production deterministic checks, bounded questions and application-surface inventory;
- `packages/cost-checks` — Cost deterministic checks;
- `packages/database-checks` — Postgres/Supabase/Neon source evidence and bounded live database checks;
- `packages/database-inspector` — opt-in local Postgres metadata acquisition behind the read-only/fixed-query boundary;
- `packages/runtime-checks` — bounded deployed HTTP checks;
- `packages/deep-checks` — privacy-bounded adapters for mature or deeper scanners;
- `packages/adapters` — RACK, TOPO and organisational assurance bridges;
- `packages/cli` — standalone CLI and project-source/database acquisition boundaries;
- `apps/desktop` — Tauri desktop review surface over the same canonical engine;
- `test-fixtures` — deliberately vulnerable/safe fixtures used as regression evidence;
- `docs` — architecture, roadmap, interoperability, evidence boundaries and release/test gates.

The core remains UI-agnostic. RACK consumes a bounded verification result rather than importing desktop code. TOPO context is purpose-bound and optional, and must stay visually and semantically separate from deterministic project evidence.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm ship-check -- scan ./test-fixtures/risky-next --format pretty
```

The current public corpus and validation workflows are regression/calibration gates rather than claims that the catalogue is complete. Database and runtime evidence are intentionally bounded and retain explicit limitations even when a check can verify one control.

## Product boundary

Ship Check is an assurance aid, not a certification or replacement for professional security testing. A completed automated check means the inspected evidence was assessed within that rule's boundary; it does not prove that a system is secure, compliant, cheap to run or production-ready.

## Licence

Apache-2.0 for code. The Ship Check name and marks are retained by The Good Ship.