# Ship Check Cloud: technology monitoring pilot

## Scope of this implementation

Cloud can now store a **separate, per-project, opt-in** component inventory, refresh AI model retirement notices daily and show matching notices on the relevant Cloud project page. Source and normal assurance-history metadata are unchanged. The monitoring inventory contains only component kind, identifier, optional version and evidence provenance; no source files or tokens.

Each project page provides an explicit enable action, inventory editor, active notice list and stop-and-delete action. Manual entries are **source-declared** and must not imply live usage. The service does not send emails or perform upgrades.

**AI feeds implemented**

- OpenAI: authenticated GET https://api.openai.com/v1/models, using optional shutdown_date with no inference from an absent model. Requires a dedicated server-side SHIP_CHECK_OPENAI_MODELS_API_KEY.
- Anthropic: public official model-status HTML table. Only exact rows whose status is Deprecated or Retired and which have an explicit calendar retirement date are considered. Active models and tentative *not sooner than* dates are not retirement warnings. Unexpected HTML or HTTP errors fail closed.

Both adapters use fixed upstream hosts, bounded response sizes, timeouts and explicit fetch errors. Failures do not resolve existing alerts. Notice matching uses the shared canonical Cloud matcher and deduplicated identities. Cloud refreshes have no access to repository source.

**CMS intelligence (new):** Drupal reads official security RSS feeds and identifies exact module machine names, but does not infer affected version ranges. WordPress receives signed incremental Wordfence Intelligence updates after its separate webhook is configured; it does not backfill historical vulnerabilities. See [CMS integration and setup](./CLOUD_CMS_INTELLIGENCE.md). Neither integration proves what is installed in production.

## Deployment steps (feature remains disabled by default)

1. Review and apply migrations/cloud/0003_technology_monitoring.sql to the **existing** Cloud Postgres database. Do not create a new database or branch.
2. Configure Cloud production environment: SHIP_CHECK_TECH_MONITORING_ENABLED=1; CRON_SECRET (at least 24 random characters, Vercel schedules add the Bearer token); SHIP_CHECK_OPENAI_MODELS_API_KEY (optional for deployment but required for OpenAI feed; no browser access).
3. Deploy apps/cloud. Vercel cron is configured for 06:15 UTC every day. To exercise manually, use the server-protected /api/cron/technology endpoint with the scheduler token; never put the token into browser code or commit it.
4. Log into Cloud, open a project, add an exact model ID (e.g. gpt-5), and explicitly enable monitoring.
5. Run an authorised daily check, then confirm the provider checked-at timestamp and source-linked matching notice. Test a second identical refresh to verify the alert is updated rather than duplicated.
6. Check access isolation with another Cloud account; verify that stopping monitoring deletes its component and alert records, while scan history remains untouched.

Feature-disabled deployments must return HTTP 503 for the new monitoring APIs and hide the project-level controls. This prevents a partially migrated deployment from exposing broken controls.

## Limitations, next work

- Inventory can be entered manually or imported client-side from Composer lockfiles, WP-CLI plugin JSON and minimal Ship Check inventory JSON, then explicitly saved. Automatic CI inventory sync remains future work. Do not silently send source-derived model IDs through the existing assurance-metadata/0.1 sync.
- No per-project provider key input. The single server-side OpenAI key determines which models are visible through the provider API; a missing model is not evidence it has been retired or is safe.
- Anthropic HTML scraping is inherently less reliable than an official machine-readable feed. The parser fails closed and reports an error state if the table cannot be verified.
- Model aliases, provider gateways and hosted variants may have different lifecycles. Verified runtime use requires a separate authenticated integration.
- Some Wordfence numeric-version comparisons are supported; unsupported versions and all Drupal RSS version impacts remain unverified. Historical Wordfence backfill, installed-component connectors, notification channels, dashboard roll-ups, alert acknowledgements and MCP details remain follow-on work.
- The daily refresh has a hard limit of 2,000 component entries to prevent unbounded workload; it reports an incomplete run rather than silently skipping records.
- The implementation currently shows matched notices **inside Cloud**, not by email/push notification.
