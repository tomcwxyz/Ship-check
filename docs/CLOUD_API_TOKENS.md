# Cloud API tokens

Ship Check Cloud API tokens are the planned non-browser credential for CLI, CI and other explicit automation against the metadata-only control plane.

This foundation adds token generation, hashed persistence, account-scoped management and active-token authentication lookup. It does **not yet** wire bearer tokens into the Web handler or expose token-management HTTP routes.

## Raw token boundary

A raw token has the form:

```text
shipcheck_<43 base64url characters>
```

The 43-character secret is generated from 32 cryptographically random bytes.

The raw token is returned **once** by the token-creation service. Ship Check persists only:

- a domain-separated SHA-256 digest;
- a short non-secret display prefix such as `shipcheck_ABCDEFGH`;
- account ID;
- optional user label;
- scopes;
- lifecycle timestamps.

The raw token is never written to the database and is not part of the public token record.

Hashing uses:

```text
SHA-256("ship-check-api-token-v1\0" + rawToken)
```

The domain separator prevents the digest from being confused with unrelated SHA-256 identities elsewhere in Ship Check.

## Scopes

The first scope vocabulary is intentionally narrow:

- `history:read` — read connected project/history metadata;
- `history:sync` — connect/sync metadata history;
- `project:manage` — project-level administrative changes such as name/retention/project deletion.

Scopes do not imply one another. A sync token cannot read history unless it also has `history:read`.

The bearer Web authenticator now maps only explicitly supported routes:

| Scope | Routes |
| --- | --- |
| `history:read` | `GET /v1/projects`, project record, timeline and export |
| `history:sync` | `POST /v1/projects/connect`, `POST /v1/projects/:id/events` |
| `project:manage` | project name/retention updates and project deletion |

Unknown/future routes are denied until deliberately mapped.

**No API-token scope grants account deletion.** `DELETE /v1/account` always fails token authorisation even for a `project:manage` credential.

## Expiry

Tokens must expire. The first supported lifetimes are:

- 30 days;
- 90 days (default);
- 180 days;
- 365 days.

There is no non-expiring token option.

The service calculates expiry from creation time. Both application code and the Postgres schema require expiry to be later than creation.

## Persistence

`migrations/cloud/0002_api_tokens.sql` creates `ship_check_api_tokens`.

Important database properties:

- account foreign key with `ON DELETE CASCADE`;
- globally unique SHA-256 token digest;
- known-scope + non-empty scope constraints;
- explicit expiry/revocation/last-used timestamps;
- account-scoped listing index;
- active-token hash lookup support.

Scope duplication is rejected by the strict application contract. Postgres independently constrains the set of permitted scope values and cardinality.

## Authentication lookup

`authenticateToken()`:

1. validates the raw token syntax;
2. hashes it locally;
3. atomically looks up an unrevoked, unexpired row;
4. updates `last_used_at`;
5. joins the account to return the existing pseudonymous auth-subject hash;
6. returns only token/account IDs, the auth-subject hash and scopes.

Malformed tokens return no authentication result and never reach SQL.

Expired, revoked or unknown tokens also return no authentication result.

The raw credential is not sent as a SQL parameter; only its digest is.

## Account management

`CloudApiTokenService` supports:

- create token;
- list token records;
- revoke token.

Explicit token creation may bootstrap the authenticated user's opaque Cloud account so a user can create a credential before connecting their first project.

Listing or revoking does not create accounts as a side effect.

Token lists are bounded to 100 records.

## Revocation

Revocation is account-scoped and idempotent at the storage layer. A repeated revoke keeps the original revocation timestamp.

A missing token ID is surfaced as the explicit `api-token-not-found` service state.

Account deletion cascades through all API-token rows.

## Bearer authentication

`createCloudApiTokenWebAuthenticator()` accepts only a syntactically valid:

```text
Authorization: Bearer shipcheck_...
```

It authenticates through the active-token store, then returns the existing pseudonymous account principal plus an explicit per-operation authorisation decision.

The distinction is intentional:

- missing, malformed, unknown, expired or revoked credential → unauthenticated / 401;
- valid credential without the required route scope → authenticated but denied / 403 `operation-not-authorised`;
- valid credential with the exact required scope → authorised.

The Web binding evaluates explicit denial before consuming POST/PATCH request bodies.

## Still to do

This foundation deliberately does not yet add:

- token-management HTTP routes;
- CLI token storage;
- CLI/CI metadata sync;
- token rotation helpers;
- rate limiting or abuse controls;
- hosted token management UI.

Those should build on this one-time-secret + hashed-persistence boundary rather than creating another credential format.
