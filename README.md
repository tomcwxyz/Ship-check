# Ship Check

**Know what needs attention before you ship — and what still needs checking.**

Ship Check is a local-first repository review tool for software built quickly, including with AI-assisted development tools. Point it at a local project or GitHub repository and it runs repeatable deterministic checks, explains the evidence in plain language, separates confirmed concerns from unanswered questions, and produces repair or verification instructions that can be handed back to an agent or developer.

The standalone repository check is the primary product surface. The same checking engine can also be invoked by [RACK](https://github.com/tomcwxyz/rack), informed by purpose-bound [TOPO](https://github.com/tomcwxyz/TOPO) context, and later contribute metadata-only assurance signals to wider Organisational OS work.

## Alpha direction

Ship Check is deliberately narrower than a penetration test or general-purpose AI code reviewer. It is built around four evidence states:

1. **Finding** — repository evidence supports a concrete concern.
2. **Observed** — useful repository-visible context was discovered; this is not a safety claim.
3. **Unverified** — a relevant boundary exists but source evidence is not enough to establish it.
4. **Coverage** — the bounded areas Ship Check did or did not assess.

A quiet scan therefore means **no confirmed findings in the areas checked**, not “safe to ship”.

The current review areas are:

- **Security boundaries** — tracked environment files and credentials, public secret-like configuration, paid endpoints, CORS, dangerous server execution, webhook and cron authentication questions, bounded object-level authorisation questions, and variable outbound-request destinations;
- **Production readiness** — dependency lock discipline, repository-visible Next.js security-header evidence, server-surface inventory and selected GitHub Actions supply-chain boundaries;
- **Cost boundaries** — Vercel cron cadence composed with the work it reaches, plus frequent network polling that can create continuous compute, database or paid-service usage.

Ship Check uses mature deterministic scanners where they provide stronger evidence than growing a home-made regex catalogue. Gitleaks is part of the normal secret-scanning path. OSV dependency vulnerability checking is optional because it can use the network. A deliberately small pinned local Semgrep ruleset is also optional.

Cost checking exists because a product can be technically functional while quietly consuming compute or paid APIs all day. It should remain evidence-led rather than becoming a generic optimisation linter.

## Check a repository

Local folder:

```bash
pnpm ship-check -- scan ./my-project
```

GitHub repository:

```bash
pnpm ship-check -- scan tomcwxyz/Ship-check
pnpm ship-check -- scan https://github.com/tomcwxyz/Ship-check --ref main
```

For a GitHub source, Ship Check asks the installed Git client to make a shallow temporary checkout, scans it with the same local engine, then removes the checkout. Existing Git credentials or SSH keys can be used for private repositories; credentials embedded in repository URLs are rejected.

The desktop alpha exposes the same two entry points: **Local folder** and **GitHub repo**. The recommended standard review runs all applicable local review areas; narrower scope and optional deeper/networked checks live under advanced controls. GitHub mode is a transport into the standalone checker, not a hosted scanning service.

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

- `packages/schemas` — portable finding, evidence, check-pack, report and assurance-gate contracts;
- `packages/core` — repository inventory, check orchestration, severity/confidence policy and report assembly;
- `packages/checks` — Security and Production deterministic checks, bounded questions and application-surface inventory;
- `packages/cost-checks` — Cost deterministic checks;
- `packages/deep-checks` — privacy-bounded adapters for mature or deeper scanners;
- `packages/adapters` — RACK, TOPO and organisational assurance bridges;
- `packages/cli` — standalone CLI, including local and transient GitHub repository sources;
- `apps/desktop` — Tauri desktop review surface over the same canonical engine;
- `test-fixtures` — deliberately vulnerable/safe fixtures used as regression evidence;
- `docs` — architecture, roadmap, interoperability, evidence boundaries and release/test gates.

The core package remains UI-agnostic. RACK consumes a bounded verification result rather than importing desktop code. TOPO context is purpose-bound and optional, and must stay visually and semantically separate from deterministic repository evidence.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm ship-check -- scan ./test-fixtures/risky-next --format pretty
```

The current pre-alpha.8 quality gate is documented in [`docs/ALPHA_8_GATE.md`](./docs/ALPHA_8_GATE.md). It intentionally keeps database/RLS inspection and live runtime verification on their later roadmap lines while the repository-review breadth, language and calibration are tested.

## Product boundary

Ship Check is an assurance aid, not a certification or replacement for professional security testing. A completed automated check means the inspected evidence was assessed within that rule's boundary; it does not prove that a system is secure, compliant, cheap to run or production-ready.

## Licence

Apache-2.0 for code. The Ship Check name and marks are retained by The Good Ship.
