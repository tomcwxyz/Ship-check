import { describe, expect, it } from "vitest";
import {
  ProjectHistoryMetadataSchema,
  type ProjectHistoryMetadata
} from "@ship-check/schemas";
import {
  createCloudHistoryStore,
  hashCloudAuthSubject,
  retentionExpiry,
  type CloudHistoryDatabase,
  type CloudHistoryQueryResult,
  type CloudHistorySqlExecutor
} from "./cloudHistoryStore.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const projectIdentity = "a".repeat(64);
const scanIdentity = "b".repeat(64);
const ruleset = "c".repeat(64);

function event(options: { change?: ProjectHistoryMetadata["change"]; scan?: string } = {}) {
  return ProjectHistoryMetadataSchema.parse({
    schemaVersion: "0.1",
    type: "assurance-metadata",
    provider: "ship-check",
    project: {
      identity: {
        algorithm: "sha256",
        scope: "project-source-v1",
        value: projectIdentity
      },
      identityBasis: "primary-evidence",
      evidenceSources: [{
        type: "source",
        provider: "github",
        acquisition: "ci",
        executionLocation: "ci-runner",
        capabilities: ["source-files", "ci-context"],
        count: 1
      }]
    },
    scan: {
      identity: {
        algorithm: "sha256",
        scope: "scan-event-v1",
        value: options.scan ?? scanIdentity
      },
      generatedAt: "2026-09-19T09:00:00.000Z",
      engineVersion: "0.0.0-test",
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: ruleset,
        checkCount: 1
      },
      packs: ["secure-build"],
      checkCount: 1
    },
    counts: {
      findings: 1,
      suppressed: 0,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0,
      unverified: 1,
      resolved: 0,
      observed: 0,
      notAssessed: 0,
      checkErrors: 0
    },
    coverage: [{
      area: "secrets",
      status: "assessed",
      checkCount: 1
    }],
    ...(options.change ? { change: options.change } : {})
  });
}

const projectRow = {
  id: projectId,
  account_id: accountId,
  project_identity: projectIdentity,
  identity_basis: "primary-evidence" as const,
  display_name: "Example project",
  retention_policy: "90-days" as const,
  created_at: "2026-09-19T08:00:00.000Z",
  updated_at: "2026-09-19T08:00:00.000Z"
};

type QueuedResponse = CloudHistoryQueryResult<Record<string, unknown>>;

class FakeDatabase implements CloudHistoryDatabase {
  calls: Array<{ text: string; values: readonly unknown[] }> = [];
  responses: QueuedResponse[];

  constructor(responses: QueuedResponse[]) {
    this.responses = [...responses];
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<CloudHistoryQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected SQL query in fake database.");
    return response as CloudHistoryQueryResult<Row>;
  }

  async transaction<T>(run: (transaction: CloudHistorySqlExecutor) => Promise<T>): Promise<T> {
    return run(this);
  }
}

function historyRow(value: ProjectHistoryMetadata, options: { ingestedAt?: string; expiresAt?: string | null } = {}) {
  return {
    payload: value,
    ingested_at: options.ingestedAt ?? "2026-09-19T10:00:00.000Z",
    expires_at: options.expiresAt ?? "2026-12-18T10:00:00.000Z"
  };
}

describe("cloud history privacy helpers", () => {
  it("hashes auth issuer + subject deterministically without returning either input", () => {
    const hash = hashCloudAuthSubject("https://auth.example", "user-123");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashCloudAuthSubject("https://auth.example", "user-123"));
    expect(hash).not.toContain("user-123");
    expect(hash).not.toContain("auth.example");
    expect(hash).not.toBe(hashCloudAuthSubject("https://auth.example", "user-456"));
  });

  it("calculates explicit retention expiry and keeps until-deleted unbounded", () => {
    expect(retentionExpiry("30-days", "2026-09-19T10:00:00.000Z"))
      .toBe("2026-10-19T10:00:00.000Z");
    expect(retentionExpiry("90-days", "2026-09-19T10:00:00.000Z"))
      .toBe("2026-12-18T10:00:00.000Z");
    expect(retentionExpiry("until-deleted", "2026-09-19T10:00:00.000Z"))
      .toBeNull();
  });
});

