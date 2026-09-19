import { ProjectHistoryMetadataSchema } from "@ship-check/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createCloudHistoryClient,
  resolveCloudClientConfig
} from "./cloud.js";

const token = `shipcheck_${"A".repeat(43)}`;
const event = ProjectHistoryMetadataSchema.parse({
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
      provider: "local",
      acquisition: "local",
      executionLocation: "user-device",
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
    generatedAt: "2026-09-19T20:00:00.000Z",
    engineVersion: "0.0.0-alpha.8",
    ruleset: {
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      value: "c".repeat(64),
      checkCount: 0
    },
    packs: [],
    checkCount: 0
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

describe("cloud history CLI client", () => {
  it("uses bearer auth and metadata-only connect payloads", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      const body = JSON.parse(String(init?.body));
      expect(body.event).toEqual(event);
      return new Response(JSON.stringify({
        schemaVersion: "0.1",
        account: {
          schemaVersion: "0.1",
          id: "11111111-1111-4111-8111-111111111111",
          authSubjectHash: "e".repeat(64),
          createdAt: "2026-09-19T20:00:00.000Z"
        },
        project: {
          schemaVersion: "0.1",
          id: "22222222-2222-4222-8222-222222222222",
          accountId: "11111111-1111-4111-8111-111111111111",
          projectIdentity: event.project.identity,
          identityBasis: "primary-evidence",
          syncLevel: "assurance-metadata",
          retention: "90-days",
          createdAt: "2026-09-19T20:00:00.000Z",
          updatedAt: "2026-09-19T20:00:00.000Z"
        },
        ingest: {
          schemaVersion: "0.1",
          projectId: "22222222-2222-4222-8222-222222222222",
          scan: event.scan.identity,
          status: "stored",
          ingestedAt: "2026-09-19T20:00:00.000Z",
          expiresAt: "2026-12-18T20:00:00.000Z"
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = createCloudHistoryClient({
      baseUrl: "https://cloud.example",
      token,
      fetchImpl
    });
    const result = await client.connectProject({ event, retention: "90-days" });

    expect(result.project.syncLevel).toBe("assurance-metadata");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed on non-HTTPS remote endpoints", () => {
    expect(() => createCloudHistoryClient({
      baseUrl: "http://cloud.example",
      token,
      fetchImpl: vi.fn()
    })).toThrow(/HTTPS/);
  });

  it("allows localhost HTTP for development", () => {
    expect(() => createCloudHistoryClient({
      baseUrl: "http://localhost:3000",
      token,
      fetchImpl: vi.fn()
    })).not.toThrow();
  });

  it("surfaces bounded cloud error contracts without exposing the token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: "0.1",
      type: "cloud-history-http-error",
      code: "operation-not-authorised",
      message: "Scope denied."
    }), { status: 403 }));

    const client = createCloudHistoryClient({
      baseUrl: "https://cloud.example",
      token,
      fetchImpl
    });

    await expect(client.listProjects()).rejects.toMatchObject({
      status: 403,
      code: "operation-not-authorised",
      message: "Scope denied."
    });
  });

  it("resolves URL and token from explicit environment variables", () => {
    expect(resolveCloudClientConfig({
      env: {
        SHIP_CHECK_CLOUD_URL: "https://cloud.example",
        SHIP_CHECK_CLOUD_TOKEN: token
      }
    })).toEqual({
      baseUrl: "https://cloud.example",
      token
    });
  });
});
