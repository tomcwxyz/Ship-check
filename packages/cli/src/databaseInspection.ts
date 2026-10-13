import { inspectPostgresDatabase } from "@ship-check/database-inspector";
import { liveDatabaseChecks } from "@ship-check/database-checks/live";
import { createLiveMigrationComparisonCheck } from "@ship-check/database-checks";
import { loadMigrationManifest } from "./migrationManifest.js";
import { scanDatabaseMetadata } from "@ship-check/core/database";
import { DatabasePlatformSchema, MigrationFrameworkSchema, type DatabasePlatform, type MigrationFramework } from "@ship-check/schemas/databaseEvidence";
import type { CheckPack, ScanReport } from "@ship-check/schemas";
import type { CheckDefinition } from "@ship-check/core";

const DEFAULT_DATABASE_URL_ENV = "SHIP_CHECK_DATABASE_URL";
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type DatabaseInspectionCliValues = {
  inspectDatabase: boolean;
  databaseUrlEnv?: string;
  databasePlatform?: string;
  databaseTableLimit?: string;
  inspectMigrations?: boolean;
  migrationFramework?: string;
};

export type ResolvedDatabaseInspection = {
  connectionString: string;
  envName: string;
  platform: DatabasePlatform;
  tableLimit?: number;
  migrationFramework?: MigrationFramework;
};

export function resolveDatabaseInspection(
  values: DatabaseInspectionCliValues,
  env: NodeJS.ProcessEnv = process.env
): ResolvedDatabaseInspection | null {
  const hasDatabaseOptions = Boolean(values.databaseUrlEnv || values.databasePlatform || values.databaseTableLimit || values.inspectMigrations || values.migrationFramework);
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

  if (values.migrationFramework && !values.inspectMigrations) throw new Error("--migration-framework requires --inspect-migrations.");
  if (values.inspectMigrations && !values.migrationFramework) throw new Error("--inspect-migrations requires --migration-framework drizzle|prisma|supabase.");
  const migrationFramework = values.inspectMigrations ? MigrationFrameworkSchema.parse(values.migrationFramework) : undefined;
  const platform = DatabasePlatformSchema.parse(values.databasePlatform?.trim() || "postgres");
  let tableLimit: number | undefined;
  if (values.databaseTableLimit !== undefined) {
    tableLimit = Number(values.databaseTableLimit);
    if (!Number.isInteger(tableLimit) || tableLimit < 1 || tableLimit > 5000) {
      throw new Error("--database-table-limit must be an integer from 1 to 5000.");
    }
  }

  return { connectionString, envName, platform, tableLimit, ...(migrationFramework ? { migrationFramework } : {}) };
}

export async function scanConfiguredDatabase(input: {
  inspection: ResolvedDatabaseInspection;
  sourceChecks: CheckDefinition[];
  packs: CheckPack[];
  version: string;
  sourceProjectPath?: string;
}): Promise<ScanReport> {
  const metadata = await inspectPostgresDatabase({
    connectionString: input.inspection.connectionString,
    platform: input.inspection.platform,
    tableLimit: input.inspection.tableLimit,
    migrationFramework: input.inspection.migrationFramework
  });
  const checks = liveDatabaseChecks.filter((check) => input.packs.includes(check.pack));
  if (input.inspection.migrationFramework) {
    if (!input.sourceProjectPath) throw new Error("--inspect-migrations requires project source files, not only a deployment URL.");
    const manifest = await loadMigrationManifest(input.sourceProjectPath, input.inspection.migrationFramework);
    checks.push(createLiveMigrationComparisonCheck(manifest));
  }
  return scanDatabaseMetadata(metadata, input.sourceChecks, checks, input.version);
}
