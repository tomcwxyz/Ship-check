# Cloud monitoring — opt-in CI history pilot

This is the first usable recurring-monitoring integration, **not** a hosted always-on vulnerability alert service. The canonical GitHub Action scans in the repository's own CI runner. It already generates the source-free `assurance-metadata/0.1` sidecar and can now, with separate consent, sync **only that file** to Cloud.

## What is implemented

- `cloud-url`, `cloud-token` and `cloud-retention` are optional GitHub Action inputs. A blank Cloud URL means **no Cloud request**.
- Sync invokes the existing canonical `ship-check cloud connect` command with an expiring scoped `history:sync` token, after the scan and metadata sidecar are generated.
- The Cloud connect operation is idempotent per opaque project and scan identity. Later scheduled executions add new events; repeats do not duplicate them.
- Sync is only permitted for `push`, `schedule` and `workflow_dispatch` events, never pull requests. The secret is passed only to the sync step as an environment variable, not the command line.
- A requested but unsuccessful sync causes an explicit CI failure. Source files, full report, evidence details and matched secrets are never part of the Cloud payload.
- There is no automatic scanning schedule in Ship-check's repository. A caller must enable a workflow explicitly.

## Example weekly monitoring workflow

Save this in a project repository as `.github/workflows/ship-check-monitor.yml`. Pin the action to a **reviewed immutable commit SHA** for production rather than tracking main. Weekly scanning is a low-cost starting point; don't blindly re-run paid network checks on every PR.

~~~yaml
name: Ship Check monitoring
on:
  workflow_dispatch:
  schedule:
    - cron: "45 6 * * 1"

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: Review
        uses: tomcwxyz/Ship-check@main # pilot only — replace with a reviewed SHA
        with:
          fail-on: never
          networked-dependency-scan: "true"
          cloud-url: ${{ vars.SHIP_CHECK_CLOUD_URL }}
          cloud-token: ${{ secrets.SHIP_CHECK_CLOUD_HISTORY_SYNC_TOKEN }}
          cloud-retention: 90-days
~~~

Configure `SHIP_CHECK_CLOUD_URL` as a GitHub Actions repository variable and `SHIP_CHECK_CLOUD_HISTORY_SYNC_TOKEN` as a **secret**. Never put the token value in source, logs, a workflow file or pull-request inputs. The URL must be a plain HTTPS origin.

## Prerequisites to enable Cloud

Before configuring those inputs, provision a separate `apps/cloud` deployment with server-only Postgres connection, both `migrations/cloud` applied, authenticated account setup, token issuance and tested history queries. The current Cloud app uses a pilot-only session header and in-memory rate limits. Replace both before broader access.

The inspected Vercel project named `ship-check` has **no configured environment variables**. That does not demonstrate an operational Cloud database or hosted monitoring service. The `ship-check-playground` deployment is an ephemeral scanner, not persistent Cloud history.

## Acceptance tests

1. With no Cloud URL, the Action scans without any Cloud request.
2. PR execution with inputs set must skip sync.
3. On an authenticated test deployment, the first manual scan stores a metadata event. A repeated identical event is deduplicated.
4. Read back the project timeline with an independently scoped `history:read` token. Verify it contains only aggregate metadata, not source/evidence text.
5. Revoke or expire the sync token: the Action must fail closed without printing credentials.
6. Configure the explicit weekly schedule only after resource cost, retention and privacy controls have been reviewed.

## Still to build

Real account sign-in, operational shared rate limiting, end-to-end DB/host verification, a project history UI and estate dashboard, optional desktop/CLI post-scan sync, GitHub webhooks and change-aware scheduled scanning. **Newly disclosed advisory alerts** also require consented package/advisory inventory metadata and freshness/deduplication rules. Source-free aggregate counts by themselves cannot identify a newly vulnerable dependency or establish deployed exploitability.
