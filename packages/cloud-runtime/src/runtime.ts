import { createHash } from "node:crypto";
import {
  createCloudApiTokenService,
  createCloudApiTokenStore,
  createCloudHistoryService,
  createCloudHistoryStore,
  createCloudR0WebHandler,
  type CloudApiTokenService,
  type CloudHistoryDatabase,
  type CloudHistoryService,
  type CloudHistoryWebAuthenticator,
  type CloudR0RateLimitContext,
  type CloudR0RateLimitDecision,
  type CloudR0WebHandler
} from "@ship-check/adapters";
import {
  createPgCloudHistoryDatabase,
  type PgCloudHistoryDatabaseOptions
} from "./postgres.js";

export type CloudPersistentRateLimitOptions = {
  windowSeconds?: number;
  sessionLimit?: number;
  bearerLimit?: number;
};

export type CloudRuntimeOptions = {
  authenticateSession: CloudHistoryWebAuthenticator;
  database?: CloudHistoryDatabase;
  postgres?: Omit<PgCloudHistoryDatabaseOptions, "pool">;
  allowedOrigins?: string[];
  rateLimit?: (
    context: CloudR0RateLimitContext
  ) => Promise<CloudR0RateLimitDecision> | CloudR0RateLimitDecision;
  persistentRateLimit?: CloudPersistentRateLimitOptions;
  maxHistoryBodyBytes?: number;
  maxTokenBodyBytes?: number;
  onInternalError?: (error: unknown) => void;
  onAuthenticationError?: (error: unknown) => void;
};

export type CloudRuntime = {
  handler: CloudR0WebHandler;
  historyService: CloudHistoryService;
  tokenService: CloudApiTokenService;
  close(): Promise<void>;
};

const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s"'<>]+/gi;

export function redactCloudRuntimeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const redacted = new Error(
    error.message.replace(POSTGRES_URL, "[redacted-postgres-url]")
  );
  redacted.name = error.name;
  if (error.stack) {
    redacted.stack = error.stack.replace(
      POSTGRES_URL,
      "[redacted-postgres-url]"
    );
  }
  return redacted;
}


function boundedRateLimitInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function createPersistentRateLimit(
  database: CloudHistoryDatabase,
  options: CloudPersistentRateLimitOptions
): (context: CloudR0RateLimitContext) => Promise<CloudR0RateLimitDecision> {
  const windowSeconds = boundedRateLimitInteger(
    options.windowSeconds,
    60,
    10,
    3600,
    "Cloud rate-limit windowSeconds"
  );
  const sessionLimit = boundedRateLimitInteger(
    options.sessionLimit,
    60,
    1,
    10_000,
    "Cloud session rate limit"
  );
  const bearerLimit = boundedRateLimitInteger(
    options.bearerLimit,
    120,
    1,
    10_000,
    "Cloud bearer rate limit"
  );

  return async (context) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSeconds / windowSeconds);
    const keyHash = hashRateLimitKey(
      [
        context.credential,
        context.routeFamily,
        hashRateLimitKey(clientAddress(context.request))
      ].join(":")
    );

    const result = await database.query<{ request_count: number | string }>(
      `INSERT INTO ship_check_rate_limits (
         key_hash, window_bucket, request_count, updated_at
       )
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

    const count = Number(result.rows[0]?.request_count ?? 1);
    const limit = context.credential === "bearer" ? bearerLimit : sessionLimit;
    if (count <= limit) return { allowed: true };

    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        windowSeconds - (nowSeconds % windowSeconds)
      )
    };
  };
}

export function createCloudRuntime(options: CloudRuntimeOptions): CloudRuntime {
  if (options.database && options.postgres) {
    throw new Error(
      "Provide either an existing Cloud database or Postgres configuration, not both."
    );
  }
  if (options.rateLimit && options.persistentRateLimit) {
    throw new Error(
      "Provide either a custom Cloud rate limiter or persistentRateLimit configuration, not both."
    );
  }

  const pg = options.database
    ? null
    : createPgCloudHistoryDatabase({
        ...(options.postgres ?? {})
      });

  const database = options.database ?? pg!.database;
  const historyStore = createCloudHistoryStore(database);
  const tokenStore = createCloudApiTokenStore(database);
  const historyService = createCloudHistoryService(historyStore);
  const tokenService = createCloudApiTokenService(historyStore, tokenStore);

  const effectiveRateLimit =
    options.rateLimit ??
    (options.persistentRateLimit
      ? createPersistentRateLimit(database, options.persistentRateLimit)
      : undefined);

  const reportInternalError = options.onInternalError
    ? (error: unknown) =>
        options.onInternalError!(redactCloudRuntimeError(error))
    : undefined;
  const reportAuthenticationError = options.onAuthenticationError
    ? (error: unknown) =>
        options.onAuthenticationError!(redactCloudRuntimeError(error))
    : undefined;

  const handler = createCloudR0WebHandler(
    historyService,
    tokenService,
    tokenStore,
    {
      authenticateSession: options.authenticateSession,
      ...(options.allowedOrigins
        ? { allowedOrigins: options.allowedOrigins }
        : {}),
      ...(effectiveRateLimit ? { rateLimit: effectiveRateLimit } : {}),
      ...(options.maxHistoryBodyBytes !== undefined
        ? { maxHistoryBodyBytes: options.maxHistoryBodyBytes }
        : {}),
      ...(options.maxTokenBodyBytes !== undefined
        ? { maxTokenBodyBytes: options.maxTokenBodyBytes }
        : {}),
      ...(reportInternalError
        ? { onInternalError: reportInternalError }
        : {}),
      ...(reportAuthenticationError
        ? { onAuthenticationError: reportAuthenticationError }
        : {})
    }
  );

  return {
    handler,
    historyService,
    tokenService,
    async close(): Promise<void> {
      await pg?.close();
    }
  };
}
