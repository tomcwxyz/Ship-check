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

export type CloudRuntimeOptions = {
  authenticateSession: CloudHistoryWebAuthenticator;
  database?: CloudHistoryDatabase;
  postgres?: Omit<PgCloudHistoryDatabaseOptions, "pool">;
  allowedOrigins?: string[];
  rateLimit?: (
    context: CloudR0RateLimitContext
  ) => Promise<CloudR0RateLimitDecision> | CloudR0RateLimitDecision;
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

export function createCloudRuntime(options: CloudRuntimeOptions): CloudRuntime {
  if (options.database && options.postgres) {
    throw new Error(
      "Provide either an existing Cloud database or Postgres configuration, not both."
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
      ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
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
