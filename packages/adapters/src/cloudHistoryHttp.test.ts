import { describe, expect, it, vi } from "vitest";
import {
  CloudProjectHistoryExportSchema,
  ProjectHistoryMetadataSchema,
  ProjectHistoryTimelineSchema,
  type CloudAccount,
  type CloudProject
} from "@ship-check/schemas";
import {
  CloudHistoryServiceOperationError,
  type CloudHistoryService
} from "./cloudHistoryService.js";
import {
  createCloudHistoryHttpHandler,
  type CloudHistoryHttpRequest
} from "./cloudHistoryHttp.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const authSubjectHash = "d".repeat(64);

const principal = {
  schemaVersion: "0.1" as const,
  authSubjectHash
};

const account: CloudAccount = {
  schemaVersion: "0.1",
  id: accountId,
  authSubjectHash,
  createdAt: "2026-09-19T10:00:00.000Z"
};

const metadata = ProjectHistoryMetadataSchema.parse({
  schemaVersion: "0.1",
  type: "assurance-metadata",
  provider: "ship-check",
  project: {
    identity: {
      algorithm: "sha256",
      scope: "project-source-v1",
      value: "a".repeat(64)
    },
    identityBasis: "primary-evidence",
    evidenceSources: [{
      type: "source",
      provider: "github",
      acquisition: "ci",
      executionLocation: "ci-runner",
      capabilities: ["source-files"],
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

const project: CloudProject = {
  schemaVersion: "0.1",
  id: projectId,
  accountId,
  projectIdentity: metadata.project.identity,
  identityBasis: metadata.project.identityBasis,
  displayName: "Example",
  syncLevel: "assurance-metadata",
  retention: "90-days",
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z"
};

const timeline = ProjectHistoryTimelineSchema.parse({
  schemaVersion: "0.1",
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

function service(overrides: Partial<CloudHistoryService> = {}): CloudHistoryService {
  const base: CloudHistoryService = {
    resolveAccount: vi.fn(async () => account),
    connectProject: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      account,
      project,
      ingest: {
        schemaVersion: "0.1" as const,
        projectId,
        scan: metadata.scan.identity,
        status: "stored" as const,
        ingestedAt: "2026-09-19T11:00:00.000Z",
        expiresAt: "2026-12-18T11:00:00.000Z"
      }
    })),
    getProject: vi.fn(async () => project),
    listProjects: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      projects: [project]
    })),
    getTimeline: vi.fn(async () => timeline),
    sync: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      projectId,
      scan: metadata.scan.identity,
      status: "duplicate" as const,
      ingestedAt: "2026-09-19T11:00:00.000Z",
      expiresAt: "2026-12-18T11:00:00.000Z"
    })),
    exportProject: vi.fn(async () => CloudProjectHistoryExportSchema.parse({
      schemaVersion: "0.1",
      type: "ship-check-project-history-export",
      project,
      timeline,
      exportedAt: "2026-09-19T11:00:00.000Z"
    })),
    updateDisplayName: vi.fn(async (_principal, request) => ({
      ...project,
      ...(request.displayName === null ? { displayName: undefined } : { displayName: request.displayName }),
      updatedAt: "2026-09-19T11:00:00.000Z"
    })),
    updateRetention: vi.fn(async (_principal, request) => ({
      ...project,
      retention: request.retention,
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
    }))
  };
  return { ...base, ...overrides };
}

function request(
  overrides: Partial<CloudHistoryHttpRequest> = {}
): CloudHistoryHttpRequest {
  return {
    method: "GET",
    path: `/v1/projects/${projectId}`,
    auth: {
      principal,
      mutationAuthorised: true
    },
    ...overrides
  };
}

