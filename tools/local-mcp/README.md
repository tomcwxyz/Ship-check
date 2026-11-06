# Ship Check local MCP (experimental)

This is a **local stdio MCP adaptor** for the canonical Ship Check CLI, not another scanner and not the proposed hosted Cloud MCP API. It runs inside a coding agent's process boundary and returns bounded review summaries, not source files or raw finding evidence.

## Install

1. Install a pinned Ship Check CLI version and check that `ship-check --version` works.
2. From `tools/local-mcp`, run `npm install` and `npm test`.
3. Configure an MCP client to launch `node /absolute/path/to/Ship-check/tools/local-mcp/server.mjs`, with `SHIP_CHECK_PROJECT_ROOT` set to the project directory and `SHIP_CHECK_BIN` set to the installed CLI path if it is not on `PATH`.

The official MCP TypeScript SDK v2 provides the stdio server. Dependencies are deliberately kept in this opt-in adaptor rather than added to desktop and npm CLI installs.

Two read-only tools are available: `ship_check_daily` (24-hour cached lightweight status) and `ship_check_project` (fresh bounded project findings, gaps and coverage). Both only allow paths under the configured project root, refuse shell execution and default to **no advisory network access**. Set `networked: true` in a tool call only with the user's permission: OSV receives package names/versions, while CISA and FIRST receive CVE IDs. Responses go to the requesting agent, so review the agent/provider's own data policy.

No Cloud API, tokens, package fixing, code writes or remote control are exposed. Host/client compatibility and native Windows behaviour require pilot testing before a general release.
