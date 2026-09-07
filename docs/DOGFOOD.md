# Dogfood corpus

Ship Check should get better by running against real Good Ship repositories before the rule catalogue expands. The purpose of the corpus is not to produce a league table of apps. It is to find false positives, false negatives, missing checks, weak remediation guidance and misleading gaps in assessment coverage.

## First corpus

| Repository | Why it belongs in the corpus | What to pay attention to |
| --- | --- | --- |
| `tomcwxyz/attention-agent-pilot` | Current AI-heavy Next.js app with Neon, MCP surfaces and scheduled/agent work. | paid/API abuse boundaries, polling/cron cost, server routes, secrets, production headers |
| `tomcwxyz/glade` | Current Next.js app with Anthropic, Neon, auth, Upstash rate limiting, Resend and Stripe. | whether abuse-control heuristics recognise real controls; paid endpoints; auth and configuration evidence |
| `tomcwxyz/Event` | Newer, comparatively small Next.js/Neon app with a clean modern test/build setup. | false positives, lock discipline, production-ready baseline, whether the scan stays useful on a quieter repo |
| `tomcwxyz/Trader` | New AI-assisted app with Vercel functions, Postgres and scheduled/data work likely to evolve quickly. | cost-aware patterns, public server work, database/configuration boundaries |
| `tomcwxyz/the-list` | Older production app with Supabase, Resend, Vercel Blob and accumulated operational history. | mature-repo noise, legacy patterns, secret/public-env checks and whether remediation remains actionable |

A sixth contrasting repository can be added after the first pass if the five above are too homogeneous. Prefer something small and non-Next rather than another similar web app.

## First Alpha 1.5 observation

Windows desktop dogfood across several repositories produced three useful signals:

1. **Missing repository-visible Next.js security headers appeared frequently.** This is often an evidence gap rather than a demonstrated defect because hosting/CDN/middleware layers can own the headers. From Alpha 1.6 this is therefore `unverified`, not a low-severity finding.
2. **Frequent scheduler/polling findings recurred.** These appear worth retaining, but cadence alone is only a proxy for cost. We should next inspect what the scheduled work actually invokes before broadening severity claims.
3. **Several repositories returned no findings.** With the Alpha 1.5 catalogue that only meant none of the narrow checks fired. Alpha 1.6 therefore makes assessed / partial / not-assessed coverage visible and changes zero-finding language to “No findings in assessed areas”.

These observations are enough to justify deeper checking without abandoning the corpus-led rule: new checks must still have a defensible evidence boundary.

## Run shape

The desktop alpha should be the easiest corpus surface: scan each repository with all packs enabled and leave the `Scan receipt & diagnostics` panel available. After the corpus pass, use **Copy diagnostics** once to capture the structured run metadata for comparison.

The diagnostic history is deliberately bounded to the newest 100 scans. It stores repo label, source kind/ref, engine version, inventory source, file count, selected packs, total elapsed time, summary counts, each check's status/finding/gap count/duration, and metadata-only assessment coverage. It does **not** store source contents, evidence excerpts, finding/gap text, repair prompts, or matched secret values. Local project paths are reduced to the final folder name before storage.

The CLI remains useful when a full structured report is wanted:

```bash
ship-check scan tomcwxyz/attention-agent-pilot --format json > attention-agent.ship-check.json
ship-check scan tomcwxyz/glade --format json > glade.ship-check.json
ship-check scan tomcwxyz/Event --format json > event.ship-check.json
ship-check scan tomcwxyz/Trader --format json > trader.ship-check.json
ship-check scan tomcwxyz/the-list --format json > the-list.ship-check.json
```

Private repositories use the machine's existing Git credentials or SSH keys. Do not place access tokens in repository URLs.

## What to record

For every confirmed finding, record one of:

- `useful`
- `true-but-low-value`
- `false-positive`
- `uncertain`

For every **unverified control**, record whether the evidence gap is:

- `useful-to-verify`
- `already-protected-elsewhere`
- `heuristic-missed-local-evidence`
- `not-useful`

Also record important issues discovered manually that Ship Check missed. Those false negatives matter as much as noisy findings.

For useful findings, test the repair prompt and rerun after the change when practical. For useful unverified controls, verify the real boundary and note whether Ship Check could reasonably detect that evidence in a future scan.

## Coverage review

A zero-finding scan is not complete until the coverage view is reviewed. Ask:

- Which areas are `partial` and why?
- Which areas are `not assessed` but matter for this application?
- Did an unverified control reveal a real review task?
- Is a `partial` label too generous for the narrow checks that ran?
- Did Ship Check miss an obvious application surface such as a webhook, admin route, paid endpoint, Server Action, database boundary or cron handler?

Do **not** turn coverage into a percentage until Ship Check has a defensible denominator for what “100%” means.

## Corpus questions

The review should answer:

- Which current checks are genuinely useful across more than one repo?
- Which findings create noise because repository-visible evidence is incomplete and should become `unverified` instead?
- Which unverified controls can be made more precise by tracing imported helpers or platform configuration?
- Which important risks recur but have no deterministic check yet?
- Are severity and confidence calibrated sensibly?
- Does the repair prompt lead to an appropriate change?
- Does rerunning make it obvious that the underlying evidence changed?
- Are scan time and repository inventory sensible for both small and larger apps?
- Did any check error, time out, or produce an unexpectedly long duration?
- Did inventory provenance stay `git-tracked` for Git repositories rather than silently falling back?
- Does the coverage view prevent “no findings” from being mistaken for “safe to ship”?

## Decision rule

Do not add a broad new pack because it sounds useful. Add or strengthen checks when the corpus provides repeated evidence that a class of risk matters and can be detected with a defensible evidence boundary.

Prefer mature deterministic scanners for mature problem classes (for example secrets and known dependency vulnerabilities) and let Ship Check add evidence framing, provenance, bounded platform understanding and repair/verification guidance rather than rebuilding those scanners from scratch.