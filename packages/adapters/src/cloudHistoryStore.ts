import {
  CloudAccountDeletionReceiptSchema,
  CloudAccountSchema,
  CloudHistoryIngestResultSchema,
  CloudHistoryRetentionSchema,
  CloudHistoryStoredEventSchema,
  CloudProjectDeletionReceiptSchema,
  CloudProjectHistoryExportSchema,
  CloudProjectSchema,
  ProjectHistoryMetadataSchema,
  type CloudAccount,
  type CloudAccountDeletionReceipt,
  type CloudHistoryIngestResult,
  type CloudHistoryRetention,
  type CloudHistoryStoredEvent,
  type CloudProject,
  type CloudProjectDeletionReceipt,
  type CloudProjectHistoryExport,
  type ProjectHistoryMetadata
} from "@ship-check/schemas";
import { buildProjectHistoryTimeline } from "./timeline.js";

export type CloudHistoryQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount?: number;
};

export type CloudHistorySqlExecutor = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<CloudHistoryQueryResult<Row>>;
};

export type CloudHistoryDatabase = CloudHistorySqlExecutor & {
  transaction<T>(run: (transaction: CloudHistorySqlExecutor) => Promise<T>): Promise<T>;
};

type AccountRow = {
  id: string;
  auth_subject_hash: string;
  created_at: string | Date;
};

type ProjectRow = {
  id: string;
  account_id: string;
  project_identity: string;
  identity_basis: "primary-evidence" | "caller-provided";
  display_name: string | null;
  retention_policy: CloudHistoryRetention;
  created_at: string | Date;
  updated_at: string | Date;
};

type HistoryRow = {
  payload: unknown;
  ingested_at: string | Date;
  expires_at: string | Date | null;
};

const RETENTION_DAYS: Record<Exclude<CloudHistoryRetention, "until-deleted">, number> = {
  "30-days": 30,
  "90-days": 90,
  "180-days": 180,
  "365-days": 365
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
}

function withoutChange(event: ProjectHistoryMetadata): Omit<ProjectHistoryMetadata, "change"> {
  const { change: _change, ...base } = event;
  return base;
}

function sameCoreEvent(left: ProjectHistoryMetadata, right: ProjectHistoryMetadata): boolean {
  return canonical(withoutChange(left)) === canonical(withoutChange(right));
}

function sameChange(left: ProjectHistoryMetadata["change"], right: ProjectHistoryMetadata["change"]): boolean {
  return canonical(left ?? null) === canonical(right ?? null);
}

export function retentionExpiry(
  retention: CloudHistoryRetention,
  ingestedAt: string | Date
): string | null {
  CloudHistoryRetentionSchema.parse(retention);
  if (retention === "until-deleted") return null;
  const at = new Date(ingestedAt);
  if (Number.isNaN(at.getTime())) throw new Error("History ingestion time must be a valid date.");
  at.setUTCDate(at.getUTCDate() + RETENTION_DAYS[retention]);
  return at.toISOString();
}

function accountFromRow(row: AccountRow): CloudAccount {
  return CloudAccountSchema.parse({
    schemaVersion: "0.1",
    id: row.id,
    authSubjectHash: row.auth_subject_hash,
    createdAt: iso(row.created_at)
  });
}

