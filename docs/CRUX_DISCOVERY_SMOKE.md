# CRUX discovery smoke

This branch exists to exercise the PR-triggered Open Recommendations Local discovery smoke against the current Ship Check AI-discovery implementation.

The workflow must demonstrate that `ship-check discover-ai tomcwxyz/open-recs-local --ref master` produces a metadata-only `crux-discovery/0.1` report containing technical AI signals and a `source.extract` workflow hint without declaring organisational purpose or authority.

Retry after separating build output from the discovery JSON capture.

Executable-evidence pass: docs are no longer treated as primary technical signals; source.extract and chat.search must be found from `src/`.
