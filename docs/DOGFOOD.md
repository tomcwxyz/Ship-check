# Dogfood corpus

Ship Check should get better by running against real Good Ship repositories before the rule catalogue expands. The purpose of the first corpus is not to produce a league table of apps. It is to find false positives, false negatives, missing checks and weak remediation guidance.

## First corpus

| Repository | Why it belongs in the corpus | What to pay attention to |
| --- | --- | --- |
| `tomcwxyz/attention-agent-pilot` | Current AI-heavy Next.js app with Neon, MCP surfaces and scheduled/agent work. | paid/API abuse boundaries, polling/cron cost, server routes, secrets, production headers |
| `tomcwxyz/glade` | Current Next.js app with Anthropic, Neon, auth, Upstash rate limiting, Resend and Stripe. | whether abuse-control heuristics recognise real controls; paid endpoints; auth and configuration evidence |
| `tomcwxyz/Event` | Newer, comparatively small Next.js/Neon app with a clean modern test/build setup. | false positives, lock discipline, production-ready baseline, whether the scan stays useful on a quieter repo |
| `tomcwxyz/Trader` | New AI-assisted app with Vercel functions, Postgres and scheduled/data work likely to evolve quickly. | cost-aware patterns, public server work, database/configuration boundaries |
| `tomcwxyz/the-list` | Older production app with Supabase, Resend, Vercel Blob and accumulated operational history. | mature-repo noise, legacy patterns, secret/public-env checks and whether remediation remains actionable |

A sixth contrasting repository can be added after the first pass if the five above are too homogeneous. Prefer something small and non-Next rather than another similar web app.

## Run shape

Once the repo-first alpha is installed, each pass should run all current packs and retain only the structured report, not source content:

```bash
ship-check scan tomcwxyz/attention-agent-pilot --format json > attention-agent.ship-check.json
ship-check scan tomcwxyz/glade --format json > glade.ship-check.json
ship-check scan tomcwxyz/Event --format json > event.ship-check.json
ship-check scan tomcwxyz/Trader --format json > trader.ship-check.json
ship-check scan tomcwxyz/the-list --format json > the-list.ship-check.json
```

Private repositories use the machine's existing Git credentials or SSH keys. Do not place access tokens in repository URLs.

## What to record

For every finding, record one of: `useful`, `true-but-low-value`, `false-positive`, `uncertain`. Also note important issues we discover manually that Ship Check missed. For useful findings, test the repair prompt and rerun the repository after the change when practical.

The corpus review should answer:

- Which current checks are genuinely useful across more than one repo?
- Which checks create noise because repository-visible evidence is incomplete?
- Which important risks recur but have no deterministic check yet?
- Are severity and confidence calibrated sensibly?
- Does the repair prompt lead to an appropriate change?
- Does rerunning make it obvious that the underlying evidence changed?
- Are scan time and repository inventory sensible for both small and larger apps?

## Decision rule

Do not add a broad new pack because it sounds useful. Add or strengthen checks when the corpus provides repeated evidence that a class of risk matters and can be detected with a defensible evidence boundary.
