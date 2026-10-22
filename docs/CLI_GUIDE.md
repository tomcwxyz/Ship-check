# Ship Check CLI guide

Run Ship Check against a project, save the evidence, and decide what to do next. These commands use the published npm package, **not** the Ship Check source checkout.

**Requirements:** Node.js 22.12.0 or newer. Git is required for GitHub repositories and Git-history scanning. Examples use Bash / Windows Git Bash.

## Start in under a minute

From the folder you want to assess:

~~~bash
npx --yes @good-ship/ship-check@alpha --version
npx --yes @good-ship/ship-check@alpha scan .
~~~

No global installation is required. The first invocation may download the package and platform scanner dependencies.

For shorter examples below, create a temporary Bash function:

~~~bash
sc() { npx --yes @good-ship/ship-check@alpha "$@"; }
sc --help
~~~

This function lasts until you close the shell. If you do not use Bash, replace `sc` with `npx --yes @good-ship/ship-check@alpha` in the examples.

## Where do reports go?

**By default, Ship Check writes its report to your terminal (standard output). It does not create a report file automatically.** Choose the output format, then redirect it to a file yourself:

~~~bash
sc scan . --format markdown > ship-check-review.md
sc scan . --format json > ship-check-report.json
~~~

To avoid accidentally committing sensitive scan details or rescanning the generated files, save them **outside** the project:

~~~bash
mkdir -p ~/ship-check-reports
sc scan . --format markdown > ~/ship-check-reports/review.md
sc scan . --format json > ~/ship-check-reports/before.json
~~~

Display Markdown and save it at the same time:

~~~bash
sc scan . --format markdown | tee ~/ship-check-reports/review.md
~~~

Use JSON for `focus` and `compare`; Markdown is intended for humans. Reports may contain local paths and bounded evidence excerpts: review before sharing.

## Common tasks

| Goal | Command |
| --- | --- |
| Review one local project | `sc scan .` |
| Review another local folder | `sc scan ~/Code/example` |
| Scan many local projects | `sc scan-dir ~/Code --max-depth 4` |
| Save an estate review | `sc scan-dir ~/Code --format markdown > ~/ship-check-reports/estate.md` |
| Exclude an estate folder | `sc scan-dir ~/Code --exclude archived` |
| Scan a GitHub repo | `sc scan owner/repository` |
| Scan a specific Git ref | `sc scan owner/repository --ref main` |
| Scan a project ZIP | `sc scan ~/Downloads/project.zip` |
| Review a live website | `sc scan https://example.com` |
| Combine source and live site | `sc scan . --deployment-url https://example.com` |
| Inspect AI/workflow signals | `sc discover-ai .` |
| Install an agent skill | `sc skill install .` |

### Which checks run?

A normal `sc scan .` enables all three packs: **Secure Build** (security), **Production Ready** (readiness and supply-chain evidence) and **Cost Aware** (cost-related boundaries). Choose only what you need with repeatable `--pack` flags:

~~~bash
sc scan . --pack secure-build
sc scan . --pack production-ready --pack cost-aware
~~~

Deeper checks are explicitly opted into:

~~~bash
sc scan . --git-history-secrets
sc scan . --networked-dependency-scan
sc scan . --local-semgrep-scan
~~~

Git-history secrets require a Git repository and Secure Build. Networked dependencies require Production Ready and may send dependency identifiers and versions to OSV; that check is off by default. Local Semgrep requires Secure Build and a compatible local Semgrep installation; its pinned ruleset does not use Semgrep Registry/auto rules.

### Read one next action, then compare

~~~bash
sc scan . --format json > ~/ship-check-reports/before.json
sc focus ~/ship-check-reports/before.json

# Make one narrowly scoped change or verify one unanswered control, then:
sc scan . --format json > ~/ship-check-reports/after.json
sc compare ~/ship-check-reports/before.json ~/ship-check-reports/after.json --format markdown
~~~

Focus distinguishes a confirmed item to **FIX** from an unanswered item to **VERIFY**. The comparison needs reports produced with the same ruleset. A finding becoming inactive is not, by itself, proof of remediation.

### Database metadata (explicit opt-in)

For Postgres, Neon or Supabase, inspection requires Production Ready and a read-only, least-privilege credential where practical. **Do not include credentials in command arguments or save them in report files.** In Bash you can prompt without echoing the connection URL:

~~~bash
read -rs -p "Read-only database URL: " SHIP_CHECK_DATABASE_URL
echo
export SHIP_CHECK_DATABASE_URL
sc scan . --inspect-database --database-platform neon
unset SHIP_CHECK_DATABASE_URL
~~~

Change the platform label to `postgres` or `supabase` as appropriate. Inspection uses fixed system-catalog queries in a read-only transaction; it does not read application rows or establish overall database security.

## Formats and exit status

Single-project formats are `pretty` (default), `markdown`, `json`, `metadata`, `rack` and `oos`. Multi-project `scan-dir` supports `pretty`, `markdown` and `json`.

Use a threshold in automated checks:

~~~bash
sc scan . --fail-on high
echo $?
~~~

Normal completion exits 0. An active finding at or above the chosen threshold exits 2; command failures exit 1. Certain incomplete RACK and incomparable report operations exit 3. The default `--fail-on never` does not fail a scan for findings.

To collect source-free assurance metadata for later history analysis:

~~~bash
sc scan . --format metadata > ~/ship-check-reports/event-1.json
# Later: generate event-2.json using the same command
sc timeline ~/ship-check-reports/event-1.json ~/ship-check-reports/event-2.json
~~~

### Specialist outputs and cloud history

RACK output needs a verification step ID:

~~~bash
sc scan . --format rack --gate ship-check-secure-build --step-id release-security --fail-on high
sc scan . --format oos --gate ship-check
~~~

Cloud metadata history is optional and requires a configured, authorised HTTPS endpoint and token; there is no default hosted service:

~~~bash
sc cloud connect ~/ship-check-reports/event-1.json --cloud-url https://your-endpoint.example --display-name "Example" --retention 90-days
sc cloud sync PROJECT_ID ~/ship-check-reports/event-2.json --cloud-url https://your-endpoint.example
sc cloud projects --cloud-url https://your-endpoint.example
sc cloud timeline PROJECT_ID --cloud-url https://your-endpoint.example
~~~

Set `SHIP_CHECK_CLOUD_TOKEN` securely before using cloud commands. Cloud sync sends assurance **metadata only**, not source code or full findings.

## How to interpret the results

- **Finding:** evidence supports a specific concern.
- **Unverified:** something important still needs investigation; not a confirmed defect.
- **Observed:** context discovered, not a pass or a vulnerability.
- **Coverage / not assessed:** the tool did not establish this area.

Ship Check is a bounded assurance aid, not a penetration test or compliance certificate. Missing scanner evidence must not be counted as completed assessment.

## Further information

- [Project README](../README.md) — the quick start, product scope and essential links.
- [Database inspection](DATABASE_INSPECTION.md) — exact Postgres read-only boundary.
- [Project-history metadata](HISTORY_METADATA.md) — metadata schema and local timeline.
- [Alpha tester guide](ALPHA_TESTER_GUIDE.md) — structured feedback and test suggestions.
- [Report an issue](https://check.good-ship.co.uk/issues) — tell us what was confusing; never attach secrets.
