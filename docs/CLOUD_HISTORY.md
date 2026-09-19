# Cloud metadata history foundation

Ship Check Cloud starts as a **control plane for source-free assurance metadata**, not as a hosted source scanner.

This foundation stores only the portable `assurance-metadata/0.1` envelope introduced by the local/CI history work. It does not persist full scan reports, source files, repository/deployment locators, evidence excerpts, remediation text, raw auth subjects or detected secret values.

No external database is provisioned by this repository change. The migration is standard Postgres and is intended to run cleanly on Neon or another compatible Postgres service once a hosted environment is deliberately created.

## Tables

`migrations/cloud/0001_metadata_history.sql` creates three tables:

- `ship_check_accounts` — opaque account UUID + SHA-256 auth-subject hash;
- `ship_check_projects` — account-scoped opaque project identity, optional user-chosen display name and explicit retention policy;
- `ship_check_history_events` — one source-free assurance metadata envelope per project + deterministic scan identity.

Projects and history rows cascade-delete when their parent account/project is deleted.

The database has no email, repository URL, deployment URL, source path, source file, finding-detail or evidence-detail columns.

## Auth identity

The persistence layer expects authentication to happen outside the history store.

Use:

```ts
hashCloudAuthSubject(issuer, subject)
```

to derive the persisted 64-character SHA-256 value from the auth issuer + subject pair. The raw auth subject is not stored in these tables.

This is pseudonymous rather than anonymous. The hash is an account-association key, not a claim that identity data is impossible to correlate.

## Project identity

Each hosted project belongs to exactly one account and records:

- `project-source-v1` opaque project identity;
- identity basis: `primary-evidence` or `caller-provided`;
- optional display name supplied intentionally by the user;
- fixed sync level: `assurance-metadata`;
- explicit history retention choice.

The same account/project identity pair is unique. A repeat create is idempotent and must not silently change the identity basis.

## Retention

There is intentionally **no hidden retention default**. Project creation requires one of:

- `30-days`
- `90-days`
- `180-days`
- `365-days`
- `until-deleted`

For time-bounded policies, `expires_at` is derived from **ingestion time**, not scan generation time. This avoids old/offline metadata disappearing immediately when it is uploaded later.

Changing project retention recalculates expiry for existing history rows from their original ingestion timestamps.

`pruneExpired()` is the only store operation that is intentionally not account-scoped. It is a system maintenance operation and deletes only rows whose explicit `expires_at` has passed.

## Ingestion

`createCloudHistoryStore(database)` accepts a small transaction-capable SQL interface so the control-plane code is not coupled to one Postgres client library.

Every ordinary project/history operation carries both account and project identity through the query boundary.

Ingestion:

1. validates the strict assurance-metadata schema;
2. locks and loads the account-scoped hosted project;
3. checks metadata project identity + identity basis against that project;
4. derives expiry from the project's explicit retention policy;
5. inserts by deterministic scan identity.

### Duplicate semantics

The scan identity makes ingestion idempotent, with one deliberate enrichment case:

- exact repeat → `duplicate`;
- existing event has explicit comparison metadata, later poorer copy does not → `duplicate`, richer copy is preserved;
- existing event has no comparison metadata, later identical scan includes a real comparison block → `enriched`;
- same scan identity but different core metadata → rejected;
- same scan identity with conflicting comparison blocks → rejected.

The store therefore cannot silently overwrite one assurance event with materially different content.

## Export

`exportProject()` reconstructs the portable `project-history-timeline/0.1` envelope from stored metadata events.

The export contains the hosted project record plus source-free timeline metadata. It still contains no source/evidence detail because the store never possessed it.

A project with no history events cannot currently produce a timeline export.

## Deletion

`deleteProject()` and `deleteAccount()` are hard-delete operations.

They return bounded deletion receipts containing IDs, deletion time and deleted project/event counts. The receipts are returned to the caller and are not persisted by this storage schema.

Database foreign-key cascades remove history rows if the parent project/account is deleted.

## SQL adapter boundary

The store expects:

```ts
type CloudHistoryDatabase = {
  query(text, values): Promise<{ rows: unknown[]; rowCount?: number }>;
  transaction(run): Promise<unknown>;
};
```

A later hosted app can adapt Neon, `pg`, or another Postgres client to this interface without changing the domain/storage semantics.

The account scoping in this first foundation is enforced by every application query. The database should remain server-only. Database-native RLS should be added only when the hosted auth/session strategy is concrete enough to bind trusted account claims correctly; an unauthenticated/public database role is not part of this design.

## Not implemented yet

This slice does **not** add:

- a hosted Next.js app or API;
- a Neon project/database;
- authentication/session UI;
- automatic CLI/desktop/CI sync;
- GitHub App/webhook ingestion;
- structured-finding or bounded-evidence sync;
- managed source scanning;
- team roles/review state;
- hosted timeline UI.

Those should build on this store rather than widening the persistence boundary first.
