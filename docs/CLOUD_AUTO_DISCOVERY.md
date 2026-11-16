# Automatic technology discovery — Ship Check Cloud

Ship Check can automatically discover statically declared AI models and WordPress/Drupal components **during an existing source scan**. It does **not** require you to list models or plugins in Cloud.

## What is discovered

- Model IDs from source assignments and AI SDK calls, including models with a provider retirement notice and models without one
- WordPress core and plugin/theme identifiers and versions found in source headers
- Drupal `drupal/*` package IDs and versions from `composer.lock`

This is a bounded *source-declared inventory*, not proof that the model is selected at runtime, or that the CMS package is installed in production. Environment-variable model selection and external gateways may need separate authorised integration. Checks must complete against a complete source inventory; partial scans fail closed.

## Enable it

1. Visit the signed-in [Cloud dashboard](https://cloud-check.good-ship.co.uk/dashboard), select a connected project, and choose **Enable automatic discovery**. This sets per-project consent and does not send any source.
2. Use an existing Cloud **Upload scan summaries** token with `history:sync` permission, stored as a GitHub Actions secret (never hard-code it). The repository needs the existing Cloud history connection first.
3. In the calling repository's workflow, explicitly set `cloud-technology-sync: "true"`:

```yaml
- uses: tomcwxyz/Ship-check@main
  with:
    path: "."
    packs: "secure-build,production-ready,cost-aware"
    cloud-url: https://cloud-check.good-ship.co.uk/
    cloud-token: ${{ secrets.SHIP_CHECK_CLOUD_TOKEN }}
    cloud-technology-sync: "true"
```

Use a reviewed, pinned action commit SHA in long-lived production workflows rather than a floating `@main` reference. This example shows the input contract only.

The action uploads existing source-free history metadata as before, then extracts a minimal, strict component list from the full report **on the GitHub runner**. It sends only:

```json
{
  "schemaVersion": "ship-check-technology-inventory/0.1",
  "components": [
    {"kind":"ai-model","id":"gpt-5","evidence":"source-declared"},
    {"kind":"wordpress-plugin","id":"akismet","version":"5.4","evidence":"source-declared"}
  ]
}
```

No file paths, source text, code excerpts, repository URLs or complete reports are uploaded. The payload is limited to 50 components/12 KB. The destination project must belong to the account that issued the token.

## Consent and update semantics

- **Both** explicit switches are required: Cloud per-project automatic discovery and GitHub Action `cloud-technology-sync: "true"`.
- Normal Cloud history sync does not start technology monitoring.
- Previously issued `history:sync` tokens do not enable discovery by themselves; disabling the project switch makes sync return a conflict.
- Each complete scan replaces its *automatically discovered* component records. Manual entries are stored separately and are not overwritten.
- If a complete scan identifies no matching components, it clears outdated discovered entries, without deleting manual entries or the project's scan history.
- Turning automatic discovery off deletes only discovered components; **Stop all monitoring** deletes the monitoring consent, manual components and relevant alerts. Remove the GitHub Action input to stop subsequent CI attempts.
- Existing site data in Cloud is never used to infer that a deployed dependency is safe.

## Limitations

- This initial integration supports the GitHub Action, not automatic GitHub repository access from Cloud. Local Desktop opt-in discovery is next.
- The component inventory is limited to identifiers, an optional version and source evidence provenance; it deliberately omits secret values, repository metadata and file paths.
- If more than 50 technologies are found, or a scan is incomplete, the sync fails rather than silently truncating or deleting valid entries.
- Wordfence Intelligence webhook is connected separately and existing updates are stored. A full historical Wordfence backfill still needs a licensed/approved API process.
- OpenAI model checks require `SHIP_CHECK_OPENAI_MODELS_API_KEY`, and the key's functionality should be verified by the next successful server-side refresh. Anthropic and Drupal feeds have independent health/error reports.