describe("cloud history store", () => {
  it("registers an opaque account and scopes projects to account identity", async () => {
    const authSubjectHash = "d".repeat(64);
    const db = new FakeDatabase([
      {
        rows: [{
          id: accountId,
          auth_subject_hash: authSubjectHash,
          created_at: "2026-09-19T08:00:00.000Z"
        }]
      },
      {
        rows: [projectRow]
      }
    ]);
    const store = createCloudHistoryStore(db);

    const account = await store.registerAccount({
      id: accountId,
      authSubjectHash,
      createdAt: "2026-09-19T08:00:00.000Z"
    });
    const project = await store.createProject({
      id: projectId,
      accountId,
      projectIdentity: {
        algorithm: "sha256",
        scope: "project-source-v1",
        value: projectIdentity
      },
      identityBasis: "primary-evidence",
      displayName: "Example project",
      retention: "90-days",
      createdAt: "2026-09-19T08:00:00.000Z"
    });

    expect(account.authSubjectHash).toBe(authSubjectHash);
    expect(project.accountId).toBe(accountId);
    expect(project.syncLevel).toBe("assurance-metadata");
    expect(db.calls[1]?.values).toContain(accountId);
    expect(db.calls[1]?.text).toMatch(/account_id/i);
  });

  it("stores matching metadata with expiry derived from project retention", async () => {
    const value = event();
    const db = new FakeDatabase([
      { rows: [projectRow] },
      {
        rows: [historyRow(value)]
      }
    ]);
    const store = createCloudHistoryStore(db);

    const result = await store.ingest(
      accountId,
      projectId,
      value,
      "2026-09-19T10:00:00.000Z"
    );

    expect(result.status).toBe("stored");
    expect(result.expiresAt).toBe("2026-12-18T10:00:00.000Z");
    expect(db.calls[0]?.values).toEqual([projectId, accountId]);
    expect(db.calls[1]?.values).toContain(JSON.stringify(value));
  });

  it("rejects metadata for a different opaque project identity before storage", async () => {
    const value = ProjectHistoryMetadataSchema.parse({
      ...event(),
      project: {
        ...event().project,
        identity: {
          ...event().project.identity,
          value: "e".repeat(64)
        }
      }
    });
    const db = new FakeDatabase([{ rows: [projectRow] }]);
    const store = createCloudHistoryStore(db);

    await expect(store.ingest(accountId, projectId, value))
      .rejects.toThrow(/does not match the hosted project/i);
    expect(db.calls).toHaveLength(1);
  });

  it("treats an exact repeat as idempotent", async () => {
    const value = event();
    const db = new FakeDatabase([
      { rows: [projectRow] },
      { rows: [] },
      { rows: [historyRow(value)] }
    ]);
    const store = createCloudHistoryStore(db);

    const result = await store.ingest(
      accountId,
      projectId,
      value,
      "2026-09-19T10:05:00.000Z"
    );

    expect(result.status).toBe("duplicate");
    expect(result.ingestedAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("allows one-way enrichment with an explicit comparison block", async () => {
    const existing = event();
    const change: NonNullable<ProjectHistoryMetadata["change"]> = {
      basis: "pull-request-base",
      scope: "source",
      baselineCommit: "f".repeat(40),
      sourceSnapshot: "changed",
      findings: {
        introduced: 1,
        persistent: 0,
        reactivated: 0,
        accepted: 0,
        noLongerActive: 0
      },
      gaps: {
        introduced: 0,
        persistent: 1,
        noLongerActive: 0
      },
      surfaces: {
        introduced: 1,
        persistent: 0,
        noLongerObserved: 0
      }
    };
    const enriched = event({ change });
    const db = new FakeDatabase([
      { rows: [projectRow] },
      { rows: [] },
      { rows: [historyRow(existing)] },
      { rows: [], rowCount: 1 }
    ]);
    const store = createCloudHistoryStore(db);

    const result = await store.ingest(
      accountId,
      projectId,
      enriched,
      "2026-09-19T10:05:00.000Z"
    );

    expect(result.status).toBe("enriched");
    expect(db.calls[3]?.text).toMatch(/UPDATE ship_check_history_events/i);
    expect(String(db.calls[3]?.values[2])).toContain('"pull-request-base"');
  });

  it("rejects conflicting comparison metadata for the same scan identity", async () => {
    const firstChange: NonNullable<ProjectHistoryMetadata["change"]> = {
      basis: "pull-request-base",
      scope: "source",
      baselineCommit: "1".repeat(40),
      sourceSnapshot: "changed",
      findings: {
        introduced: 1,
        persistent: 0,
        reactivated: 0,
        accepted: 0,
        noLongerActive: 0
      },
      gaps: { introduced: 0, persistent: 0, noLongerActive: 0 },
      surfaces: { introduced: 0, persistent: 0, noLongerObserved: 0 }
    };
    const secondChange = {
      ...firstChange,
      baselineCommit: "2".repeat(40)
    } satisfies NonNullable<ProjectHistoryMetadata["change"]>;
    const db = new FakeDatabase([
      { rows: [projectRow] },
      { rows: [] },
      { rows: [historyRow(event({ change: firstChange }))] }
    ]);
    const store = createCloudHistoryStore(db);

    await expect(store.ingest(accountId, projectId, event({ change: secondChange })))
      .rejects.toThrow(/conflicting comparison metadata/i);
  });

  it("exports stored metadata through the portable timeline reducer", async () => {
    const first = event({ scan: "1".repeat(64) });
    const second = ProjectHistoryMetadataSchema.parse({
      ...event({ scan: "2".repeat(64) }),
      scan: {
        ...event({ scan: "2".repeat(64) }).scan,
        generatedAt: "2026-09-19T09:05:00.000Z"
      }
    });
    const db = new FakeDatabase([
      { rows: [projectRow] },
      { rows: [projectRow] },
      {
        rows: [
          historyRow(first),
          historyRow(second, { ingestedAt: "2026-09-19T10:05:00.000Z" })
        ]
      }
    ]);
    const store = createCloudHistoryStore(db);

    const exported = await store.exportProject(
      accountId,
      projectId,
      "2026-09-19T11:00:00.000Z"
    );

    expect(exported.timeline.eventCount).toBe(2);
    expect(exported.timeline.latestScan.value).toBe("2".repeat(64));
    expect(exported.project.displayName).toBe("Example project");
    expect(JSON.stringify(exported)).not.toContain("github.com");
  });

  it("updates retention for the project and all existing history rows", async () => {
    const updatedRow = {
      ...projectRow,
      retention_policy: "30-days" as const,
      updated_at: "2026-09-19T11:00:00.000Z"
    };
    const db = new FakeDatabase([
      { rows: [updatedRow] },
      { rows: [], rowCount: 2 }
    ]);
    const store = createCloudHistoryStore(db);

    const project = await store.updateRetention(
      accountId,
      projectId,
      "30-days",
      "2026-09-19T11:00:00.000Z"
    );

    expect(project.retention).toBe("30-days");
    expect(db.calls[0]?.values).toEqual([
      projectId,
      accountId,
      "30-days",
      "2026-09-19T11:00:00.000Z"
    ]);
    expect(db.calls[1]?.text).toMatch(/ingested_at \+ INTERVAL '30 days'/);
  });

  it("hard deletes a project with cascaded history and returns a bounded receipt", async () => {
    const db = new FakeDatabase([
      { rows: [{ count: "3" }] },
      { rows: [{ id: projectId }], rowCount: 1 }
    ]);
    const store = createCloudHistoryStore(db);

    const receipt = await store.deleteProject(
      accountId,
      projectId,
      "2026-09-19T11:00:00.000Z"
    );

    expect(receipt.deletedHistoryEvents).toBe(3);
    expect(db.calls[0]?.values).toEqual([projectId, accountId]);
    expect(db.calls[1]?.values).toEqual([projectId, accountId]);
  });

  it("hard deletes an account and reports cascaded project/history counts", async () => {
    const db = new FakeDatabase([
      { rows: [{ projects: "2", events: "7" }] },
      { rows: [{ id: accountId }], rowCount: 1 }
    ]);
    const store = createCloudHistoryStore(db);

    const receipt = await store.deleteAccount(
      accountId,
      "2026-09-19T11:00:00.000Z"
    );

    expect(receipt.deletedProjects).toBe(2);
    expect(receipt.deletedHistoryEvents).toBe(7);
    expect(db.calls[1]?.text).toMatch(/DELETE FROM ship_check_accounts/i);
  });

  it("prunes only expired rows in the system-level maintenance path", async () => {
    const db = new FakeDatabase([
      { rows: [{ scan_identity: scanIdentity }], rowCount: 1 }
    ]);
    const store = createCloudHistoryStore(db);

    expect(await store.pruneExpired("2026-12-18T10:00:01.000Z")).toBe(1);
    expect(db.calls[0]?.text).toMatch(/expires_at IS NOT NULL/i);
  });
});
