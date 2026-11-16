# CMS connectors (initial WordPress pilot)

This is an initial implementation of both a WordPress plugin and a Drupal module. Neither is publicly released or verified against a live CMS installation.

## How it works

1. In a signed-in Ship Check Cloud project, choose **Generate WordPress pairing code**.
2. Download the `ship-check-wordpress-connector.zip` package from the **Package CMS connectors** GitHub Actions run for the tested commit. Upload it via WordPress **Plugins → Add Plugin → Upload Plugin** and activate it.
3. Go to **Tools → Ship Check**, paste the one-use pairing code and connect.
4. Use **Sync now** for an immediate inventory. WordPress also sends an inventory on the next scheduled job and daily thereafter. Installed inactive plugins and themes are included.

Only core/plugin/theme identifiers, declared versions and active state are sent. No site URL, source, passwords, user accounts or content are sent. Pairing tokens expire after 10 minutes and are consumed once; connector tokens are stored as SHA-256 hashes in Cloud. Transport is HTTPS, outbound only. Cloud matches these components to existing CMS security advisories.

## Drupal pilot\n\nPlace the `integrations/drupal/ship_check_connector` directory into your Drupal project's `web/modules/custom` directory (or the corresponding modules path), deploy it, enable **Ship Check Connector** in Extend, and open **Configuration → System → Ship Check Connector**. Generate a pairing code from your Ship Check Cloud project and paste it into Drupal. Use **Sync now** for the first inventory; Drupal cron will subsequently reconcile daily. The module reports Drupal core and contributed project identifiers where extension metadata provides a reliable `project` and `version`; it deliberately does not infer Composer package versions where that mapping is uncertain.\n\n**Pilot limitations:** Neither connector has yet been tested against a real WordPress or Drupal site. Cloud-side connector revocation is available from the project dashboard. WordPress sync health/retry display and site ownership verification beyond admin plugin installation need completing before a public release. Both connectors need packaging, automated CMS integration tests, retry/backoff, and a final security review. Do not distribute the connector publicly until these are addressed.

WordPress WP-Cron depends on site traffic unless a real cron job is configured. A daily schedule is a reconciliation, not an immediate guarantee of update detection. Public advisory feeds are not proof of exploitability.

## Downloading pilot packages

The [Package CMS connectors workflow](https://github.com/tomcwxyz/Ship-check/actions/workflows/cms-connectors-package.yml) validates PHP syntax and creates both installable ZIP files as downloadable workflow artefacts. Open the successful workflow run for the intended commit and download the `ship-check-cms-connectors` artefact. These packages are not yet published to the WordPress or Drupal plugin directories.
