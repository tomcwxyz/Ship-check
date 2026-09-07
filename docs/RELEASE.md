# Alpha release approach

Ship Check follows the release discipline already used by RACK and TOPO rather than inventing a separate operational model.

## Now

The first alpha is CLI/core only. Pull requests and `main` run Linux validation. Work should land as coherent review batches rather than a stream of tiny commits that repeatedly trigger CI.

## Desktop alpha

When `apps/desktop` lands, add two release paths matching the existing family:

1. **Windows test installer** — automatically from current `main`, unsigned, draft pre-release, clearly numbered by workflow run. This is the normal hands-on test artefact after each coherent alpha change.
2. **Local alpha release** — manually dispatched from `main`, requires explicit `ALPHA` confirmation and a source-matching version, reruns validation, then builds Windows x64, Linux x64 and macOS Apple Silicon packages as a draft pre-release.

The macOS alpha is built natively on an Apple Silicon GitHub runner and packaged as a `.dmg`. It uses ad-hoc code signing rather than an Apple Developer ID and is not notarised, so macOS may require the tester to approve the app in Privacy & Security. Proper Developer ID signing, notarisation and any Intel/universal build are pilot-readiness work rather than alpha blockers.

Server-only or documentation-only changes must not trigger paid desktop runners once path filtering is in place.

## Versioning

Use `0.0.x-alpha.y` while the report contract and check semantics are still moving. The report envelope has its own `schemaVersion`; changing the application version does not imply a report-schema change.

## Signing

Alpha Windows installers may be unsigned and macOS alpha packages may be ad-hoc signed. Both must say so. Production signing, Apple notarisation and updater channels are later pilot-readiness concerns, not something to fake in early alpha.
