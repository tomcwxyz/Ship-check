# Cloud history service boundary

The cloud history service is the framework-neutral application layer between a future authenticated HTTP surface and the source-free metadata history store.

It does **not** verify OAuth/OIDC tokens, set cookies, expose network routes or create a hosted deployment. Authentication middleware must verify the external session/token first and pass only a trusted SHA-256 auth-subject hash into this service.

## Auth boundary

The service accepts:

```ts
{
  schemaVersion: "0.1",
  authSubjectHash: "<64-char sha256>"
}
```

It does not accept issuer, email, username or raw subject fields.

A future auth adapter should:

1. verify the provider/session token;
2. establish trusted issuer + subject claims;
3. call `hashCloudAuthSubject(issuer, subject)`;
4. pass only the resulting hash to `createCloudHistoryService(...)`.

The hash remains pseudonymous rather than anonymous.

## Account resolution

`resolveAccount()` is the explicit create-if-needed path. It looks up the hashed subject and registers a new opaque account UUID only when none exists.

Project operations do **not** auto-create an account. Unknown-account project reads/sync/export/update/delete return the bounded `account-not-found` service error instead. This avoids ghost accounts caused by invalid or probing requests.

## Connect project

`connectProject()` accepts the first strict assurance-metadata event, explicit retention and an optional display name.

The service derives the hosted project association from the event's opaque `project-source-v1` identity.

For a new project it:

1. resolves/creates the opaque account;
2. creates the account-scoped project;
3. immediately ingests the metadata event.

For an existing project, reconnect is intentionally conservative:

- identity basis must match;
- retention must match;
- if a display name is supplied it must match;
- sync cannot rename a project or alter retention as a side effect.

Those controls have explicit operations.

## Existing-project sync

`sync()` requires a hosted project UUID plus strict assurance metadata.

Before ingestion, the service resolves the hashed principal to an existing account and confirms that the project belongs to that account. The storage layer then rechecks the metadata project identity.

The result retains the store's idempotency vocabulary:

- `stored`
- `duplicate`
- `enriched`

Conflicting scan metadata is surfaced as a bounded `history-conflict` error rather than exposing SQL/internal exception detail.

## Explicit project controls

The service exposes account-scoped operations for:

- `getProject()`
- `exportProject()`
- `updateDisplayName()` — string or `null` to clear the optional name;
- `updateRetention()`
- `deleteProject()`
- `deleteAccount()`

Project rename/retention changes therefore cannot happen during a normal metadata sync.

Deletion remains hard deletion in the storage layer, with bounded deletion receipts returned to the caller.

## Safe service errors

Expected domain failures use a small portable vocabulary:

- `project-retention-conflict`
- `project-name-conflict`
- `project-identity-conflict`
- `project-not-found`
- `account-not-found`
- `history-conflict`
- `history-empty`

`CloudHistoryServiceOperationError.toContract()` converts these to the strict service-error schema.

Unexpected infrastructure failures are not converted into user-visible database detail here. A future HTTP adapter should log them through an appropriately redacted operational path and return a generic server failure.

## Still outside this layer

This service deliberately does not decide:

- auth provider;
- session/cookie strategy;
- CSRF strategy;
- rate limits;
- HTTP route shape;
- API tokens for CLI/CI;
- Neon connection/runtime adapter;
- hosted UI/navigation;
- team membership/roles.

Those concerns can now be added around a stable account/project/history domain boundary instead of being mixed into the scanner or persistence implementation.
