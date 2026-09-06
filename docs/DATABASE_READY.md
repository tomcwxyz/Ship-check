# Database Ready

Database Ready is the first planned Alpha 2 expansion. It extends Ship Check beyond repository-only application checks while keeping the same evidence-first, deterministic and local-first principles.

## Product shape

Start with **Postgres Core** and layer provider-specific enrichment on top:

```text
Database Ready
├── Postgres Core
├── Supabase enrichment
└── Neon enrichment
```

Do not implement separate duplicated Supabase and Neon rule engines. Both should reuse Postgres evidence where the underlying risk is a PostgreSQL concern.

## Two evidence levels

### Repository-only

No database credentials and no network call are required.

Inspect repository-visible evidence such as:

- SQL migrations;
- Drizzle/Prisma schema and migrations;
- Supabase migrations/configuration;
- connection configuration and environment variable names;
- server/client database usage;
- deployment/runtime patterns.

Candidate checks include:

- explicit RLS disablement or missing RLS evidence where a Supabase-exposed table is repository-visible;
- unsafe `SECURITY DEFINER` / `search_path` patterns;
- excessive grants to broad roles;
- destructive migration operations requiring explicit review;
- missing migration discipline;
- server credentials exposed through client/public environment variables;
- direct-vs-pooled connection misuse in serverless runtime code;
- obvious unbounded/high-frequency database polling.

Absence-of-evidence checks must use appropriately lower confidence where controls could live outside the repository.

### Optional connected inspection

A separate inspector may connect to Postgres using explicitly supplied credentials. It must be designed as read-only assurance infrastructure rather than an administration client.

Required boundaries:

- credentials are never persisted in Ship Check diagnostics/history;
- read-only transaction/session where supported;
- strict statement and connection timeouts;
- metadata/system catalogue queries only by default;
- no DDL/DML;
- no `SELECT *` over user tables;
- no export of row contents;
- inspection findings pass through the same portable finding contract as repository checks;
- repository-only Ship Check continues to work with no network access.

Candidate connected checks include:

- actual RLS enabled state and policy presence;
- table/schema/function grants;
- roles with elevated/bypass privileges;
- `SECURITY DEFINER` functions and unsafe search paths;
- primary/foreign-key health;
- useful index evidence for foreign keys and recurring catalogue-visible patterns;
- duplicate/unused index evidence where defensible;
- long-running transaction/connection pressure and catalogue health signals where safe and portable.

## Provider enrichment

### Supabase

Provider-aware checks can add context around:

- exposed schemas;
- RLS and policy coverage;
- `anon` and `authenticated` grants;
- service-role usage boundaries;
- functions/views exposed through the API surface;
- Storage policy evidence;
- generated database/RLS tests later in the roadmap.

### Neon

Provider-aware checks can add context around:

- pooled runtime URLs for serverless/application traffic;
- direct connections for migrations/session-dependent operations;
- migration/runtime connection separation;
- production/preview branch configuration where evidence is available;
- provider branch protections or metadata only when an optional provider connection is explicitly authorised.

## Package boundary

Proposed structure:

```text
packages/
  db-checks/
    postgres/
    supabase/
    neon/
  db-inspector/
    postgres/
    providers/
```

`db-inspector` gathers bounded evidence. `db-checks` evaluates evidence and produces normal Ship Check findings. The desktop, CLI and RACK adapters consume the resulting report rather than implementing database logic themselves.

## Release rule

Do not enable Database Ready findings by default until risky/safe fixtures exist for Postgres Core plus at least one Supabase and one Neon scenario, and the checks have been exercised against the Good Ship corpus.
