# GitHub Actions runner

Ship Check can run inside a repository owner's GitHub Actions runner. This keeps the source checkout inside GitHub Actions and uses the same canonical engine as the CLI and desktop.

The Action is a **CI execution surface**, not Ship Check Cloud. It does not upload source to Ship Check infrastructure.

## Minimal workflow

Check out the repository, then run Ship Check:

```yaml
name: Ship Check

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  ship-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: tomcwxyz/Ship-check@<pinned-ref>
        with:
          fail-on: high
```

During the alpha, pin the Action to an exact Ship Check commit or release tag you have reviewed rather than following a mutable branch.

The Action installs Ship Check with the repository's committed `pnpm-lock.yaml` and `--frozen-lockfile`, so an exact Action revision also fixes the dependency graph used to prepare the tool in the runner. A future prebuilt Action can reduce setup time further without weakening that provenance.

The default run:

- scans the checked-out repository;
- enables Secure Build, Production Ready and Cost Aware;
- fails when an active finding is `high` or `critical`;
- writes the full portable JSON report to `.ship-check/report.json`;
- writes bounded counts and provenance to the GitHub step summary;
- does not run the networked OSV dependency check unless explicitly enabled.

## Evidence provenance

A source checkout supplied through the Action is recorded as:

- provider: `github`;
- acquisition: `ci`;
- execution location: `ci-runner`;
- capability: `ci-context` plus the normal source/Git capabilities Ship Check can establish.

The source snapshot still receives the bounded `source-inventory-v1` fingerprint. Reports also carry a `check-ruleset-v1` SHA-256 fingerprint over selected check IDs, rule versions and packs. Engine version remains separate. Together these let history distinguish source change, rule-set change and tool-build change without retaining source contents.

## Inputs

```yaml
- uses: tomcwxyz/Ship-check@<pinned-ref>
  with:
    path: .
    packs: secure-build,production-ready,cost-aware
    fail-on: high
    report-path: .ship-check/report.json
    deployment-url: https://example.com
    networked-dependency-scan: "false"
    pr-comparison: "true"
```

`path` and `report-path` must remain inside the checked-out GitHub workspace. The Action refuses paths that escape that boundary.

`networked-dependency-scan: "true"` explicitly enables OSV and therefore permits dependency identifiers/versions to leave the runner for the OSV service. It requires the `production-ready` pack.

A deployment URL adds the same bounded, non-mutating runtime evidence used by the CLI. The URL is an explicit network target supplied by the workflow author.

### Pull request change summary

On a `pull_request` workflow, `pr-comparison: "true"` is the default. Ship Check reads the exact base SHA from GitHub's event payload, fetches that commit into the same Actions runner, creates a temporary detached Git worktree, and scans the same project path with the same Ship Check revision and ruleset.

The comparison is **source-to-source**. An optional deployment URL is not included in the base/current delta because the live deployment does not represent the historical base commit.

The step summary distinguishes:

- newly introduced, persistent and reactivated active findings;
- findings moved into an explicit accepted exception;
- findings that are no longer active, without claiming that disappearance proves a fix;
- newly introduced and no-longer-active unanswered controls;
- newly observed and no-longer-observed inventory surfaces;
- changed, unchanged, partial/uncertain or unavailable source-snapshot comparison.

The base worktree is removed after comparison. Neither base nor current source is uploaded to Ship Check infrastructure. Failure to fetch or scan the exact base does **not** replace or fail the normal current-source Ship Check result; the comparison is marked unavailable and the configured current-scan severity gate remains authoritative.

Set `pr-comparison: "false"` to disable the additional base scan.

Live database inspection is deliberately not exposed through the first Action surface. It needs a separate secrets/least-privilege design rather than turning a database URL into an Action input.

## Outputs

The Action exposes:

- `report-path` — repository-relative JSON report path;
- `exit-code` — Ship Check's threshold result;
- `finding-count`;
- `unverified-count`;
- `snapshot-completeness` — `complete`, `partial` or `unknown`;
- `ruleset-fingerprint` — the 64-character SHA-256 fingerprint for the selected check IDs, rule versions and packs.

For pull-request comparison it also exposes:

- `comparison-status` — `compared`, `unavailable`, `disabled` or `not-applicable`;
- `new-finding-count`, `reactivated-finding-count`, `accepted-finding-count`, `no-longer-active-finding-count`;
- `new-unverified-count`, `no-longer-active-unverified-count`;
- `new-surface-count`.

These are metadata outputs only; raw finding IDs, evidence excerpts and source paths are not added to Action outputs.

The report remains in the caller workspace. Uploading it as an Actions artifact is a separate choice:

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: ship-check-report
    path: .ship-check/report.json
```

That distinction is intentional. The canonical report can include bounded evidence and repair guidance, so persistence beyond the runner should be explicit.

## Trust boundary

The Action:

1. uses the exact Ship Check Action revision selected by the caller;
2. installs/builds that revision inside the runner;
3. scans the caller's checked-out source in place;
4. writes the report back into the caller workspace;
5. applies the configured severity gate after the report has been written.

Source is not sent to a Good Ship or Ship Check service. Normal GitHub Actions, package-install and any explicitly enabled network-check boundaries still apply.

This is the first CI foundation. Future work can add change-aware PR summaries and optional metadata sync without requiring a managed source scanner.
