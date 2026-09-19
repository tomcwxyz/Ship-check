import { Pool, type PoolClient } from "pg";
import type {
  CloudHistoryDatabase,
  CloudHistoryQueryResult,
  CloudHistorySqlExecutor
} from "@ship-check/adapters";

export type PgCloudHistoryDatabaseOptions = {
  connectionString?: string;
  pool?: Pool;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  applicationName?: string;
};

export type PgCloudHistoryDatabase = {
  database: CloudHistoryDatabase;
  close(): Promise<void>;
};

function validateConnectionString(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Cloud Postgres connection string must be a valid URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Cloud database must use a PostgreSQL connection string.");
  }
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error(
      "Cloud Postgres connection string must include a host and database."
    );
  }

  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new Error(
      `${label} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return resolved;
}

function sqlExecutor(
  queryable: Pick<Pool | PoolClient, "query">
): CloudHistorySqlExecutor {
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[]
    ): Promise<CloudHistoryQueryResult<Row>> {
      const result = values
        ? await queryable.query(text, [...values])
        : await queryable.query(text);

      return {
        rows: result.rows as Row[],
        ...(result.rowCount !== null ? { rowCount: result.rowCount } : {})
      };
    }
  };
}

export function createPgCloudHistoryDatabase(
  options: PgCloudHistoryDatabaseOptions
): PgCloudHistoryDatabase {
  if (options.pool && options.connectionString) {
    throw new Error(
      "Provide either an existing Postgres pool or a connection string, not both."
    );
  }

  const maxConnections = boundedInteger(
    options.maxConnections,
    5,
    1,
    20,
    "Cloud Postgres maxConnections"
  );
  const connectionTimeoutMs = boundedInteger(
    options.connectionTimeoutMs,
    5_000,
    250,
    30_000,
    "Cloud Postgres connectionTimeoutMs"
  );

  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new Pool({
      connectionString: validateConnectionString(
        options.connectionString ??
          (() => {
            throw new Error(
              "Cloud Postgres connection string is required when no pool is supplied."
            );
          })()
      ),
      max: maxConnections,
      connectionTimeoutMillis: connectionTimeoutMs,
      application_name: options.applicationName ?? "ship-check-cloud"
    });

  const direct = sqlExecutor(pool);

  const database: CloudHistoryDatabase = {
    query: direct.query,
    async transaction<T>(
      run: (transaction: CloudHistorySqlExecutor) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run(sqlExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original operation error authoritative.
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };

  return {
    database,
    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    }
  };
}
