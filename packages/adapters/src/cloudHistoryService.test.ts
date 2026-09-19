import { describe, expect, it, vi } from "vitest";
import {
  CloudProjectHistoryExportSchema,
  ProjectHistoryMetadataSchema,
  ProjectHistoryTimelineSchema,
  type CloudAccount,
  type CloudProject,
  type ProjectHistoryMetadata
} from "@ship-check/schemas";
import type { CloudHistoryStore } from "./cloudHistoryStore.js";
import {
  CloudHistoryServiceOperationError,
  createCloudHistoryService
} from "./cloudHistoryService.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const newProjectId = "33333333-3333-4333-8333-333333333333";
const authSubjectHash = "d".repeat(64);
const projectIdentity = "a".repeat(64);

const principal = {
  schemaVersion: "0.1" as const,
  authSubjectHash
};

const account: CloudAccount = {
  schemaVersion: "0.1" as const,
  id: accountId,
  authSubjectHash,
  createdAt: "2026-09-19T10:00:00.000Z"
};

const project: CloudProject = {
  schemaVersion: "0.1" as const,
  id: projectId,
  accountId,
  projectIdentity: {
    algorithm: "sha256",
    scope: "project-source-v1",
    value: projectIdentity
  },
  identityBasis: "primary-evidence",
  displayName: "Example",
  syncLevel: "assurance-metadata",
  retention: "90-days",
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z"
};

function event(): ProjectHistoryMetadata {
  return ProjectHistoryMetadataSchema.parse({
    schemaVersion: "0.1" as const,
    type: "assurance-metadata",
    provider: "ship-check",
    project: {
      identity: project.projectIdentity,
      identityBasis: project.identityBasis,
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
        value: "b".repeat(64)
      },
      generatedAt: "2026-09-19T09:00:00.000Z",
      engineVersion: "test",
      ruleset: {
        algorithm: "sha256",
        scope: "check-ruleset-v1",
        value: "c".repeat(64),
        checkCount: 1
      },
      packs: ["secure-build"],
      checkCount: 1
    },
    counts: {
      findings: 0,
      suppressed: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      unverified: 0,
      resolved: 0,
      observed: 0,
      notAssessed: 0,
      checkErrors: 0
    },
    coverage: []
  });
}

function store(overrides: Partial<CloudHistoryStore> = {}): CloudHistoryStore {
  const base: CloudHistoryStore = {
    registerAccount: vi.fn(async () => account),
    findAccountByAuthSubjectHash: vi.fn(async () => account),
    createProject: vi.fn(async (input) => ({
      ...project,
      id: input.id,
      displayName: input.displayName,
      retention: input.retention,
      createdAt: "2026-09-19T10:00:00.000Z",
      updatedAt: "2026-09-19T10:00:00.000Z"
    })),
    findProjectByIdentity: vi.fn(async () => project),
    getProject: vi.fn(async () => project),
    ingest: vi.fn(async (_accountId, resolvedProjectId, value) => ({
      schemaVersion: "0.1" as const,
      projectId: resolvedProjectId,
      scan: value.scan.identity,
      status: "stored" as const,
      ingestedAt: "2026-09-19T11:00:00.000Z",
      expiresAt: "2026-12-18T11:00:00.000Z"
    })),
    listEvents: vi.fn(async () => []),
    exportProject: vi.fn(async () => {
      const metadata = event();
      const timeline = ProjectHistoryTimelineSchema.parse({
        schemaVersion: "0.1" as const,
        type: "project-history-timeline",
        provider: "ship-check",
        project: {
          identity: metadata.project.identity,
          identityBasis: metadata.project.identityBasis
        },
        eventCount: 1,
        firstScan: metadata.scan.identity,
        latestScan: metadata.scan.identity,
        firstAt: metadata.scan.generatedAt,
        latestAt: metadata.scan.generatedAt,
        latestAttention: {
          findings: 0,
          suppressed: 0,
          critical: 0,
          high: 0,
          unverified: 0,
          notAssessed: 0,
          checkErrors: 0,
          coverage: { assessed: 0, partial: 0, notAssessed: 0 }
        },
        events: [{ event: metadata }]
      });
      return CloudProjectHistoryExportSchema.parse({
        schemaVersion: "0.1" as const,
        type: "ship-check-project-history-export",
        project,
        timeline,
        exportedAt: "2026-09-19T11:00:00.000Z"
      });
    }),
    updateDisplayName: vi.fn(async (_accountId, _projectId, displayName) => ({
      ...project,
      ...(displayName === null ? { displayName: undefined } : { displayName }),
      updatedAt: "2026-09-19T11:00:00.000Z"
    })),
    updateRetention: vi.fn(async (_accountId, _projectId, retention) => ({
      ...project,
      retention,
      updatedAt: "2026-09-19T11:00:00.000Z"
    })),
    deleteProject: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      projectId,
      deletedAt: "2026-09-19T11:00:00.000Z",
      deletedHistoryEvents: 2
    })),
    deleteAccount: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      accountId,
      deletedAt: "2026-09-19T11:00:00.000Z",
      deletedProjects: 1,
      deletedHistoryEvents: 2
    })),
    pruneExpired: vi.fn(async () => 0)
  };
  return { ...base, ...overrides };
}

