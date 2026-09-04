# Ship Check

**Know what is actually wrong before you ship.**

Ship Check is a repository checker for software built quickly with AI-assisted development tools. Point it at a local project or GitHub repository and it runs repeatable deterministic checks, explains the evidence in plain language, and produces repair instructions that can be handed back to an agent or developer.

The standalone repository check is the primary product surface. The same checking engine can also be invoked by [RACK](https://github.com/tomcwxyz/rack), informed by purpose-bound [TOPO](https://github.com/tomcwxyz/TOPO) context, and later contribute metadata-only assurance signals to wider Organisational OS work.

## Alpha direction

The alpha is deliberately narrower than a penetration test or general-purpose AI code reviewer. It establishes a reusable checking engine with four properties:

1. deterministic evidence before model judgement;
2. structured, portable findings rather than prose-only reports;
3. explicit repair guidance and verification steps;
4. local-first operation with no account or hosted Ship Check service required.

The current deterministic packs are:

- **Secure Build** — tracked environment files, common credential shapes, paid endpoints without obvious abuse controls, wildcard CORS and public secret-like environment names;
- **Production Ready** — dependency lock discipline and repository-visible Next.js security-header evidence;
- **Cost Aware** — high-frequency Vercel cron schedules and frequent network polling that can create continuous serverless/API work.

Cost Aware exists because a product can be technically functional while quietly consuming compute or paid APIs all day. It should remain evidence-led rather than becoming a generic optimisation linter.

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

The desktop alpha exposes the same two entry points: **Local folder** and **GitHub repo**. GitHub mode is a transport into the standalone checker, not a hosted scanning service.

Run one pack:

```bash
pnpm ship-check -- scan ./my-project --pack cost-aware
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
- `packages/checks` — Secure Build and Production Ready deterministic checks;
- `packages/cost-checks` — Cost Aware deterministic checks;
- `packages/adapters` — RACK, TOPO and organisational assurance bridges;
- `packages/cli` — standalone CLI, including local and transient GitHub repository sources;
- `apps/desktop` — Tauri desktop review surface over the same canonical engine;
- `test-fixtures` — deliberately vulnerable/safe fixtures used as regression evidence;
- `docs` — architecture, roadmap, interoperability and release notes.

The core package remains UI-agnostic. RACK consumes a bounded verification result rather than importing desktop code. TOPO context is purpose-bound and optional, and must stay visually and semantically separate from deterministic repository evidence.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm ship-check -- scan ./test-fixtures/risky-next --format pretty
```

## Product boundary

Ship Check is an assurance aid, not a certification or replacement for professional security testing. A passed automated check means the inspected evidence did not trigger that rule; it does not prove that a system is secure, compliant, cheap to run or production-ready.

## Licence

Apache-2.0 for code. The Ship Check name and marks are retained by The Good Ship.
