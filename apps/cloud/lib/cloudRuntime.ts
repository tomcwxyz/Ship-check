import { createHash } from "node:crypto";
import {
  type CloudR0RateLimitContext,
  type CloudR0RateLimitDecision
} from "@ship-check/adapters";
import {
  createCloudRuntime,
  createPgCloudHistoryDatabase
} from "@ship-check/cloud-runtime";
import { authenticateNeonSession } from "./neonAuth";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required Cloud environment variable: ${name}`);
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type State = {
  runtime: ReturnType<typeof createCloudRuntime>;
  db: ReturnType<typeof createPgCloudHistoryDatabase>["database"];
};

declare global {
  // eslint-disable-next-line no-var
  var __shipCheckCloudState: State | undefined;
}

function state(): State {
  if (!globalThis.__shipCheckCloudState) {
    const pg = createPgCloudHistoryDatabase({
      connectionString: env("DATABASE_URL"),
      maxConnections: 5,
      connectionTimeoutMs: 5_000,
      applicationName: "ship-check-cloud"
    });
    const db = pg.database;
    const runtime = createCloudRuntime({
      database: db,
      authenticateSession: authenticateNeonSession,
      allowedOrigins: (process.env.SHIP_CHECK_ALLOWED_ORIGINS ?? "")
        .split(",").map(x => x.trim()).filter(Boolean),
      rateLimit: (context) => persistentRateLimit(db, context),
      onInternalError: (error) => {
        console.error("Ship Check Cloud internal error", error);
      },
      onAuthenticationError: () => {
        console.warn("Ship Check Cloud session verification failed");
      }
    });
    globalThis.__shipCheckCloudState = { runtime, db };
  }
  return globalThis.__shipCheckCloudState;
}

async function persistentRateLimit(
  db: State["db"],
  context: CloudR0RateLimitContext
): Promise<CloudR0RateLimitDecision> {
  // Durable Postgres counter, shared between independent Vercel functions.
  // Avoid trusting a client-provided user ID, bearer token as plain text, or
  // raw addresses in the rate limiter database.
  const forwarded = context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded?.slice(0, 80) || "unknown";
  const kind = context.credential;
  const keyHash = hash(`ship-check-rate-v1:\0${kind}:\0${ip}`);
  const bucket = Math.floor(Date.now() / 60000);
  const limit = kind === "bearer" ? 120 : 60;
  const result = await db.query<{request_count: number}>(
    `INSERT INTO ship_check_rate_limits
        (key_hash, window_bucket, request_count, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (key_hash) DO UPDATE
       SET window_bucket = EXCLUDED.window_bucket,
           request_count = CASE
             WHEN ship_check_rate_limits.window_bucket = EXCLUDED.window_bucket
             THEN ship_check_rate_limits.request_count + 1
             ELSE 1
           END,
           updated_at = now()
       RETURNING request_count`,
    [keyHash, bucket]
  );
  const count = result.rows[0]?.request_count ?? limit + 1;
  return count <= limit ? { allowed: true } : {
    allowed: false,
    retryAfterSeconds: 60 - Math.floor((Date.now() % 60000) / 1000)
  };
}

export function cloudRuntime() {
  return state().runtime;
}

export async function cloudDatabaseReady(): Promise<boolean> {
  const result = await state().db.query<{
    projects: string | null;
    history: string | null;
    tokens: string | null;
    rate_limits: string | null;
  }>(`SELECT
    to_regclass('public.ship_check_projects')::text AS projects,
    to_regclass('public.ship_check_history_events')::text AS history,
    to_regclass('public.ship_check_api_tokens')::text AS tokens,
    to_regclass('public.ship_check_rate_limits')::text AS rate_limits`);
  const row = result.rows[0];
  return Boolean(row?.projects && row.history && row.tokens && row.rate_limits);
}
