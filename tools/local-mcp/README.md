# Ship Check MCP

Ship Check has **two MCP interfaces**, both backed by the existing Ship Check scanner and Cloud data. They are not independent scanning engines.

## 1. Local MCP — run scans in a coding agent

This is a local stdio MCP adaptor, currently developed in the Ship Check repository at `tools/local-mcp`. It **does not update the scanner automatically**. Install the latest published npm alpha explicitly, then check the actual version with the `ship_check_version` tool.

Requirements: Node.js 22.12+, Ship Check repository checkout and a supported MCP client.

```bash
npm install --global @good-ship/ship-check@alpha
ship-check --version
cd tools/local-mcp
npm install
npm test
```

Configure your client to run `node /absolute/path/to/Ship-check/tools/local-mcp/server.mjs` and set:

- `SHIP_CHECK_PROJECT_ROOT`: an **absolute path** to the root folder this agent may scan. Relative and symlink escapes are rejected.
- `SHIP_CHECK_BIN` (optional): path to the installed CLI executable when not on `PATH`.
- `SHIP_CHECK_JS_ENTRY` (for website scans): the **absolute path** to the installed npm package's `index.js`, for example `/usr/local/lib/node_modules/@good-ship/ship-check/index.js`. On Windows use the equivalent absolute path from your npm global directory. This must be the **Node.js entrypoint**, not a compiled native binary or `.cmd` shim.

Why a separate website entry? Website requests must run with the guarded Node HTTPS transport from `playground/lib/public-site-fetch-guard.cjs`. It validates public DNS answers **at socket connection time** and pins the actual connection to an approved public IPv4 address. A compiled native scanner may ignore the Node guard and is deliberately refused.

### Tools

| Tool | Purpose |
| --- | --- |
| `ship_check_version` | Show what the installed scanner actually reports and (when configured) its npm package version; flags a mismatch |
| `ship_check_daily` | Existing cached, bounded security assessment |
| `ship_check_project` | Local source scan, coverage, bounded findings and discovered AI/CMS inventory |
| `ship_check_technologies` | Source-declared AI models and CMS components only; distinguishes incomplete/unknown inventories |
| `ship_check_github_repository` | Explicitly permitted public GitHub owner/repository scan, with bounded findings and technology discovery |
| `ship_check_website` | Public HTTPS evidence and WordPress/Drupal hints using the same scanner with socket-level safeguards |

**Networking and consent:** Source scans are local by default. Set `networked: true` for optional package-advisory lookups. Public GitHub repository and website scans require an explicit `confirmExternalRequest: true` per invocation and are limited to public HTTPS hostnames. Never use them against private/internal targets or websites you are not authorised to test. Only low-impact public metadata and the bounded runtime scanner are collected.

### Optional Cloud monitoring from local MCP

Cloud monitoring is **off by default**. It takes two separate permissions:

1. The user configures `SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE=1` and a user-created `SHIP_CHECK_CLOUD_TOKEN` with the **history:sync** scope in the MCP process environment. Never supply a token as a tool argument or commit it to a file.
2. The user explicitly approves `monitor: true` in the particular `ship_check_project`, `ship_check_github_repository` or `ship_check_website` invocation.

If either requirement is missing, the MCP tool refuses the upload. When enabled, the canonical CLI sends only the approved source-free scan summary and recognised technology identifiers; no full report or source code. The tool never changes repository files.

## 2. Cloud MCP — query your existing monitoring and history

Endpoint: `https://cloud-check.good-ship.co.uk/mcp` (authenticated Streamable HTTP, bearer token with `history:read` scope).

Cloud MCP is **read-only**, and every project lookup is checked through the Cloud history service before reading account-scoped monitoring data. It exposes:

- `ship_check_list_projects`, `ship_check_get_project_status`, `ship_check_get_project_history`, `ship_check_get_coverage`, `ship_check_get_attention_changes`.
- `ship_check_get_monitored_technologies` — manual, source-declared and connector-reported installed components, with distinct provenance and publicly inferred CMS hints.
- `ship_check_list_technology_notices` — active, matched model-retirement/security notices (bounded to 50), provider feed health and caveats about missing intelligence.
- `ship_check_get_mcp_version` — version of the deployed Cloud MCP server, **not** the scanner installed on a local machine.

A Cloud bearer token is not general OAuth authorisation. The remote Cloud MCP is intended for explicitly configured trusted clients using dedicated scoped tokens; delegated OAuth discovery/consent is future work. It cannot run arbitrary new scans, install CMS connectors, inspect source files or automatically update the local CLI.

### Version checks

Use the local `ship_check_version` tool to determine the **installed executable**. An agent can have an up-to-date MCP server adaptor but still invoke an older scanner. Cloud MCP exposes the currently deployed Cloud app version and the last recorded scan's scanner version, where known. A successful npm publication never updates every existing MCP client automatically.

The next npm/desktop Alpha 14 release corrects an older reporting bug where the published Alpha 13 package identified its scanning engine as Alpha 12. Release checks now require the packaged CLI version to match `package.json` to prevent recurrence.

### Limitations

- A source-declared model isn't proof of deployment, and a public WordPress/Drupal fingerprint cannot identify private installed plugins.
- Installed website components come only from a paired connector, and their versions are still connector-reported.
- Provider feeds can be incomplete, stale or unavailable; no matching notice is not a safety guarantee.
- Local MCP stdio compatibility, Windows npm entrypoint paths and full client-to-Cloud monitoring need practical pilot verification before calling the interface generally available.
