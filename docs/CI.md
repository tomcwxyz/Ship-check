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

The source snapshot still receives the bounded `source-inventory-v1` fingerprint. This allows later comparison without treating the CI runner as a different checking engine.

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
```

`path` and `report-path` must remain inside the checked-out GitHub workspace. The Action refuses paths that escape that boundary.

`networked-dependency-scan: "true"` explicitly enables OSV and therefore permits dependency identifiers/versions to leave the runner for the OSV service. It requires the `production-ready` pack.

A deployment URL adds the same bounded, non-mutating runtime evidence used by the CLI. The URL is an explicit network target supplied by the workflow author.

Live database inspection is deliberately not exposed through the first Action surface. It needs a separate secrets/least-privilege design rather than turning a database URL into an Action input.

## Outputs

The Action exposes:

- `report-path` — repository-relative JSON report path;
- `exit-code` — Ship Check's threshold result;
- `finding-count`;
- `unverified-count`;
- `snapshot-completeness` — `complete`, `partial` or `unknown`.

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
