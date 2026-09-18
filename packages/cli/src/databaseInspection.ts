import { inspectPostgresDatabase } from "@ship-check/database-inspector";
import { liveDatabaseChecks } from "@ship-check/database-checks/live";
import { scanDatabaseMetadata } from "@ship-check/core/database";
import { DatabasePlatformSchema, type DatabasePlatform } from "@ship-check/schemas/databaseEvidence";
import type { CheckPack, ScanReport } from "@ship-check/schemas";
import type { CheckDefinition } from "@ship-check/core";

const DEFAULT_DATABASE_URL_ENV = "SHIP_CHECK_DATABASE_URL";
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type DatabaseInspectionCliValues = {
  inspectDatabase: boolean;
  databaseUrlEnv?: string;
  databasePlatform?: string;
  databaseTableLimit?: string;
};

export type ResolvedDatabaseInspection = {
  connectionString: string;
  envName: string;
  platform: DatabasePlatform;
  tableLimit?: number;
};

export function resolveDatabaseInspection(
  values: DatabaseInspectionCliValues,
  env: NodeJS.ProcessEnv = process.env
): ResolvedDatabaseInspection | null {
  const hasDatabaseOptions = Boolean(values.databaseUrlEnv || values.databasePlatform || values.databaseTableLimit);
  if (!values.inspectDatabase) {
    if (hasDatabaseOptions) {
      throw new Error("Database inspection options require --inspect-database. Ship Check never opens a database connection implicitly.");
    }
    return null;
  }

  const envName = values.databaseUrlEnv?.trim() || DEFAULT_DATABASE_URL_ENV;
  if (!envNamePattern.test(envName)) {
    throw new Error("--database-url-env must name an environment variable, not contain a connection URL or shell expression.");
  }
  const connectionString = env[envName]?.trim();
  if (!connectionString) {
    throw new Error(`--inspect-database requires a PostgreSQL connection URL in the ${envName} environment variable.`);
  }

  const platform = DatabasePlatformSchema.parse(values.databasePlatform?.trim() || "postgres");
  let tableLimit: number | undefined;
  if (values.databaseTableLimit !== undefined) {
    tableLimit = Number(values.databaseTableLimit);
    if (!Number.isInteger(tableLimit) || tableLimit < 1 || tableLimit > 5000) {
      throw new Error("--database-table-limit must be an integer from 1 to 5000.");
    }
  }

  return { connectionString, envName, platform, tableLimit };
}

export async function scanConfiguredDatabase(input: {
  inspection: ResolvedDatabaseInspection;
  sourceChecks: CheckDefinition[];
  packs: CheckPack[];
  version: string;
}): Promise<ScanReport> {
  const metadata = await inspectPostgresDatabase({
    connectionString: input.inspection.connectionString,
    platform: input.inspection.platform,
    tableLimit: input.inspection.tableLimit
  });
  const checks = liveDatabaseChecks.filter((check) => input.packs.includes(check.pack));
  return scanDatabaseMetadata(metadata, input.sourceChecks, checks, input.version);
}
