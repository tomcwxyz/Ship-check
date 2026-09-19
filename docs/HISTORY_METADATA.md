# Project history metadata

Ship Check has a portable **assurance metadata** envelope for project history and future cloud/control-plane sync without requiring source code, finding detail or evidence excerpts to leave the execution environment.

Generate it directly from the CLI:

```bash
ship-check scan ./my-project --format metadata
```

The GitHub Action also writes it alongside the full report by default:

- full report: `.ship-check/report.json`
- metadata sidecar: `.ship-check/metadata.json`

These files have deliberately different trust boundaries. The full report can contain bounded finding titles, remediation and evidence. The metadata sidecar cannot.

## What the metadata contains

The `assurance-metadata/0.1` shape records:

- an opaque SHA-256 project identity;
- a deterministic SHA-256 scan-event identity;
- engine version and `check-ruleset-v1` fingerprint;
- selected packs and total check count;
- sanitised evidence-source provenance: type, provider, acquisition, execution location and capabilities;
- aggregate source fingerprint/completeness when one exists;
- Git commit identity when one exists;
- counts by finding severity plus suppressed, unanswered, resolved, observed, not-assessed and errored checks;
- coverage area/status/check count;
- optional bounded change counts for a comparable baseline.

It does **not** contain:

- local filesystem paths;
- repository names/URLs or raw project-source IDs;
- Git refs/branch names;
- deployment URLs or query strings;
- database connection details;
- finding, suppression, gap or observation IDs;
- finding/gap/observation titles or summaries;
- evidence paths, excerpts or details;
- remediation text or accepted-risk rationales;
- detected secret values.

The schema is strict so those fields cannot be accidentally added to the envelope.

## Project identity

By default Ship Check derives a `project-source-v1` SHA-256 identity locally from the primary evidence source and only emits the digest.

GitHub repository identities are canonicalised so CLI and CI acquisition of the same `owner/repository` converge. CI monorepo paths such as `owner/repository:packages/app` remain distinct projects.

Runtime identities use canonical origin + pathname and discard query/fragment data before hashing. A rotating signed/tokenised URL therefore does not create a new project identity merely because the query string changed.

Programmatic consumers may supply a `projectIdentityKey` to `toProjectHistoryMetadata()`. This lets an existing control-plane project record associate different evidence routes with the same project. The supplied key itself is never emitted.

A SHA-256 project identity is **pseudonymous, not anonymous**. A party that can guess the original locator may be able to test guesses. A future hosted account/project ID should therefore be preferred where stronger unlinkability is required.

## Scan identity

`scan-event-v1` is deterministic. It includes the opaque project identity, generated-at time, engine/ruleset provenance, source fingerprint state, commit, packs and aggregate counts.

Exporting the same report twice therefore produces the same scan identity, which makes future ingestion idempotent. A genuinely new scan produces a different identity while retaining the project identity.

## Change metadata

A history event may optionally carry aggregate change counts:

- new, persistent, reactivated, newly accepted and no-longer-active findings;
- new, persistent and no-longer-active unanswered controls;
- newly observed, persistent and no-longer-observed inventory surfaces;
- changed / unchanged / partial-uncertain / unknown source snapshot state.

Every change block declares both its baseline basis and its scope.

The GitHub Action currently records PR comparison as:

```text
basis: pull-request-base
scope: source
```

That is intentional. A PR source comparison does not claim to compare a historical live deployment even when the current scan also includes runtime evidence.

“No longer active” remains a scan-state transition, not proof that a control was remediated.

## GitHub Actions

Override the metadata sidecar location when needed:

```yaml
- uses: tomcwxyz/Ship-check@<pinned-ref>
  with:
    metadata-path: .ship-check/metadata.json
```

The path must remain inside `GITHUB_WORKSPACE` and must differ from the full report path.

On pull requests, a successful exact-base source comparison is converted into the optional source-scoped change block. If comparison is unavailable, the current scan metadata is still produced without inventing a delta.

Persisting or sending either file anywhere is a separate workflow choice. Ship Check does not upload the sidecar to a Good Ship service in this implementation.

## Future control-plane use

This envelope is intended to be the narrowest sync level for a future Ship Check control plane:

1. local only — no sync;
2. assurance metadata — this envelope;
3. structured findings — separate, more permissive contract;
4. bounded evidence — separately authorised;
5. managed scan — separate execution/retention boundary.

The metadata contract does not itself implement accounts, networking, retention or deletion. Those controls remain prerequisites for a private-project cloud pilot.
