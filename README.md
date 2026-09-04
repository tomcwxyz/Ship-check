# Ship Check

**Know what is actually wrong before you ship.**

Ship Check is a local-first assurance tool for software built quickly with AI-assisted development tools. It inspects a project using repeatable deterministic checks, explains findings in plain language, and produces evidence-rich repair instructions that can be handed back to an agent or developer.

The project is being built as a standalone Good Ship tool with deliberate interoperability boundaries for [RACK](https://github.com/tomcwxyz/rack), [TOPO](https://github.com/tomcwxyz/TOPO) and the wider Organisational OS work.

## Alpha direction

The alpha is deliberately narrower than a penetration test or general-purpose AI code reviewer. It establishes a reusable checking engine with four properties:

1. deterministic evidence before model judgement;
2. structured, portable findings rather than prose-only reports;
3. explicit repair guidance and verification steps;
4. local-first operation with no account or hosted service required.

The current deterministic packs are:

- **Secure Build** — tracked environment files, common credential shapes, paid endpoints without obvious abuse controls, wildcard CORS and public secret-like environment names;
- **Production Ready** — dependency lock discipline and repository-visible Next.js security-header evidence;
- **Cost Aware** — high-frequency Vercel cron schedules and frequent network polling that can create continuous serverless/API work.

Cost Aware exists because a product can be technically functional while quietly consuming compute or paid APIs all day. It should remain evidence-led rather than becoming a generic optimisation linter.

## Repository shape

Ship Check follows the same broad separation used by RACK and TOPO:

- `packages/schemas` — portable finding, evidence, check-pack, report and assurance-gate contracts;
- `packages/core` — repository inventory, check orchestration, severity/confidence policy and report assembly;
- `packages/checks` — Secure Build and Production Ready deterministic checks;
- `packages/cost-checks` — Cost Aware deterministic checks kept separately so the pack can evolve without turning security checks into cost heuristics;
- `packages/adapters` — process/JSON bridge helpers for RACK, TOPO context requests and metadata-only Organisational OS assurance summaries;
- `packages/cli` — thin local CLI over the same engine and adapters;
- `apps/desktop` — Tauri + React review surface (alpha shell follows once the engine contract is stable);
- `test-fixtures` — deliberately vulnerable/safe fixtures used as regression evidence;
- `docs` — architecture, roadmap, interoperability and release notes.

The core package remains UI-agnostic. RACK consumes a bounded verification result rather than importing desktop code. TOPO context is purpose-bound and optional, and must stay visually and semantically separate from deterministic repository evidence.

## Alpha command

Once dependencies are installed:

```bash
pnpm install
pnpm check
pnpm test
pnpm ship-check -- scan ./test-fixtures/risky-next --format pretty
```

Run only the Cost Aware pack:

```bash
pnpm ship-check -- scan ./my-project --pack cost-aware
```

JSON remains the complete portable report:

```bash
pnpm ship-check -- scan ./my-project --format json > ship-check-report.json
```

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

## Product boundary

Ship Check is an assurance aid, not a certification or replacement for professional security testing. A passed automated check means the inspected evidence did not trigger that rule; it does not prove that a system is secure, compliant, cheap to run or production-ready.

## Licence

Apache-2.0 for code. The Ship Check name and marks are retained by The Good Ship.
