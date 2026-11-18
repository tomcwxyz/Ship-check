# Ship Check Cloud monitoring

Cloud is the optional home for source-free scan history and ongoing notices about technologies recognised by Ship Check.

**Cloud:** https://cloud-check.good-ship.co.uk

## One process, whichever scanner you use

1. **Scan.** Use the Ship Check CLI, npm/npx, Desktop, or the public Playground. The shared scanner identifies source-declared AI models and recognisable WordPress/Drupal components when the source includes that evidence. Public website scans can identify likely CMS technology from non-invasive metadata, but cannot identify a complete installed plugin list.
2. **Choose to keep it monitored.** This is never automatic or implied by running a scan. Monitoring is optional.
3. **View your project in Cloud.** Cloud retains a source-free assurance summary and a small list of known technology identifiers. Its independent provider checks can surface relevant model retirement/security notices without a GitHub Action or a new scan.
4. **Re-scan when the code changes.** Cloud monitors technologies it already knows about. It does not continuously pull or rescan private code; a new scan is needed to refresh source-declared technologies.

### CLI / npm

Once a scanner release containing the unified monitoring feature is installed:

```bash
# Scanning itself remains free, offline by default, and needs no account
npx --yes @good-ship/ship-check@alpha scan .

# Explicitly connect the scan to Cloud and enable technology monitoring
# Create an 'Upload scan summaries' token in your Cloud dashboard first.
# Store it privately; never include it in shell arguments, source or log files.
export SHIP_CHECK_CLOUD_TOKEN="your-token-from-cloud"
npx --yes @good-ship/ship-check@alpha scan . --monitor
unset SHIP_CHECK_CLOUD_TOKEN
```

The official Cloud URL is the default. Use `--cloud-url` only for a deliberately chosen environment. To monitor a report you've already saved: `ship-check cloud publish ./review.json --monitor-technologies`.

### Desktop

Sign in to Cloud in your browser and create an **Upload scan summaries** token. Enter it in Desktop's Cloud connection section; Desktop stores it in your operating system credential store. Run a scan, select **Keep discovered technologies monitored**, and choose **Send to Cloud**. Neither storing a token nor running a scan uploads anything automatically.

### Public Playground

On a compatible published scanner build, the scan results offer **Keep this monitored**. That opens the Cloud handoff in your browser; you sign in and approve the minimal inventory. The Playground never sends full reports or repository source to Cloud. Public URL scanning remains gated off until sandbox IPv6 and DNS rebinding protections are verified.

### WordPress / Drupal websites

A public website scan may say *Likely WordPress* or *Possibly Drupal*. This is a hint, not an installed-software inventory and not a vulnerability result. Site administrators who want ongoing monitoring of actual installed versions can optionally install the small outbound-only connector. Download WordPress/Drupal connector ZIPs from the Cloud website and pair with a ten-minute, one-use code; **no GitHub Actions are required**. See [CMS connector guide](CMS_CONNECTORS.md). Both connectors still need live-site integration validation before broad distribution.

## What Cloud stores

- Account-scoped, pseudonymous project identity, scan identity, assurance counts and coverage;
- Recognised model IDs, CMS component IDs and optional declared versions, with source-declared provenance;
- Public CMS hints separately from verified installed components;
- Advisory matches, timestamps and provider health information;
- WordPress/Drupal connector inventory only if an administrator installs and pairs the connector.

It does **not** receive source files, raw report evidence, secret values, full file paths or dependency source text. These distinctions matter: a source declaration doesn't establish active production use; a website fingerprint doesn't identify installed plugins; no matched notice doesn't mean everything is secure.

## Optional automation for experienced users

Existing CI/GitHub Actions history and technology synchronisation are still supported, but **not part of the normal onboarding path**. See [advanced scan synchronisation](CLOUD_AUTO_DISCOVERY.md). Cloud's provider-intelligence refresh is separate from repository CI.

## How to stop

Cloud project monitoring can be disabled from the project page. This removes stored technology inventories and related notices, revokes paired CMS connector credentials, and leaves historical source-free scan summaries intact. A local Desktop credential can be forgotten independently; revoke the token in Cloud to disable its server-side access.
