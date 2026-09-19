# Architecture

Ship Check uses the same broad architectural rule as RACK and TOPO: **portable domain contracts first; interfaces are clients of those contracts**.

## Layers

`@ship-check/schemas` owns the stable interchange contract. A finding always carries a check ID, pack, severity, confidence, evidence, remediation and an agent-ready repair prompt. Reports are versioned independently from any desktop UI. The same package owns the portable `ProjectEvidenceSource`, `ProjectSnapshot`, ruleset-provenance and metadata-history contracts used to describe where project evidence came from, what it can establish and which deterministic rule set produced the result.

`@ship-check/core` owns project inventory and orchestration. It knows how to establish the scanned source set, read bounded text safely, execute checks and assemble a validated report. It does not know about Tauri, RACK, TOPO or a hosted account. Materialised source from a local folder, transient checkout, upload, CI runner or future hosted-builder adapter therefore reaches the same checking engine.

`@ship-check/checks` owns deterministic checks. Checks should prefer direct evidence and should say when confidence is low because a control may live upstream. Model judgement is not part of the first alpha execution path. Checks may declare the evidence capabilities they require; if those capabilities are unavailable the check is `not-assessed`, never a pass.

`@ship-check/cli` is deliberately thin. It acquires/materialises a supported source, describes its provenance to the core and then invokes the same report contract used by desktop, CI and RACK verification plans.

## Project evidence model

A **project** is broader than a repository. Repository source is currently the richest implemented evidence source, but later project assurance can combine source, deployment/runtime, database, platform and CI evidence without pretending that one source establishes everything.

`ProjectEvidenceSource` records:

- evidence type (`source`, `deployment`, `database`, `platform`, `dependency` or `ci`);
- provider as an open stable identifier such as `local`, `github`, `upload` or `lovable`;
- how evidence was acquired, including local access, transient checkout, uploaded snapshot, read-only remote access, runtime probe or CI;
- where execution occurred: user device, CI runner, Ship Check managed infrastructure or an external platform;
- evidence capabilities such as `source-files`, `git-history`, `runtime-http`, `database-metadata` or `platform-metadata`;
- whether the materialised source is ephemeral, plus acquisition time and optional provider ref.

`ProjectSnapshot` binds that provenance to the concrete inventory Ship Check inspected. It deliberately does not contain source file contents. Scan reports retain the existing project fields for compatibility and add the snapshot as provenance.

The rule is **coverage follows evidence**. Existing repository checks default to requiring `source-files`. A future URL-only source can expose `runtime-http`; source checks then become `not-assessed` and assurance gates become `incomplete` rather than silently passing. Runtime checks will explicitly require runtime capabilities instead.

## Ruleset provenance

Every newly generated source, runtime and database report carries a `check-ruleset-v1` fingerprint. It is the SHA-256 digest of the sorted selected `checkId + rule version + pack` descriptors, so execution order does not change the identity while a rule-version or pack change does.

This is deliberately separate from:

- **engine version** — the Ship Check build that executed the scan;
- **source fingerprint** — the bounded project inventory/content identity;
- **scanner version** — optional per-check provenance for external tools such as Gitleaks.

A multi-source report fingerprints the reconciled union of its check definitions. If two evidence-source reports claim the same check ID with conflicting rule version or pack metadata, Ship Check refuses to combine them instead of silently choosing one.

Desktop history and CI pull-request comparison prefer the ruleset fingerprint when present and retain the older check-signature fallback only for previously stored reports that predate this field.

## Metadata-only project history

`ProjectHistoryMetadata` is the portable control-plane/history envelope. It is derived from a full scan report after checking and contains only:

- opaque `project-source-v1` and deterministic `scan-event-v1` SHA-256 identities;
- engine/ruleset provenance, packs and check count;
- sanitised evidence-source type/provider/acquisition/execution/capability metadata;
- aggregate source fingerprint state and commit identity when available;
- severity/status counts and coverage area/status/check counts;
- optional aggregate change metadata with explicit baseline basis and `source` vs `project` scope.

The contract is strict and cannot carry source labels/IDs/refs, finding/gap/observation identities or details, evidence, remediation or suppression rationale.

Project identity is derived locally from the primary evidence source unless a caller supplies a separate project-association key. GitHub identity is canonical across CLI/CI acquisition; runtime identity discards query/fragment data before hashing. These hashes are pseudonymous rather than anonymous.

The scan-event identity is deterministic over the privacy-bounded scan metadata, making repeated export idempotent without turning source content into cloud state.

This is a **data contract, not a transport**. CLI `--format metadata` and the GitHub Action sidecar can produce it today. No Ship Check service receives it automatically. Account association, ingestion, retention/deletion, team visibility and higher sync levels remain separate control-plane responsibilities.

