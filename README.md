# Ship Check

**Know what needs fixing before you ship — and what still needs checking.**

Ship Check is an open-source, local-first tool for reviewing software projects, including those built with AI coding tools. It checks the evidence you give it, highlights concrete concerns, makes unanswered questions visible and suggests what to fix or verify next.

**[Try the free playground](https://check.good-ship.co.uk)** · **[CLI guide](docs/CLI_GUIDE.md)** · **[Source code](https://check.good-ship.co.uk/source)**

## Try it in your browser

At [check.good-ship.co.uk](https://check.good-ship.co.uk), enter a **public GitHub repository** to get a bounded review — no account or installation needed.

The playground offers three scans per visitor per day, a clear view of findings and gaps, and downloadable Markdown and JSON reports. It does not retain source code or scan history. Private repositories, local folders and live-website-only scans aren't available in the playground yet.

For broader or private project checks, use the local CLI.

## Run Ship Check locally

You'll need **Node.js 22.12.0 or newer**. In the folder containing your project, run:

```bash
npx --yes @good-ship/ship-check@alpha scan .
```

The scan runs on your machine and prints a report to the terminal. **Nothing is saved automatically.** To keep a Markdown review, save it outside the project being checked:

```bash
mkdir -p ~/ship-check-reports
npx --yes @good-ship/ship-check@alpha scan . --format markdown > ~/ship-check-reports/review.md
```

Other ways to review a project:

```bash
# Public GitHub repository (Git required)
npx --yes @good-ship/ship-check@alpha scan owner/repository

# Live website (bounded HTTP checks)
npx --yes @good-ship/ship-check@alpha scan https://example.com

# A folder containing multiple projects
npx --yes @good-ship/ship-check@alpha scan-dir ~/Code --max-depth 4
```

The local tool also supports exported ZIP projects, optional Git-history and dependency checks, and explicitly authorised read-only Postgres metadata inspection. See the [CLI guide](docs/CLI_GUIDE.md) for exact commands, evidence boundaries and additional options.

## What the report tells you

Ship Check distinguishes four kinds of evidence:

- **Finding:** there's evidence of a particular concern and an action to consider.
- **Unverified:** something important needs checking, but the evidence isn't enough to decide.
- **Observed:** useful project context, not automatically a pass or a problem.
- **Coverage:** what was inspected, partly assessed or not assessed.

Checks cover selected **security, production-readiness and cost** concerns, with deeper checks available by opt-in. Ship Check deliberately avoids an overall “safe to ship” score. No findings means no confirmed problems **within the areas assessed**, not proof of safety.

Reports may contain file paths and evidence excerpts. Review them before sharing, especially for private projects.

## Working with a coding agent

You can use a report's suggested FIX or VERIFY steps with a developer or coding agent, then rerun the scan. The CLI also includes an installable Agent Skill:

```bash
npx --yes @good-ship/ship-check@alpha skill install .
```

Keep the tool's deterministic evidence separate from the agent's interpretation, and verify any changes.

## Guides and development

- [CLI and npx: getting started, deeper scans and saving reports](docs/CLI_GUIDE.md)
- [GitHub Actions and CI](docs/CI.md)
- [Database inspection and privacy boundary](docs/DATABASE_INSPECTION.md)
- [Desktop alpha testing](docs/ALPHA_TESTER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)
- [Issues and feedback](https://check.good-ship.co.uk/issues) — please don't attach secrets or unredacted reports.

To work on Ship Check itself:

```bash
pnpm install
pnpm check
pnpm test
```

## Licence

Code is designated Apache-2.0. The Ship Check name and marks are retained by The Good Ship.

Ship Check is an assurance aid, **not** a penetration test, compliance audit or security certification.


For scheduled metadata-only CI history and its prerequisites, see [Cloud monitoring pilot](docs/CLOUD_MONITORING.md).
