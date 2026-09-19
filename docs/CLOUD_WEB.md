# Cloud history Web binding

The Web binding adapts the framework-neutral Cloud history HTTP transport to the standard Web `Request` / `Response` APIs available in modern Node runtimes, Next.js route handlers and Vercel functions.

It is still **not a live deployment**. The binding does not choose or configure an authentication provider, create routes in a Next.js app, provision infrastructure or expose a public URL.

## Composition

The hosted stack is now deliberately layered:

```text
auth/session verifier
        ↓
CloudHistoryWebAuthenticator
        ↓
Web Request/Response binding
        ↓
bounded CloudHistoryHttpHandler
        ↓
CloudHistoryService
        ↓
CloudHistoryStore
        ↓
Postgres / Neon-compatible schema
```

Each layer has one boundary rather than mixing authentication, HTTP policy, project semantics and SQL into route handlers.

## Authentication

`createCloudHistoryWebHandler()` requires an injected authenticator:

```ts
type CloudHistoryWebAuthenticator = (
  request: Request
) => Promise<{
  principal: {
    schemaVersion: "0.1";
    authSubjectHash: string;
  };
  mutationAuthorised: boolean;
} | null>;
```

The authenticator is the only layer here that is allowed to inspect the original Web request for provider-specific session/token information.

It must return only the verified hashed principal plus the mutation-authorisation decision expected by the HTTP transport.

Returning `null` means unauthenticated.

Throwing means authentication infrastructure failed unexpectedly; the binding returns a generic 500 response and may pass the original error to the optional `onAuthenticationError` callback for separately redacted operational logging.

## Rejected requests do not consume bodies

The binding authenticates **before** reading request bodies.

If authentication returns `null`, the existing HTTP transport produces the 401 response without consuming the body.

For POST/PATCH/DELETE requests, if `mutationAuthorised` is false, the binding similarly produces the 403 response before consuming the body.

This matters for both resource use and privacy: data from a caller that has not passed the relevant access boundary is not parsed unnecessarily.

## Streaming body bound

The abstract HTTP handler already has a body-size policy, but a real Web binding must enforce the limit while the request stream is being consumed.

The Web binding therefore:

1. checks a valid numeric `Content-Length` declaration when present;
2. reads `Request.body` as a stream;
3. counts raw bytes, not JavaScript character length;
4. cancels the reader immediately if the configured limit is crossed;
5. only decodes/forwards a body that stayed inside the bound.

The default is the same **256 KiB** metadata limit as the HTTP transport. A custom limit is passed consistently to both layers.

This prevents a route adapter from calling unbounded `request.text()` before the transport has a chance to reject an oversized payload.

## Web response

The transport's status, body and headers are copied into a standard Web `Response`.

That retains the previously defined:

- JSON content type;
- `Cache-Control: no-store`;
- `X-Content-Type-Options: nosniff`;
- export attachment header;
- bounded error envelopes.

The binding forwards the URL pathname **plus query string** to the bounded transport. The transport still uses only the pathname for route identity, while explicitly defined read routes such as the project directory can parse bounded query parameters such as `limit` and opaque `cursor`.

## Next.js / Vercel fit

A later Next.js route can remain thin:

```ts
const handle = createCloudHistoryWebHandler(service, {
  authenticate: verifyShipCheckSession
});

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
```

The real framework adapter may need a small wrapper depending on route-file layout and auth library conventions, but it should not duplicate the route/security/business policy already defined here.

## Still deliberately open

This binding does not yet choose:

- Neon project/connection;
- auth provider or session library;
- browser cookie vs API-token strategy;
- CSRF/origin implementation;
- rate-limit provider or thresholds;
- public hostname;
- Vercel project/environment;
- hosted UI.

Those choices should be made when we intentionally create the first hosted environment, not smuggled into a portable library layer.