function projectFromRow(row: ProjectRow): CloudProject {
  return CloudProjectSchema.parse({
    schemaVersion: "0.1",
    id: row.id,
    accountId: row.account_id,
    projectIdentity: {
      algorithm: "sha256",
      scope: "project-source-v1",
      value: row.project_identity
    },
    identityBasis: row.identity_basis,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    syncLevel: "assurance-metadata",
    retention: row.retention_policy,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

function storedEventFromRow(
  accountId: string,
  projectId: string,
  row: HistoryRow
): CloudHistoryStoredEvent {
  return CloudHistoryStoredEventSchema.parse({
    schemaVersion: "0.1",
    accountId,
    projectId,
    event: ProjectHistoryMetadataSchema.parse(row.payload),
    ingestedAt: iso(row.ingested_at),
    expiresAt: row.expires_at ? iso(row.expires_at) : null
  });
}

export type RegisterCloudAccountInput = {
  id: string;
  authSubjectHash: string;
  createdAt?: string | Date;
};

export type CreateCloudProjectInput = {
  id: string;
  accountId: string;
  projectIdentity: CloudProject["projectIdentity"];
  identityBasis: CloudProject["identityBasis"];
  displayName?: string;
  retention: CloudHistoryRetention;
  createdAt?: string | Date;
};

export type CloudHistoryStore = {
  registerAccount(input: RegisterCloudAccountInput): Promise<CloudAccount>;
  createProject(input: CreateCloudProjectInput): Promise<CloudProject>;
  getProject(accountId: string, projectId: string): Promise<CloudProject | null>;
  ingest(
    accountId: string,
    projectId: string,
    event: ProjectHistoryMetadata,
    ingestedAt?: string | Date
  ): Promise<CloudHistoryIngestResult>;
  listEvents(accountId: string, projectId: string): Promise<CloudHistoryStoredEvent[]>;
  exportProject(
    accountId: string,
    projectId: string,
    exportedAt?: string | Date
  ): Promise<CloudProjectHistoryExport>;
  updateRetention(
    accountId: string,
    projectId: string,
    retention: CloudHistoryRetention,
    updatedAt?: string | Date
  ): Promise<CloudProject>;
  deleteProject(
    accountId: string,
    projectId: string,
    deletedAt?: string | Date
  ): Promise<CloudProjectDeletionReceipt>;
  deleteAccount(
    accountId: string,
    deletedAt?: string | Date
  ): Promise<CloudAccountDeletionReceipt>;
  pruneExpired(now?: string | Date): Promise<number>;
};

export function createCloudHistoryStore(database: CloudHistoryDatabase): CloudHistoryStore {
  return {
    async registerAccount(input) {
      const createdAt = iso(input.createdAt ?? new Date());
      const result = await database.query<AccountRow>(
        `INSERT INTO ship_check_accounts (id, auth_subject_hash, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (auth_subject_hash)
         DO UPDATE SET auth_subject_hash = EXCLUDED.auth_subject_hash
         RETURNING id, auth_subject_hash, created_at`,
        [input.id, input.authSubjectHash, createdAt]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Cloud account registration did not return an account.");
      return accountFromRow(row);
    },

    async createProject(input) {
      const createdAt = iso(input.createdAt ?? new Date());
      const retention = CloudHistoryRetentionSchema.parse(input.retention);
      const parsed = CloudProjectSchema.pick({
        id: true,
        accountId: true,
        projectIdentity: true,
        identityBasis: true,
        displayName: true,
        retention: true
      }).parse({
        id: input.id,
        accountId: input.accountId,
        projectIdentity: input.projectIdentity,
        identityBasis: input.identityBasis,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        retention
      });

      const result = await database.query<ProjectRow>(
        `INSERT INTO ship_check_projects (
           id, account_id, project_identity, identity_basis, display_name,
           retention_policy, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (account_id, project_identity)
         DO UPDATE SET project_identity = EXCLUDED.project_identity
         RETURNING id, account_id, project_identity, identity_basis, display_name,
                   retention_policy, created_at, updated_at`,
        [
          parsed.id,
          parsed.accountId,
          parsed.projectIdentity.value,
          parsed.identityBasis,
          parsed.displayName ?? null,
          parsed.retention,
          createdAt
        ]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Cloud project creation did not return a project.");
      return projectFromRow(row);
    },

    async getProject(accountId, projectId) {
      const result = await database.query<ProjectRow>(
        `SELECT id, account_id, project_identity, identity_basis, display_name,
                retention_policy, created_at, updated_at
         FROM ship_check_projects
         WHERE id = $1 AND account_id = $2`,
        [projectId, accountId]
      );
      return result.rows[0] ? projectFromRow(result.rows[0]) : null;
    },

    async ingest(accountId, projectId, value, ingestedAt = new Date()) {
      const event = ProjectHistoryMetadataSchema.parse(value);
      const when = iso(ingestedAt);

      return database.transaction(async (transaction) => {
        const projectResult = await transaction.query<ProjectRow>(
          `SELECT id, account_id, project_identity, identity_basis, display_name,
                  retention_policy, created_at, updated_at
           FROM ship_check_projects
           WHERE id = $1 AND account_id = $2
           FOR UPDATE`,
          [projectId, accountId]
        );
        const projectRow = projectResult.rows[0];
        if (!projectRow) throw new Error("Cloud project was not found for this account.");
        const project = projectFromRow(projectRow);

        if (
          project.projectIdentity.value !== event.project.identity.value ||
          project.identityBasis !== event.project.identityBasis
        ) {
          throw new Error("Assurance metadata project identity does not match the hosted project.");
        }

        const expiresAt = retentionExpiry(project.retention, when);
        const inserted = await transaction.query<HistoryRow>(
          `INSERT INTO ship_check_history_events (
             project_id, scan_identity, generated_at, ingested_at, expires_at, payload
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (project_id, scan_identity) DO NOTHING
           RETURNING payload, ingested_at, expires_at`,
          [
            projectId,
            event.scan.identity.value,
            event.scan.generatedAt,
            when,
            expiresAt,
            JSON.stringify(event)
          ]
        );

        if (inserted.rows[0]) {
          return CloudHistoryIngestResultSchema.parse({
            schemaVersion: "0.1",
            projectId,
            scan: event.scan.identity,
            status: "stored",
            ingestedAt: when,
            expiresAt
          });
        }

        const existingResult = await transaction.query<HistoryRow>(
          `SELECT payload, ingested_at, expires_at
           FROM ship_check_history_events
           WHERE project_id = $1 AND scan_identity = $2
           FOR UPDATE`,
          [projectId, event.scan.identity.value]
        );
        const existingRow = existingResult.rows[0];
        if (!existingRow) {
          throw new Error("Conflicting history ingestion could not load the existing scan event.");
        }
        const existing = ProjectHistoryMetadataSchema.parse(existingRow.payload);

        if (!sameCoreEvent(existing, event)) {
          throw new Error("Conflicting assurance metadata shares an existing scan identity.");
        }

        if (sameChange(existing.change, event.change) || (existing.change && !event.change)) {
          return CloudHistoryIngestResultSchema.parse({
            schemaVersion: "0.1",
            projectId,
            scan: event.scan.identity,
            status: "duplicate",
            ingestedAt: iso(existingRow.ingested_at),
            expiresAt: existingRow.expires_at ? iso(existingRow.expires_at) : null
          });
        }

        if (!existing.change && event.change) {
          await transaction.query(
            `UPDATE ship_check_history_events
             SET payload = $3::jsonb
             WHERE project_id = $1 AND scan_identity = $2`,
            [projectId, event.scan.identity.value, JSON.stringify(event)]
          );
          return CloudHistoryIngestResultSchema.parse({
            schemaVersion: "0.1",
            projectId,
            scan: event.scan.identity,
            status: "enriched",
            ingestedAt: iso(existingRow.ingested_at),
            expiresAt: existingRow.expires_at ? iso(existingRow.expires_at) : null
          });
        }

        throw new Error("Conflicting comparison metadata shares an existing scan identity.");
      });
    },

    async listEvents(accountId, projectId) {
      const project = await this.getProject(accountId, projectId);
      if (!project) throw new Error("Cloud project was not found for this account.");
      const result = await database.query<HistoryRow>(
        `SELECT e.payload, e.ingested_at, e.expires_at
         FROM ship_check_history_events e
         JOIN ship_check_projects p ON p.id = e.project_id
         WHERE e.project_id = $1 AND p.account_id = $2
         ORDER BY e.generated_at ASC, e.scan_identity ASC`,
        [projectId, accountId]
      );
      return result.rows.map((row) => storedEventFromRow(accountId, projectId, row));
    },

    async exportProject(accountId, projectId, exportedAt = new Date()) {
      const project = await this.getProject(accountId, projectId);
      if (!project) throw new Error("Cloud project was not found for this account.");
      const stored = await this.listEvents(accountId, projectId);
      if (stored.length === 0) {
        throw new Error("Cloud project has no assurance metadata history to export.");
      }
      return CloudProjectHistoryExportSchema.parse({
        schemaVersion: "0.1",
        type: "ship-check-project-history-export",
        project,
        timeline: buildProjectHistoryTimeline(stored.map((entry) => entry.event)),
        exportedAt: iso(exportedAt)
      });
    },

    async updateRetention(accountId, projectId, value, updatedAt = new Date()) {
      const retention = CloudHistoryRetentionSchema.parse(value);
      const when = iso(updatedAt);

      return database.transaction(async (transaction) => {
        const result = await transaction.query<ProjectRow>(
          `UPDATE ship_check_projects
           SET retention_policy = $3, updated_at = $4
           WHERE id = $1 AND account_id = $2
           RETURNING id, account_id, project_identity, identity_basis, display_name,
                     retention_policy, created_at, updated_at`,
          [projectId, accountId, retention, when]
        );
        const row = result.rows[0];
        if (!row) throw new Error("Cloud project was not found for this account.");

        await transaction.query(
          `UPDATE ship_check_history_events
           SET expires_at = CASE $3
             WHEN '30-days' THEN ingested_at + INTERVAL '30 days'
             WHEN '90-days' THEN ingested_at + INTERVAL '90 days'
             WHEN '180-days' THEN ingested_at + INTERVAL '180 days'
             WHEN '365-days' THEN ingested_at + INTERVAL '365 days'
             WHEN 'until-deleted' THEN NULL
           END
           WHERE project_id = $1
             AND EXISTS (
               SELECT 1 FROM ship_check_projects p
               WHERE p.id = $1 AND p.account_id = $2
             )`,
          [projectId, accountId, retention]
        );
        return projectFromRow(row);
      });
    },

    async deleteProject(accountId, projectId, deletedAt = new Date()) {
      const when = iso(deletedAt);
      return database.transaction(async (transaction) => {
        const countResult = await transaction.query<{ count: string | number }>(
          `SELECT count(*)::bigint AS count
           FROM ship_check_history_events e
           JOIN ship_check_projects p ON p.id = e.project_id
           WHERE e.project_id = $1 AND p.account_id = $2`,
          [projectId, accountId]
        );
        const deleted = await transaction.query<{ id: string }>(
          `DELETE FROM ship_check_projects
           WHERE id = $1 AND account_id = $2
           RETURNING id`,
          [projectId, accountId]
        );
        if (!deleted.rows[0]) throw new Error("Cloud project was not found for this account.");
        return CloudProjectDeletionReceiptSchema.parse({
          schemaVersion: "0.1",
          projectId,
          deletedAt: when,
          deletedHistoryEvents: Number(countResult.rows[0]?.count ?? 0)
        });
      });
    },

    async deleteAccount(accountId, deletedAt = new Date()) {
      const when = iso(deletedAt);
      return database.transaction(async (transaction) => {
        const counts = await transaction.query<{ projects: string | number; events: string | number }>(
          `SELECT
             count(DISTINCT p.id)::bigint AS projects,
             count(e.scan_identity)::bigint AS events
           FROM ship_check_accounts a
           LEFT JOIN ship_check_projects p ON p.account_id = a.id
           LEFT JOIN ship_check_history_events e ON e.project_id = p.id
           WHERE a.id = $1`,
          [accountId]
        );
        const deleted = await transaction.query<{ id: string }>(
          `DELETE FROM ship_check_accounts
           WHERE id = $1
           RETURNING id`,
          [accountId]
        );
        if (!deleted.rows[0]) throw new Error("Cloud account was not found.");
        return CloudAccountDeletionReceiptSchema.parse({
          schemaVersion: "0.1",
          accountId,
          deletedAt: when,
          deletedProjects: Number(counts.rows[0]?.projects ?? 0),
          deletedHistoryEvents: Number(counts.rows[0]?.events ?? 0)
        });
      });
    },

    async pruneExpired(now = new Date()) {
      const result = await database.query<{ scan_identity: string }>(
        `DELETE FROM ship_check_history_events
         WHERE expires_at IS NOT NULL AND expires_at <= $1
         RETURNING scan_identity`,
        [iso(now)]
      );
      return result.rowCount ?? result.rows.length;
    }
  };
}