const fixedNow = () => new Date("2026-09-19T11:00:00.000Z");

describe("cloud history service", () => {
  it("resolves an existing opaque account without registering another one", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    const resolved = await service.resolveAccount(principal);

    expect(resolved.id).toBe(accountId);
    expect(historyStore.findAccountByAuthSubjectHash).toHaveBeenCalledWith(authSubjectHash);
    expect(historyStore.registerAccount).not.toHaveBeenCalled();
  });

  it("registers an account when the verified subject hash is first seen", async () => {
    const historyStore = store({
      findAccountByAuthSubjectHash: vi.fn(async () => null)
    });
    const service = createCloudHistoryService(historyStore, {
      now: fixedNow,
      newId: () => accountId
    });

    const resolved = await service.resolveAccount(principal);

    expect(resolved.id).toBe(accountId);
    expect(historyStore.registerAccount).toHaveBeenCalledWith({
      id: accountId,
      authSubjectHash,
      createdAt: new Date("2026-09-19T11:00:00.000Z")
    });
  });

  it("connects a new project from the metadata identity and immediately ingests the event", async () => {
    const value = event();
    const historyStore = store({
      findProjectByIdentity: vi.fn(async () => null),
      createProject: vi.fn(async (input) => ({
        ...project,
        id: input.id,
        displayName: input.displayName,
        retention: input.retention,
        createdAt: "2026-09-19T11:00:00.000Z",
        updatedAt: "2026-09-19T11:00:00.000Z"
      }))
    });
    const service = createCloudHistoryService(historyStore, {
      now: fixedNow,
      newId: () => newProjectId
    });

    const result = await service.connectProject(principal, {
      schemaVersion: "0.1" as const,
      event: value,
      displayName: "Example",
      retention: "90-days"
    });

    expect(result.project.id).toBe(newProjectId);
    expect(historyStore.createProject).toHaveBeenCalledWith({
      id: newProjectId,
      accountId,
      projectIdentity: value.project.identity,
      identityBasis: value.project.identityBasis,
      displayName: "Example",
      retention: "90-days",
      createdAt: new Date("2026-09-19T11:00:00.000Z")
    });
    expect(historyStore.ingest).toHaveBeenCalledWith(
      accountId,
      newProjectId,
      value,
      new Date("2026-09-19T11:00:00.000Z")
    );
  });

  it("reconnects an existing project only when retention/name remain unchanged", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    const result = await service.connectProject(principal, {
      schemaVersion: "0.1" as const,
      event: event(),
      displayName: "Example",
      retention: "90-days"
    });

    expect(result.project.id).toBe(projectId);
    expect(historyStore.createProject).not.toHaveBeenCalled();
    expect(historyStore.ingest).toHaveBeenCalled();
  });

  it("requires retention changes to use the explicit retention operation", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    await expect(service.connectProject(principal, {
      schemaVersion: "0.1" as const,
      event: event(),
      displayName: "Example",
      retention: "30-days"
    })).rejects.toMatchObject({
      code: "project-retention-conflict"
    });

    expect(historyStore.ingest).not.toHaveBeenCalled();
  });

  it("requires display-name changes to be explicit rather than a sync side effect", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    await expect(service.connectProject(principal, {
      schemaVersion: "0.1" as const,
      event: event(),
      displayName: "Renamed",
      retention: "90-days"
    })).rejects.toMatchObject({
      code: "project-name-conflict"
    });

    expect(historyStore.ingest).not.toHaveBeenCalled();
  });

  it("scopes ordinary sync through the principal's account", async () => {
    const value = event();
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    await service.sync(principal, {
      schemaVersion: "0.1" as const,
      projectId,
      event: value
    });

    expect(historyStore.getProject).toHaveBeenCalledWith(accountId, projectId);
    expect(historyStore.ingest).toHaveBeenCalledWith(
      accountId,
      projectId,
      value,
      new Date("2026-09-19T11:00:00.000Z")
    );
  });

  it("maps storage conflicts to a bounded service error contract", async () => {
    const historyStore = store({
      ingest: vi.fn(async () => {
        throw new Error("Conflicting assurance metadata shares an existing scan identity.");
      })
    });
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    try {
      await service.sync(principal, {
        schemaVersion: "0.1" as const,
        projectId,
        event: event()
      });
      throw new Error("Expected conflict.");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudHistoryServiceOperationError);
      const contract = (error as CloudHistoryServiceOperationError).toContract();
      expect(contract).toEqual({
        schemaVersion: "0.1" as const,
        code: "history-conflict",
        message: "This scan identity is already associated with different assurance metadata."
      });
    }
  });

  it("exposes export, retention and deletion only after account-scoped project resolution", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    await service.exportProject(principal, projectId);
    await service.updateDisplayName(principal, {
      schemaVersion: "0.1" as const,
      projectId,
      displayName: "Renamed explicitly"
    });
    await service.updateRetention(principal, {
      schemaVersion: "0.1" as const,
      projectId,
      retention: "30-days"
    });
    await service.deleteProject(principal, projectId);

    expect(historyStore.exportProject).toHaveBeenCalledWith(
      accountId,
      projectId,
      new Date("2026-09-19T11:00:00.000Z")
    );
    expect(historyStore.updateDisplayName).toHaveBeenCalledWith(
      accountId,
      projectId,
      "Renamed explicitly",
      new Date("2026-09-19T11:00:00.000Z")
    );
    expect(historyStore.updateRetention).toHaveBeenCalledWith(
      accountId,
      projectId,
      "30-days",
      new Date("2026-09-19T11:00:00.000Z")
    );
    expect(historyStore.deleteProject).toHaveBeenCalledWith(
      accountId,
      projectId,
      new Date("2026-09-19T11:00:00.000Z")
    );
  });

  it("does not create an account as a side effect of an unknown project operation", async () => {
    const historyStore = store({
      findAccountByAuthSubjectHash: vi.fn(async () => null)
    });
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    await expect(service.getProject(principal, projectId)).rejects.toMatchObject({
      code: "account-not-found"
    });

    expect(historyStore.registerAccount).not.toHaveBeenCalled();
    expect(historyStore.getProject).not.toHaveBeenCalled();
  });

  it("deletes an account only when the authenticated subject hash resolves", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    const receipt = await service.deleteAccount(principal);
    expect(receipt.deletedHistoryEvents).toBe(2);
    expect(historyStore.deleteAccount).toHaveBeenCalledWith(
      accountId,
      new Date("2026-09-19T11:00:00.000Z")
    );

    const missingStore = store({
      findAccountByAuthSubjectHash: vi.fn(async () => null)
    });
    const missingService = createCloudHistoryService(missingStore, { now: fixedNow });
    await expect(missingService.deleteAccount(principal)).rejects.toMatchObject({
      code: "account-not-found"
    });
  });

  it("rejects unverified/raw identity-shaped principals at the service boundary", async () => {
    const historyStore = store();
    const service = createCloudHistoryService(historyStore, { now: fixedNow });

    await expect(service.resolveAccount({
      schemaVersion: "0.1" as const,
      authSubjectHash: "not-a-hash",
      subject: "raw-user-id"
    } as never)).rejects.toThrow();

    expect(historyStore.findAccountByAuthSubjectHash).not.toHaveBeenCalled();
  });
});
