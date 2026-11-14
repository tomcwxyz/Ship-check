# Cloud CMS intelligence: Drupal RSS and Wordfence signed updates

## Changes

Cloud monitoring now includes source-linked Drupal security advisories and an optional Wordfence Intelligence webhook receiver for WordPress core/plugins/themes. This builds on the already opt-in per-project component inventory and provider status tracking.

**Drupal:** The scheduler checks Drupal's official contributed-project and core security RSS feeds. Only an explicitly present machine-name in a contributed advisory can match a drupal/package. The feed does not establish which **versions** are affected, so a match is always a **needs-verification** alert, not a confirmed vulnerability. RSS changes, HTTP errors or missing project identifiers fail closed and are recorded as incomplete rather than safe.

**WordPress:** Wordfence Intelligence offers a free commercial-use webhook. The receiver is `POST /api/intelligence/webhooks/wordfence`, protected by HMAC-SHA256 using the `X-Wordfence-Signature` header and a project-level secret. This avoids repeatedly downloading Wordfence's very large database export. It stores only the minimal advisory ID, affected component slug, title, version bounds and canonical Wordfence source link. Full webhook payloads and secrets are not stored. New/replaced/deleted records are handled idempotently.

Version comparison is deliberately conservative: plain dotted numeric versions can be compared to inclusive bounds; unknown, pre-release or unsupported version formats stay **needs-verification**. A source version in an affected range is still only a **source-level** finding, not verification of a deployed installation.

No email alerts or automatic fixes are added.

## Required deployment configuration

1. Apply migration `migrations/cloud/0004_wordfence_intelligence.sql` to the **existing** Cloud Postgres database before deploying this feature.
2. Drupal needs no key. The next configured Cloud cron refresh will attempt the official feeds and store provider checked-at/error status.
3. For WordPress: create a Wordfence account, go to Account → Integrations → Add Webhook, use raw JSON notifications, and configure URL `https://cloud-check.good-ship.co.uk/api/intelligence/webhooks/wordfence`. Generate a unique random secret of at least 32 characters and set it in the Wordfence webhook and the Vercel production environment as `SHIP_CHECK_WORDFENCE_WEBHOOK_SECRET`. Redeploy after setting it. Never enter the secret into Ship Check project settings or source control.
4. Wordfence only streams **new changes after setup**. It does **not** backfill historical vulnerabilities. Until we implement an approved initial backfill, report coverage as partial. A webhook update must not be treated as a full installed-site audit.
5. For a monitored Cloud project, select local `composer.lock`, a JSON export from `wp plugin list --format=json`, or a prepared Ship Check inventory JSON in the **Import a component list** section. Data is reduced to component ID/version on the client; the original file stays in the browser. Review and explicitly choose Save to opt in. Avoid uploading full repository files through any other Cloud API.

## Important lifecycle caveats

- Cloud's model retirement monitors are independent: OpenAI requires `SHIP_CHECK_OPENAI_MODELS_API_KEY` to query its official model metadata; missing credentials are not a successful check.
- WordPress Wordfence and Drupal advisories do **not** imply a site is vulnerable without matching installed versions, exploit preconditions and deployment verification.
- Drupal RSS and Wordfence webhooks are separate data delivery approaches; the WordPress provider's last received notification timestamp is not proof its database has been fully checked.
- The legacy `assurance-metadata/0.1` CI history sync remains source-free. No component inventory is uploaded without explicit user interaction.
- Alerts are in-app only. Future work: authenticated webhook health verification, baseline Wordfence backfill, optional per-project email notifications, component version tracking from consented CI, source-vs-runtime reconciliation, acknowledgement and resolution history.

## Verification

Run `pnpm check && pnpm test && pnpm build`. Manually test with a signed synthetic Wordfence payload and a compromised signature, then test the authorised Drupal refresh, per-project isolation, a source-declared version match, repeated delivery and deletion. No real Wordfence event should be injected without its official webhook secret.
