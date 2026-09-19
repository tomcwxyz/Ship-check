# Cloud R0 hosted Web boundary

Cloud Ship Check R0 composes the existing portable history, API-token and Web transports behind one framework-neutral request boundary before any Next.js/Vercel binding.

## Credential selection

History routes support two credential classes:

- browser/session authentication when no `Authorization` header is present;
- scoped Ship Check bearer authentication when an `Authorization` header is present.

The presence of an `Authorization` header is authoritative. A malformed, unknown, expired or revoked bearer credential fails as bearer authentication and **does not fall back** to an otherwise valid browser session.

This prevents an invalid automation credential from accidentally inheriting a user's browser authority.

## Token management

`/v1/tokens` and `/v1/tokens/:id` are browser/session routes.

Bearer credentials are deliberately not accepted as token-management authority. A user may create, list and revoke automation credentials only through a separately authenticated browser/session flow. The one-time raw-token and hashed-persistence rules in [Cloud API tokens](./CLOUD_API_TOKENS.md) still apply.

## Browser mutation origin boundary

State-changing session requests require an `Origin` header that is either:

- the same origin as the Cloud request URL; or
- an explicitly configured allowed origin.

Missing, opaque (`null`) and unexpected origins fail before session authentication or body reads.

This origin rule is intended to sit alongside the hosted session provider's own CSRF/session controls rather than replace them.

Scoped bearer automation is not subject to the browser-Origin rule; it is authorised by the explicit route/scope map instead.

## Rate limiting

The composition boundary accepts an injected rate-limit decision function. It runs before downstream authentication, body parsing or service execution and receives only:

- the request;
- credential class (`session` or `bearer`);
- route family (`history` or `token-management`).

A denied request returns HTTP 429 with the bounded `rate-limited` error contract and may include a positive `Retry-After` value.

The core package does not choose a storage backend or rate-limit algorithm. A later Vercel binding can supply an appropriate implementation without putting platform logic into the assurance domain.

## Error contracts

The hosted composition adds two explicit bounded HTTP states:

- `origin-not-authorised` → 403;
- `rate-limited` → 429.

No request error includes bearer credentials, session values, source material or evidence content.

## Still to bind

This boundary does not itself provide:

- a session provider;
- session cookie configuration;
- a Next.js route;
- a Vercel deployment;
- a Neon database connection;
- an operational rate-limit store.

Those are deployment adapters around this boundary, not reasons to duplicate history/token domain logic.
