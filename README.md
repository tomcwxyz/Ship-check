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

Initial check packs focus on **Production Ready** and **Secure Build** signals that can be established safely from a repository: exposed credentials, risky environment files, public/paid endpoints without obvious abuse controls, dependency audit hooks, missing security headers, and common framework/database configuration hazards.

## Repository shape

Ship Check follows the same broad separation used by RACK and TOPO:

- `packages/schemas` — portable finding, evidence, check-pack and report contracts;
- `packages/core` — repository inventory, check orchestration, severity/confidence policy and report assembly;
- `packages/checks` — deterministic built-in checks grouped into reusable packs;
- `packages/cli` — thin local CLI over the core engine;
- `apps/desktop` — Tauri + React review surface (alpha shell follows once the engine contract is stable);
- `test-fixtures` — deliberately vulnerable/safe fixtures used as regression evidence;
- `docs` — architecture, roadmap, interoperability and release notes.

The core package must remain UI-agnostic so RACK can consume Ship Check plans/findings without importing the desktop application. TOPO context, when used later, must be purpose-bound and optional rather than silently copied into Ship Check.

## Alpha command

Once dependencies are installed:

```bash
pnpm install
pnpm check
pnpm test
pnpm ship-check -- scan ./test-fixtures/risky-next --format pretty
```

JSON output is the interoperability contract:

```bash
pnpm ship-check -- scan ./my-project --format json > ship-check-report.json
```

## Product boundary

Ship Check is an assurance aid, not a certification or replacement for professional security testing. A passed automated check means the inspected evidence did not trigger that rule; it does not prove that a system is secure, compliant or production-ready.

## Licence

Apache-2.0 for code. The Ship Check name and marks are retained by The Good Ship.
