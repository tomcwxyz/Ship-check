# Cloud history HTTP transport

The Cloud history HTTP adapter defines a bounded route and response policy over the framework-neutral `CloudHistoryService`.

It is **not** a deployed API. It does not verify tokens, choose an auth provider, create cookies, bind Next.js route handlers or provision Vercel/Neon infrastructure.

## Outer authentication boundary

The HTTP handler accepts an auth context that has already been verified by outer middleware:

```ts
{
  principal: {
    schemaVersion: "0.1",
    authSubjectHash: "<64-char sha256>"
  },
  mutationAuthorised: true
}
```

The transport never receives or parses raw bearer tokens, cookies, issuer/subject claims or email addresses.

A future framework/auth binding is responsible for:

1. verifying the session or API token;
2. establishing trusted issuer + subject claims;
3. deriving `hashCloudAuthSubject(issuer, subject)`;
4. attaching the resulting principal;
5. deciding whether the request is authorised for mutation.

For browser cookie sessions, `mutationAuthorised` should only be true after the chosen CSRF/origin/session policy has passed. For scoped bearer/API tokens it can represent the token's verified write scope. The HTTP adapter does not pretend those mechanisms are interchangeable.

## Routes

| Method | Route | Operation |
| --- | --- | --- |
| POST | `/v1/projects/connect` | Connect/create a project from strict assurance metadata and ingest the first event |
| GET | `/v1/projects?limit=&cursor=` | List account-scoped connected projects with bounded keyset pagination |
| GET | `/v1/projects/:projectId` | Read the account-scoped project record |
| DELETE | `/v1/projects/:projectId` | Hard-delete project + cascaded history |
| POST | `/v1/projects/:projectId/events` | Sync one strict assurance-metadata event |
| GET | `/v1/projects/:projectId/timeline` | Read the source-free project history timeline for product/UI use |
| GET | `/v1/projects/:projectId/export` | Export the source-free project history envelope |
| PATCH | `/v1/projects/:projectId/name` | Explicitly update or clear display name |
| PATCH | `/v1/projects/:projectId/retention` | Explicitly change history retention |
| DELETE | `/v1/account` | Hard-delete the authenticated account + cascaded projects/history |

Path project IDs are UUID-validated. For body routes that also contain `projectId`, body and path must match.

Unknown routes return 404. Known routes with the wrong method return 405 plus an `Allow` header.

Project directory pages default to 50 items and are capped at 100. `cursor` is an opaque base64url continuation token produced by the service; malformed/invalid cursors return 400 and are never treated as SQL fragments or free-form ordering input.

The timeline route is intentionally separate from `/export`: it returns the same portable source-free timeline contract without a download `Content-Disposition` header, so a hosted UI can consume history without special-casing an export response.

## Mutation authorisation

POST, PATCH and DELETE routes require:

```text
mutationAuthorised = true
```

Authentication alone is insufficient for mutation.

An authenticator may also set `requestAuthorised: false` to deny a specific operation even when the principal is valid. That produces 403 `operation-not-authorised` before service execution. Browser/session authenticators may omit this field to retain the normal authenticated-session behaviour; scoped API-token authentication sets it explicitly for every route.

GET routes therefore still require an authenticated principal, and token-authenticated GETs additionally require the exact mapped read scope.

This keeps the transport policy stable while letting a future hosted app choose an appropriate session/CSRF/API-token strategy.

## JSON/body boundary

Request bodies are accepted only as `application/json`.

The default UTF-8 body limit is **256 KiB** and is configurable when creating the handler. The adapter rejects:

- unsupported content type;
- empty required body;
- malformed JSON;
- payloads over the configured bound;
- JSON that does not match the strict domain request schema.

This limit applies to metadata transport, not source upload. Full scan reports, source archives and bounded-evidence payloads are outside this API.

## Response boundary

Every response includes:

```text
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

History exports additionally use a JSON attachment `Content-Disposition` header.

The transport does not emit a CORS policy. A future deployment should configure allowed origins deliberately at the framework/edge boundary rather than defaulting to a wildcard.

## Error mapping

Expected errors use the strict `cloud-history-http-error/0.1` envelope.

Transport errors include:

- `unauthenticated` → 401
- `operation-not-authorised` → 403
- `mutation-not-authorised` → 403
- `invalid-request` → 400
- `payload-too-large` → 413
- `not-found` → 404
- `conflict` → 409
- `method-not-allowed` → 405
- `internal-error` → 500

Expected service not-found errors map to 404. Other expected service/domain conflicts map to 409.

Unexpected infrastructure errors are never returned verbatim. The handler can call an optional internal-error callback for a separately redacted operational logging path, while the client only receives:

```json
{
  "schemaVersion": "0.1",
  "type": "cloud-history-http-error",
  "code": "internal-error",
  "message": "Unexpected Cloud history server error."
}
```

## Framework-neutral request shape

The adapter deliberately uses a minimal request contract rather than `Request`/`Response` globals:

```ts
{
  method,
  path,
  contentType?,
  body?,
  auth?
}
```

That makes route policy directly testable and allows a later Next.js/Vercel, Node server or other HTTP binding to remain a thin adapter.

## Still not implemented

This layer does not yet provide:

- live Next.js route handlers;
- token/session verification;
- an auth-provider choice;
- CLI/CI API token issuance or rotation;
- CSRF implementation;
- rate limiting;
- abuse protection;
- CORS/origin allow-list deployment configuration;
- a Neon connection adapter;
- hosted UI;
- infrastructure provisioning.

Those are deployment concerns around this transport, not reasons to weaken the metadata boundary.
