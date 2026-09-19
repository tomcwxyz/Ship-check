# Cloud server runtime

`@ship-check/cloud-runtime` is the server-only composition layer between the portable Cloud contracts and a hosted application.

It deliberately lives outside `@ship-check/adapters` so local CLI/desktop users do not pull a Postgres runtime dependency merely by importing the shared assurance adapters.

## Postgres adapter

`createPgCloudHistoryDatabase()` adapts a `pg` pool to the existing `CloudHistoryDatabase` contract.

It provides:

- direct parameterised query execution;
- explicit transaction acquisition;
- `BEGIN` / `COMMIT`;
- rollback on failure while retaining the original operation error;
- guaranteed client release;
- bounded pool and connection-timeout configuration.

A caller may inject an existing `pg.Pool` or provide a PostgreSQL connection string. Supplying both is rejected.

The adapter owns and closes only pools that it creates itself.

## Runtime assembly

`createCloudRuntime()` creates, over one database boundary:

1. Cloud history store;
2. Cloud API-token store;
3. history service;
4. API-token service;
5. the Cloud R0 Web handler.

The caller supplies the browser/session authenticator and may supply the existing allowed-origin and rate-limit hooks.

This keeps hosted frameworks thin: a Next.js or Vercel route should translate deployment configuration into this runtime rather than rebuilding account, history, token or request-authorisation logic.

## Error privacy

Before application error hooks are called, PostgreSQL connection URLs are redacted from error message and stack text.

HTTP clients already receive only bounded Cloud error contracts; raw database errors never become response bodies.

## Deployment configuration

The runtime expects a server-side PostgreSQL connection URL. It is not read implicitly from a particular environment-variable name inside the package. The deployment adapter should make that choice explicitly and keep the value server-only.

A production deployment should:

- use the Cloud database schema in `migrations/cloud`;
- use TLS as required by the database provider;
- keep the database credential out of browser bundles and request data;
- configure a small connection pool appropriate to the serverless runtime;
- provide concrete browser session verification and rate-limit storage;
- close or reuse pools according to the hosting platform lifecycle.

## Not a hosted app

This package is not itself a Next.js UI or Vercel deployment. It is the server-only runtime that those surfaces can now instantiate without weakening the local-first/product boundaries.
