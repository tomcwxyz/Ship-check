# Live database metadata inspection

Ship Check can optionally add **live Postgres metadata** to the same project review as source and deployment evidence. This is deliberately an assurance boundary, not a database administration surface.

## What it does

When database inspection is explicitly enabled, Ship Check opens a local Postgres connection and:

1. starts `BEGIN TRANSACTION READ ONLY`;
2. verifies the transaction is read-only;
3. applies bounded statement and lock timeouts;
4. runs only Ship Check-owned, fixed system-catalog metadata queries;
5. records a bounded table inventory, RLS flags, policy counts and selected role/grant metadata;
6. rolls the transaction back; and
7. closes the connection.

It does **not** accept arbitrary SQL and does **not** read application row data.

The canonical report does not persist the raw database metadata snapshot. Checks receive the snapshot transiently and may emit only the bounded finding, observation or unanswered question they are designed to report.

## Credentials and privacy

Use a dedicated least-privilege metadata-reading credential where practical.

The CLI does not accept a database URL as a command-line value. It reads the URL from an environment variable only:

```bash
export SHIP_CHECK_DATABASE_URL='postgresql://...'
pnpm ship-check -- scan . --inspect-database --database-platform postgres
```

A different environment variable can be named without exposing its value:

```bash
export MY_READONLY_DATABASE_URL='postgresql://...'
pnpm ship-check -- scan . \
  --inspect-database \
  --database-url-env MY_READONLY_DATABASE_URL \
  --database-platform neon
```

In the desktop app, the connection URL is session-only. It is read from the password field only when the scan starts, passed to the bundled engine through a child-process environment variable, and cleared after success or failure. It is not placed in command arguments, app state, reports or diagnostics.

Ship Check records only whether the inspection role is a Postgres superuser or has `BYPASSRLS`; it does not retain the database role name. An elevated inspection credential is treated as an evidence-boundary question, not silently accepted as ideal.

## Bounded inventory

The default table inventory limit is 1,000 and may be configured from 1 to 5,000:

```bash
pnpm ship-check -- scan . \
  --inspect-database \
  --database-table-limit 500
```

If the table inventory reaches the configured bound, the snapshot is marked as truncated. A truncated inventory cannot produce a reassuring whole-database conclusion: confirmed concerns remain visible, while otherwise-positive checks remain unverified until the evidence boundary is widened or narrowed appropriately.

## Provider-specific evidence

`--database-platform` labels the evidence as `postgres`, `supabase` or `neon`.

### Supabase

Source checks look for versioned RLS/migration evidence and privileged server-key boundaries. Live metadata can then inspect actual `anon` / `authenticated` table grants and whether client-granted public tables have RLS enabled.

Where live metadata establishes the same bounded control, it can explicitly resolve the matching source-level RLS uncertainty. It does not interpret policy expressions yet, so “RLS enabled” is not a claim that every policy is correct.

### Neon

Source checks distinguish the Neon HTTP helper, `Pool` and explicit `Client` lifecycle evidence without imposing a blanket pooling rule. Connection strategy depends on runtime shape. Live inspection currently contributes the generic Postgres metadata and inspector-boundary evidence; it does not yet claim Neon branching or deployment-policy assurance.

### Postgres

Generic source checks cover database change provenance, destructive migration operations and explicitly privileged credential names in request-handling paths. Live metadata adds bounded catalogue evidence without attempting to become a schema-management tool.

## Multi-source review

Database evidence is another project evidence source, not a replacement for source or runtime evidence. It can be combined with either or both:

```bash
export SHIP_CHECK_DATABASE_URL='postgresql://...'
pnpm ship-check -- scan ./my-project \
  --deployment-url https://my-project.example \
  --inspect-database \
  --database-platform supabase
```

The resulting report preserves the distinct source, deployment and database provenance. Stronger evidence may resolve an earlier unanswered question only when a check explicitly declares that it verifies the same control.

## What this does not establish

A completed database metadata inspection does not prove that:

- every database user or role is least-privileged;
- every Supabase RLS policy expression is correct;
- functions, views or non-table surfaces have been exhaustively reviewed;
- application credentials use the role the source code appears to imply;
- migrations in source exactly match every deployed database state; or
- the database is secure or compliant overall.

Those limitations should remain visible as coverage or unanswered questions rather than being converted into a pass.