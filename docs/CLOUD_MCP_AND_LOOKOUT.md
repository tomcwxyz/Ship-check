# Ship Check Cloud: MCP and Lookout integration design

**Status:** Proposed interface and trust contract, **not** a deployed MCP server. Ship Check Cloud currently persists only deliberately synced `assurance-metadata/0.1` counts, coverage, provenance and change metadata. Its normal browser authentication, hosted project dashboard and operational shared rate limiter are not yet ready.

## Product promise

People should be able to ask their own AI agents:

- "Which projects have new Ship Check concerns since last week?"
- "What changed in this project's checks?"
- "Which areas weren't inspected? When was the last assessment?"
- "Which projects need a new scan because evidence is old?"
- "What does Ship Check know about these dependencies?" (**future**: requires separate structured advisory metadata, not available in the present Cloud store.)

These answers must distinguish a **finding**, an **unverified question**, a **verified control**, general **inventory observation**, **unassessed coverage** and **missing or stale evidence**. Never render an aggregate safety score or infer deployed protection from a quiet source scan.

## Protocol and access

- Build an authenticated, dedicated **remote Streamable HTTP MCP endpoint**, conceptually `https://<cloud-host>/mcp`. Use the current MCP 2026-07-28 protocol and the maintained **TypeScript SDK v2** once implementation begins (older v1 examples may use outdated GET/session behaviour). Stateless JSON responses suit the initial read-only tools.
- Implement OAuth 2.1 compatible delegated authorisation with discovery, Protected Resource Metadata, issuer/audience/resource validation, PKCE and per-user consent. Never accept a different service's access token or pass user tokens through to GitHub, Vercel or Lookout.
- A valid user session is **not** an authorisation grant to all hosted projects. Every call resolves the authenticated account, project ownership and tool scope at the service/data boundary.
- Initial tools are strictly read-only and require a scoped capability such as `assurance:read`. Avoid reusing `history:sync` as read authority. Existing internal bearer `history:read` can inform the authorisation model, but **is not itself MCP OAuth**.
- Restrict origins; enforce per-account and per-token durable rate limits; constrain input/output sizes, date windows and pagination; use no-store, audit only opaque action metadata and never return raw source, credentials or unconsented evidence.
- Tool responses include `asOf`, `scanGeneratedAt`, `ingestedAt` if available, provenance, ruleset identity and `completeness`/coverage so agents can explain staleness and uncertainty. Unavailable does not mean zero.

## Read-only tool plan

| Tool | Initial Cloud evidence | What it must NOT assert |
| --- | --- | --- |
| `ship_check_list_projects` | Account-scoped project directory, opaque IDs, optional user-assigned display names, latest metadata time/counts | All repositories are monitored |
| `ship_check_get_project_status` | Latest findings/gaps/error counts, evidence source capabilities, coverage and freshness | No findings = safe |
| `ship_check_get_project_history` | Bounded timeline, engine/ruleset continuity and explicit aggregate changes | Every disappearance was repaired |
| `ship_check_get_coverage` | Assessed/partial/not-assessed areas and last scan provenance | All relevant controls were checked |
| `ship_check_get_attention_changes` | Only recorded comparison counts and errors; allow null/unknown | Specific CVEs or finding titles exist in summary-only storage |

**Later, after separately authorised structured-finding storage:** add a bounded `ship_check_get_finding`, `ship_check_list_new_advisories` and `ship_check_get_verified_controls` that cite their check, evidence provenance and recheck status. The initial metadata-only Cloud cannot honestly supply detailed finding IDs/titles, package inventories or confirmation of exploitation.

For each tool: deterministic schema, stable field names, cursor-based pagination, transparent truncation, rate/resource bounds, provenance/source links only after explicit locators are separately authorised, and fixture tests for partial scans, unknown status, stale rulesets and unrelated tenant IDs.

## Integrating with Lookout

Lookout currently exposes read-only tool concepts such as listing projects, project handover/context, open attention, and infrastructure status. Ship Check can complement these rather than duplicating them:

- **Lookout:** which repositories, PRs, branches, CI and deployments are changing, and what an agent has reported.
- **Ship Check:** which bounded security/cost/assurance checks ran; when; with what coverage; what needs checking and which verified controls have evidence.
- **Combined agent:** "Which recently deployed projects have new Ship Check findings or are overdue for a recheck?"

Integration should use a separate **consented, account-scoped project link** (e.g. a Lookout project identifier mapped to a Ship Check opaque project UUID), not guess a link from a coincidentally similar display name. Store mapping only with the user's approval.

Two viable stages:
1. **Agent orchestration without a deep product integration:** the user connects both tools to their AI agent; the agent reads both data sources and reports a comparison, preserving evidence provenance and no destructive actions.
2. **First-party Lookout connector:** Lookout calls account/project-scoped Ship Check APIs using an audience-bound authorisation grant, caches bounded aggregate history, and links back to source-of-truth records. Ship Check continues to own scan results and assurance semantics; Lookout owns portfolio attention and work signals.

Do **not** make Lookout receive Ship Check's raw scanner inputs, token secrets or full unconsented evidence by default. Avoid circular refresh jobs between both services. Let either service be used independently.

## Dependencies before launch

1. Deploy Cloud with real Postgres and migrations, normal account sessions, project access controls and operational rate limiting; exercise deletion/retention.
2. Add trustworthy, user-visible project history and a clear consent flow for optional CI/desktop metadata sync.
3. Build a small read-only domain adapter over the existing Cloud history service; test account isolation and comparison completeness.
4. Expose the current authenticated Streamable HTTP MCP endpoint, OAuth discovery and scoped tools; test in at least two independent MCP clients/agents.
5. Establish optional account consent and explicit project mapping with Lookout.
6. After adding structured advisory history and proper scheduling, expose detailed new-vulnerability tools and alert subscriptions.

## Useful sources

- MCP 2026-07-28 Streamable HTTP transport: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- MCP 2026-07-28 auth: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx
- Current TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/

**This document reserves interface names; there is intentionally no unauthenticated `/mcp` route, stub response or broadly scoped token in production today.**
