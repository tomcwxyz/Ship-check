# Ship Check Cloud Alpha 12

**Cloud domain:** https://cloud-check.good-ship.co.uk
**Status:** Alpha. Cloud stores and compares source-free assurance metadata, not source code or full report evidence. Each project is isolated to a Neon-verified account and is only monitored when its owner explicitly configures CI. A quiet scan does **not** establish that an application is safe.

## Getting started

1. Sign in or sign up with **email and password** at `/auth`. Google and other sign-in methods are not available in this alpha.
2. Open `/dashboard`, and create a **CI metadata sync** token. The raw token appears **once**, and expires in 90 days; save it in the repository's GitHub Actions secret `SHIP_CHECK_CLOUD_HISTORY_SYNC_TOKEN`.
3. Set a repository variable `SHIP_CHECK_CLOUD_URL` to `https://cloud-check.good-ship.co.uk`. This domain's DNS and Vercel ownership have been verified.
4. Opt in to a scheduled job in the repository you wish to check. A simple example is below; for production replace any `@main` action reference with a reviewed immutable commit SHA.
5. Run the workflow manually once, then inspect the Cloud project history. Tokens can be revoked from the dashboard at any time.

## Opt-in weekly workflow

~~~yaml
name: Ship Check weekly evidence review
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
      - name: Scan and sync source-free assurance metadata
        uses: tomcwxyz/Ship-check@main # Replace with a reviewed SHA
        with:
          fail-on: never
          networked-dependency-scan: "true"
          cloud-url: ${{ vars.SHIP_CHECK_CLOUD_URL }}
          cloud-token: ${{ secrets.SHIP_CHECK_CLOUD_HISTORY_SYNC_TOKEN }}
          cloud-retention: 90-days
~~~

A blank `cloud-url` triggers no upload. Sync is never performed from pull-request events and the token must be secret-scoped. Repeated identical scan events are deduplicated. The Cloud API retains only the `assurance-metadata/0.1` summary with ruleset, coverage and aggregate counts, never raw source or credentials. Users choose a retention period.

## Agent and MCP connection

An authenticated JSON-RPC **Streamable HTTP** endpoint is available at `https://cloud-check.good-ship.co.uk/mcp`. For Alpha 12 use a client that lets you manually configure a `history:read` bearer token (create the **Read-only MCP / agent** token on the dashboard). The server offers five tools:

- `ship_check_list_projects`: account-scoped connected project directory
- `ship_check_get_project_status`: latest counts and freshness
- `ship_check_get_project_history`: bounded last 20 scans and continuity
- `ship_check_get_coverage`: assessed, partial and unassessed coverage
- `ship_check_get_attention_changes`: bounded aggregate deltas with caveats

**Not implemented in Alpha 12:** OAuth-based connection discovery for ChatGPT/other MCP clients, scheduled Cloud-side scans, automatic CVE alert subscriptions, full finding-level evidence storage and automatic Lookout synchronisation. A manual bearer token connects compatible MCP clients today; OAuth and consented Lookout project mapping remain release gates for future integration.

## API security and limits

- Sign-in and signup are delegated to the existing Neon Auth service through a same-origin email/password proxy. Every browser API request verifies the session upstream.
- Token creation and revocation require a signed-in browser session and an authorised Origin. No pilot-secret identity may create or read accounts.
- CI tokens have the minimum `history:sync` permission, and MCP tokens `history:read` only. Tokens expire automatically and raw token values are not persisted.
- Postgres rate limiting is shared between Vercel instances; the health endpoint checks actual database schema availability.
- `/api/v1/projects`, `/api/v1/tokens` and their scoped subpaths use the existing Cloud API contracts; **directly posting source code or full scan reports is unsupported**.
- Only a user-authorised owner can retrieve their project history. Never interpret a scan with no findings as proof of safety.

## Release testing and operations

Before expanding beyond the alpha pilot, validate production login, logout, account isolation, token issuance/revocation, retention deletion, first CI sync and the independent MCP client against the real domain. Test error paths as well as the happy path. The endpoint `/api/health` returns 200 **only** when the required environment variables and database schema are available. It does not prove sign-in and MCP workflows pass.

The existing [MCP / Lookout design](./CLOUD_MCP_AND_LOOKOUT.md) describes the broader OAuth, history and agent architecture.