A pure `buildProjectHistoryTimeline()` reducer can consume multiple metadata events without source access or storage infrastructure. It validates one project identity, deduplicates by deterministic scan identity, orders events, derives only provenance continuity (ruleset/engine/source fingerprint/coverage/evidence-source shape) and exposes the latest aggregate attention snapshot. It never derives finding-transition semantics from count differences; only explicit comparison metadata carries new/persistent/reactivated/accepted/no-longer-active meaning.

See [`HISTORY_METADATA.md`](./HISTORY_METADATA.md).

## Cloud history persistence boundary

The first hosted persistence layer remains outside the checking engine. It lives behind a transaction-capable SQL adapter and stores only the portable metadata-history contracts.

The Postgres/Neon-compatible schema has three entities:

- opaque account identity (UUID + SHA-256 auth-subject hash);
- account-scoped hosted project identity + optional display name + explicit retention;
- source-free assurance metadata events keyed by deterministic scan identity.

No full report/source/evidence columns exist in this schema. Project/account hard deletion cascades through stored history. Time-bounded retention is based on ingestion time and can be changed explicitly, recalculating existing event expiry.

The store validates project identity before ingestion and treats deterministic scan identity as an idempotency boundary. Exact duplicates are no-ops; an otherwise identical scan can be enriched once with explicit comparison metadata; conflicting core/comparison payloads are rejected.

All ordinary queries are account-scoped. Expiry pruning is the only system-level unscoped operation. The database is intended to remain server-only until a concrete hosted auth/session model exists; database-native RLS should bind to trusted account claims later rather than shipping placeholder policies.

This layer does not provision infrastructure or create a network API. See [`CLOUD_HISTORY.md`](./CLOUD_HISTORY.md).

### Authenticated service boundary

A framework-neutral `CloudHistoryService` now sits above the store. It accepts only a verified 64-character auth-subject hash, never raw issuer/subject/email claims.

The service owns application semantics that should not be reimplemented independently by future HTTP routes:

- explicit account create-if-needed only through account resolution/project connect;
- no ghost-account creation from project reads/sync/delete;
- connect-by-opaque-project-identity;
- sync cannot silently rename projects or change retention;
- explicit account-scoped rename, retention, export and deletion operations;
- bounded portable domain errors for expected conflicts/not-found states;
- unexpected infrastructure errors remain internal rather than being translated into database detail.

Actual authentication verification, HTTP routing, rate limiting, CSRF/session policy and API-token design remain outside this layer.

See [`CLOUD_SERVICE.md`](./CLOUD_SERVICE.md).

### HTTP transport policy

A bounded `CloudHistoryHttpHandler` now defines framework-neutral route policy above the service layer. It receives only a verified hashed principal plus an outer `mutationAuthorised` decision; raw tokens/cookies and auth-provider claims never enter the handler.

The transport owns stable concerns that future framework routes should not reinvent: UUID/path-body matching, JSON/content-type/body-size limits, mutation gating, no-store/nosniff response headers, method guidance and safe 4xx/5xx error mapping. Unexpected infrastructure errors are reduced to a generic 500 response and may only reach a separately supplied internal-error callback.

It deliberately does not implement token/session verification, CSRF, rate limiting, CORS policy or a live framework route. Those remain deployment boundaries around the transport.

See [`CLOUD_HTTP.md`](./CLOUD_HTTP.md).

## Evidence rules

- Never echo detected credential values in findings.
- A check must return the concrete evidence that caused it to fire.
- Absence-of-evidence checks use lower confidence where configuration could plausibly live outside the inspected evidence source.
- A pass means only that the specific rule completed against evidence it was capable of assessing.
- Missing required evidence is `not-assessed`, not `passed` and not a fabricated finding.
- Evidence provenance remains distinct even when later source, runtime, database or platform evidence is correlated.
- Checks are individually versioned, and the selected rule set has a stable fingerprint without changing the report envelope.

## Local-first and cloud boundary

Local-first remains a product capability rather than a migration stage. An ordinary local scan records `local` acquisition on the user device; a GitHub CLI scan records a transient GitHub checkout on the user device. Neither requires a hosted Ship Check account.

Cloud Ship Check can build on the same contract without making hosted scanning mandatory. A cloud control plane may store permitted assurance metadata/history while execution happens locally or in CI. A later managed runner can materialise an ephemeral source and invoke the same engine while making the different execution and retention boundary explicit in provenance.

Source contents and detected secret values must not become persistent cloud report data merely because execution moves off-device.

## Desktop boundary

The desktop surface is a Tauri + React client, following the RACK/TOPO release family. It calls the same engine contract and presents evidence, repair prompts, accepted exceptions and re-check. We should not fork a second scanner implementation into the UI or create platform-specific scanner implementations for hosted builders.
