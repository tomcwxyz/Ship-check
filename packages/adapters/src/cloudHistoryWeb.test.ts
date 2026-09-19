import { describe, expect, it, vi } from "vitest";
import {
  ProjectHistoryMetadataSchema,
  type CloudProject
} from "@ship-check/schemas";
import type { CloudHistoryService } from "./cloudHistoryService.js";
import { createCloudHistoryWebHandler } from "./cloudHistoryWeb.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const principal = {
  schemaVersion: "0.1" as const,
  authSubjectHash: "d".repeat(64)
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

function service(overrides: Partial<CloudHistoryService> = {}): CloudHistoryService {
  const base = {
    resolveAccount: vi.fn(),
    connectProject: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      account: {
        schemaVersion: "0.1" as const,
        id: accountId,
        authSubjectHash: principal.authSubjectHash,
        createdAt: "2026-09-19T10:00:00.000Z"
      },
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
    getTimeline: vi.fn(),
    sync: vi.fn(),
    exportProject: vi.fn(),
    updateDisplayName: vi.fn(),
    updateRetention: vi.fn(),
    deleteProject: vi.fn(),
    deleteAccount: vi.fn()
  } as unknown as CloudHistoryService;
  return Object.assign(base, overrides);
}

function auth(mutationAuthorised = true) {
  return {
    principal,
    mutationAuthorised
  };
}

describe("cloud history Web binding", () => {
  it("rejects unauthenticated requests before reading an oversized declared body", async () => {
    const cloudService = service();
    const authenticate = vi.fn(async () => null);
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate,
      maxBodyBytes: 1024
    });

    const response = await handler(new Request(
      "https://cloud.example/v1/projects/connect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999999"
        },
        body: "{}"
      }
    ));

    expect(response.status).toBe(401);
    expect((await response.json() as { code: string }).code).toBe("unauthenticated");
    expect(cloudService.connectProject).not.toHaveBeenCalled();
  });

  it("rejects explicitly denied operations before reading an oversized declared body", async () => {
    const cloudService = service();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => ({
        principal,
        requestAuthorised: false,
        mutationAuthorised: false
      }),
      maxBodyBytes: 1024
    });

    const response = await handler(new Request(
      "https://cloud.example/v1/projects/connect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999999"
        },
        body: "{}"
      }
    ));

    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("operation-not-authorised");
    expect(cloudService.connectProject).not.toHaveBeenCalled();
  });

  it("rejects read-only mutation principals before reading an oversized declared body", async () => {
    const cloudService = service();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => auth(false),
      maxBodyBytes: 1024
    });

    const response = await handler(new Request(
      "https://cloud.example/v1/projects/connect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "999999"
        },
        body: "{}"
      }
    ));

    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("mutation-not-authorised");
    expect(cloudService.connectProject).not.toHaveBeenCalled();
  });

  it("adapts authenticated Web reads into the bounded transport response", async () => {
    const cloudService = service();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => auth()
    });

    const response = await handler(new Request(
      `https://cloud.example/v1/projects/${projectId}?ignored=query`,
      { method: "GET" }
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json() as { id: string }).id).toBe(projectId);
    expect(cloudService.getProject).toHaveBeenCalledWith(principal, projectId);
  });

  it("preserves bounded project-list query parameters into the transport", async () => {
    const cloudService = service();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => auth()
    });

    const response = await handler(new Request(
      "https://cloud.example/v1/projects?limit=7&cursor=abc_DEF-123",
      { method: "GET" }
    ));

    expect(response.status).toBe(200);
    expect(cloudService.listProjects).toHaveBeenCalledWith(principal, {
      schemaVersion: "0.1",
      limit: 7,
      cursor: "abc_DEF-123"
    });
  });

  it("streams a bounded JSON mutation body into project connect", async () => {
    const cloudService = service();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => auth(),
      maxBodyBytes: 64 * 1024
    });

    const response = await handler(new Request(
      "https://cloud.example/v1/projects/connect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "0.1",
          event: metadata,
          retention: "90-days",
          displayName: "Example"
        })
      }
    ));

    expect(response.status).toBe(200);
    expect(cloudService.connectProject).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ retention: "90-days", displayName: "Example" })
    );
  });

  it("enforces the body bound while consuming the Web request stream", async () => {
    const cloudService = service();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => auth(),
      maxBodyBytes: 1024
    });

    const response = await handler(new Request(
      "https://cloud.example/v1/projects/connect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(1025)
      }
    ));

    expect(response.status).toBe(413);
    expect((await response.json() as { code: string }).code).toBe("payload-too-large");
    expect(cloudService.connectProject).not.toHaveBeenCalled();
  });

  it("fails closed when authentication infrastructure throws without leaking details", async () => {
    const cloudService = service();
    const authError = new Error("oidc private verifier key failed");
    const onAuthenticationError = vi.fn();
    const handler = createCloudHistoryWebHandler(cloudService, {
      authenticate: async () => { throw authError; },
      onAuthenticationError
    });

    const response = await handler(new Request(
      `https://cloud.example/v1/projects/${projectId}`,
      { method: "GET" }
    ));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("private verifier key");
    expect(onAuthenticationError).toHaveBeenCalledWith(authError);
    expect(cloudService.getProject).not.toHaveBeenCalled();
  });
});
