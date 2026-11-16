# CMS connectors (initial WordPress pilot)

This is a first implementation, not a published WordPress.org plugin or a Drupal module.

## How it works

1. In a signed-in Ship Check Cloud project, choose **Generate WordPress pairing code**.
2. Download the WordPress plugin directory at `integrations/wordpress/ship-check-connector` as a ZIP with `ship-check-connector.php` at the root folder. Upload it via WordPress **Plugins → Add Plugin → Upload Plugin** and activate it.
3. Go to **Tools → Ship Check**, paste the one-use pairing code and connect.
4. WordPress sends an inventory on the next scheduled job and daily thereafter. Installed inactive plugins and themes are included.

Only core/plugin/theme identifiers, declared versions and active state are sent. No site URL, source, passwords, user accounts or content are sent. Pairing tokens expire after 10 minutes and are consumed once; connector tokens are stored as SHA-256 hashes in Cloud. Transport is HTTPS, outbound only. Cloud matches these components to existing CMS security advisories.

**Pilot limitations:** This connector has not yet been tested against a real WordPress site. Drupal pairing is supported by the server API but a Drupal module has not yet been built. Cloud-side connector revocation, WordPress sync health/retry display and site ownership verification beyond admin plugin installation need completing before a public release. Do not distribute the connector publicly until these are addressed.

WordPress WP-Cron depends on site traffic unless a real cron job is configured. A daily schedule is a reconciliation, not an immediate guarantee of update detection. Public advisory feeds are not proof of exploitability.
