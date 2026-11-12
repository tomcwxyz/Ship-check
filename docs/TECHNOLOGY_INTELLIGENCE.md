# Technology lifecycle intelligence — initial implementation

## Current behaviour

Two checks are added to the shared production-ready scanner:

- production.ai-model-lifecycle recognises source-declared model IDs from common configuration and AI SDK call patterns. Exact IDs are compared with a manually reviewed provider retirement snapshot checked on 12 November 2026. It reports affected models with the official retirement date, source and verification guidance. Runtime usage is always unverified.
- production.cms-component-inventory recognises WordPress core/plugins/themes from source and Drupal core/contributed packages from composer.lock. It records versions as observations, not verified installed versions, and reports missing live vulnerability intelligence as an assessment gap.

The Cloud runtime exports matchIntelligenceNotices, a pure function for matching an explicitly consented minimal component inventory against trusted advisory notices. It compares exact IDs and exact affected versions, records stale feeds and missing version information, and produces stable SHA-256 match identities to support eventual deduplicated alert delivery.

**Not yet live:** hosted inventory persistence, feed fetching, recurring Cloud jobs, portfolio notices, email alerts, or MCP advisory tools. Current CI sync remains metadata-only and cannot be used to infer an installed component inventory.

## Trust boundaries

- Source declarations do not prove deployed use. An AI model might be overridden, aliased or routed via a different provider. CMS source contents need not match the deployed site.
- The bundled provider intelligence is a dated snapshot, not a live feed. Source-linked findings should not imply up-to-the-minute provider status.
- WordPress and Drupal source inventory does not automatically establish vulnerability. Unverified means not checked, not safe.
- Feed adapters should normalise and validate advisory ranges with ecosystem-specific parsers. The initial Cloud matcher deliberately compares exact versions only; arbitrary semver ranges are not supported.
- No secrets, source excerpts, source files or API credentials should enter Cloud inventory storage.
- No external network calls, automatic fixes or outgoing alerts are introduced by these new modules.

## Data sources and expansion

1. OpenAI deprecations: https://developers.openai.com/api/docs/deprecations — and authorised Models API shutdown_date.
2. Anthropic model deprecations: https://platform.claude.com/docs/en/about-claude/model-deprecations
3. WordPress/Wordfence security intelligence, subject to API terms, credentials and quotas.
4. Drupal security advisories: https://www.drupal.org/security — together with Composer/OSV data.

## Cloud implementation gates

1. Add a separately consented, account-scoped and versioned component inventory; expose export, deletion and retention controls, distinct from existing assurance-metadata/0.1.
2. Build authenticated, bounded intelligence feed adapters with provider attribution, source timestamps, freshness and error states.
3. Refresh intelligence on an independent schedule, so a new advisory can create an alert without waiting for a repository commit or a scan.
4. Persist account-scoped advisory matching history, deduplicate stable notice identities and track new/repeat/resolved/unknown states.
5. Add useful dashboard alerts, optional email delivery and read-only MCP advisory tools; keep evidence confidence and checked-at timestamps visible.
6. Dogfood on representative WordPress and Drupal sites, projects using dynamic or routed AI models and real Cloud authentication/isolation paths before enabling production monitoring.

## Verification commands

From the repository root:

- pnpm install --frozen-lockfile
- pnpm --filter @ship-check/checks check
- pnpm --filter @ship-check/checks test
- pnpm --filter @ship-check/cloud-runtime check
- pnpm --filter @ship-check/cloud-runtime test
- pnpm check
- pnpm test

A normal source scan exercises the new checks: pnpm ship-check -- scan /path/to/project.