function parsedBody(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("cloud history HTTP transport", () => {
  it("requires authentication before route execution", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const response = await handler(request({ auth: null }));

    expect(response.status).toBe(401);
    expect(parsedBody(response).code).toBe("unauthenticated");
    expect(cloudService.getProject).not.toHaveBeenCalled();
  });

  it("requires mutation authorisation for state-changing routes", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const response = await handler(request({
      method: "DELETE",
      auth: { principal, mutationAuthorised: false }
    }));

    expect(response.status).toBe(403);
    expect(parsedBody(response).code).toBe("mutation-not-authorised");
    expect(cloudService.deleteProject).not.toHaveBeenCalled();
  });

  it("lists connected projects from bounded query parameters", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const response = await handler(request({
      path: "/v1/projects?limit=25&cursor=abc_DEF-123"
    }));

    expect(response.status).toBe(200);
    expect(parsedBody(response).projects).toEqual([project]);
    expect(cloudService.listProjects).toHaveBeenCalledWith(principal, {
      schemaVersion: "0.1",
      limit: 25,
      cursor: "abc_DEF-123"
    });
  });

  it("rejects invalid project-list limits and invalid cursor domain errors as 400", async () => {
    const handler = createCloudHistoryHttpHandler(service());

    const badLimit = await handler(request({
      path: "/v1/projects?limit=101"
    }));
    expect(badLimit.status).toBe(400);
    expect(parsedBody(badLimit).code).toBe("invalid-request");

    const badCursorHandler = createCloudHistoryHttpHandler(service({
      listProjects: vi.fn(async () => {
        throw new CloudHistoryServiceOperationError(
          "project-list-cursor-invalid",
          "Project list cursor is invalid or no longer usable."
        );
      })
    }));
    const badCursor = await badCursorHandler(request({
      path: "/v1/projects?cursor=e30"
    }));
    expect(badCursor.status).toBe(400);
    expect(parsedBody(badCursor).code).toBe("invalid-request");
  });

  it("serves the source-free timeline without download semantics", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const response = await handler(request({
      path: `/v1/projects/${projectId}/timeline`
    }));

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(parsedBody(response).type).toBe("project-history-timeline");
    expect(cloudService.getTimeline).toHaveBeenCalledWith(principal, projectId);
  });

  it("serves project reads with no-store security headers", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(parsedBody(response).id).toBe(projectId);
  });

  it("connects a project only from bounded JSON", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);
    const body = JSON.stringify({
      schemaVersion: "0.1",
      event: metadata,
      retention: "90-days",
      displayName: "Example"
    });

    const response = await handler(request({
      method: "POST",
      path: "/v1/projects/connect",
      contentType: "application/json; charset=utf-8",
      body
    }));

    expect(response.status).toBe(200);
    expect(cloudService.connectProject).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ retention: "90-days", displayName: "Example" })
    );
  });

  it("rejects wrong content type, invalid JSON and oversized bodies", async () => {
    const normalHandler = createCloudHistoryHttpHandler(service(), { maxBodyBytes: 64 * 1024 });
    const valid = JSON.stringify({
      schemaVersion: "0.1",
      event: metadata,
      retention: "90-days"
    });

    expect((await normalHandler(request({
      method: "POST",
      path: "/v1/projects/connect",
      contentType: "text/plain",
      body: valid
    }))).status).toBe(400);

    expect((await normalHandler(request({
      method: "POST",
      path: "/v1/projects/connect",
      contentType: "application/json",
      body: "{"
    }))).status).toBe(400);

    const boundedHandler = createCloudHistoryHttpHandler(service(), { maxBodyBytes: 1024 });
    const oversized = await boundedHandler(request({
      method: "POST",
      path: "/v1/projects/connect",
      contentType: "application/json",
      body: "x".repeat(1025)
    }));
    expect(oversized.status).toBe(413);
    expect(parsedBody(oversized).code).toBe("payload-too-large");
  });

  it("requires body projectId to match the route for sync and project updates", async () => {
    const handler = createCloudHistoryHttpHandler(service());
    const otherId = "33333333-3333-4333-8333-333333333333";

    const sync = await handler(request({
      method: "POST",
      path: `/v1/projects/${projectId}/events`,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "0.1",
        projectId: otherId,
        event: metadata
      })
    }));
    expect(sync.status).toBe(400);

    const retention = await handler(request({
      method: "PATCH",
      path: `/v1/projects/${projectId}/retention`,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "0.1",
        projectId: otherId,
        retention: "30-days"
      })
    }));
    expect(retention.status).toBe(400);
  });

  it("routes explicit name and retention changes through the service", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const nameResponse = await handler(request({
      method: "PATCH",
      path: `/v1/projects/${projectId}/name`,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "0.1",
        projectId,
        displayName: null
      })
    }));
    expect(nameResponse.status).toBe(200);
    expect(cloudService.updateDisplayName).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ projectId, displayName: null })
    );

    const retentionResponse = await handler(request({
      method: "PATCH",
      path: `/v1/projects/${projectId}/retention`,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "0.1",
        projectId,
        retention: "30-days"
      })
    }));
    expect(retentionResponse.status).toBe(200);
    expect(cloudService.updateRetention).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ projectId, retention: "30-days" })
    );
  });

  it("exports history as no-store downloadable JSON", async () => {
    const handler = createCloudHistoryHttpHandler(service());

    const response = await handler(request({
      path: `/v1/projects/${projectId}/export`
    }));

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-disposition"]).toContain(projectId);
    expect(parsedBody(response).type).toBe("ship-check-project-history-export");
  });

  it("maps expected service errors to bounded 404/409 responses", async () => {
    const notFound = createCloudHistoryHttpHandler(service({
      getProject: vi.fn(async () => {
        throw new CloudHistoryServiceOperationError("project-not-found", "Project was not found for this account.");
      })
    }));
    const missing = await notFound(request());
    expect(missing.status).toBe(404);
    expect(parsedBody(missing).code).toBe("not-found");

    const conflict = createCloudHistoryHttpHandler(service({
      sync: vi.fn(async () => {
        throw new CloudHistoryServiceOperationError(
          "history-conflict",
          "This scan identity is already associated with different assurance metadata."
        );
      })
    }));
    const conflictResponse = await conflict(request({
      method: "POST",
      path: `/v1/projects/${projectId}/events`,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "0.1",
        projectId,
        event: metadata
      })
    }));
    expect(conflictResponse.status).toBe(409);
    expect(parsedBody(conflictResponse).code).toBe("conflict");
  });

  it("does not expose unexpected infrastructure error details", async () => {
    const internal = new Error("postgresql://secret-user:secret-pass@private-db/internal");
    const onInternalError = vi.fn();
    const handler = createCloudHistoryHttpHandler(service({
      getProject: vi.fn(async () => {
        throw internal;
      })
    }), { onInternalError });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(parsedBody(response).code).toBe("internal-error");
    expect(response.body).not.toContain("postgresql://");
    expect(response.body).not.toContain("secret-pass");
    expect(onInternalError).toHaveBeenCalledWith(internal);
  });

  it("returns method guidance and account deletion through explicit routes", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const wrongMethod = await handler(request({
      method: "PUT",
      path: `/v1/projects/${projectId}`
    }));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe("GET, DELETE");

    const deleted = await handler(request({
      method: "DELETE",
      path: "/v1/account"
    }));
    expect(deleted.status).toBe(200);
    expect(cloudService.deleteAccount).toHaveBeenCalledWith(principal);
  });

  it("rejects malformed project identifiers before calling the service", async () => {
    const cloudService = service();
    const handler = createCloudHistoryHttpHandler(cloudService);

    const response = await handler(request({
      path: "/v1/projects/not-a-uuid"
    }));

    expect(response.status).toBe(400);
    expect(parsedBody(response).code).toBe("invalid-request");
    expect(cloudService.getProject).not.toHaveBeenCalled();
  });
});
