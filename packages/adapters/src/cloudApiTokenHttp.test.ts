import { describe, expect, it, vi } from "vitest";
import type {
  CloudApiTokenCreateResult,
  CloudApiTokenListResult,
  CloudApiTokenRecord,
  CloudAuthenticatedPrincipal
} from "@ship-check/schemas";
import type { CloudApiTokenService } from "./cloudApiTokenService.js";
import { createCloudApiTokenHttpHandler } from "./cloudApiTokenHttp.js";

const principal: CloudAuthenticatedPrincipal = {
  schemaVersion: "0.1",
  authSubjectHash: "a".repeat(64)
};

const record: CloudApiTokenRecord = {
  schemaVersion: "0.1",
  id: "22222222-2222-4222-8222-222222222222",
  accountId: "11111111-1111-4111-8111-111111111111",
  tokenPrefix: "shipcheck_ABCDEFGH",
  label: "CLI",
  scopes: ["history:read", "history:sync"],
  createdAt: "2026-09-19T20:00:00.000Z",
  expiresAt: "2026-12-18T20:00:00.000Z",
  revokedAt: null,
  lastUsedAt: null
};

const created: CloudApiTokenCreateResult = {
  schemaVersion: "0.1",
  token: `shipcheck_${"A".repeat(43)}`,
  record
};

const listed: CloudApiTokenListResult = {
  schemaVersion: "0.1",
  tokens: [record]
};

function service(): CloudApiTokenService {
  return {
    createToken: vi.fn(async () => created),
    listTokens: vi.fn(async () => listed),
    revokeToken: vi.fn(async () => ({ ...record, revokedAt: "2026-09-19T20:10:00.000Z" }))
  };
}

function request(
  method: string,
  path: string,
  body?: unknown
) {
  return {
    method,
    path,
    ...(body !== undefined
      ? { contentType: "application/json", body: JSON.stringify(body) }
      : {}),
    auth: {
      principal,
      mutationAuthorised: method !== "GET"
    }
  };
}

describe("cloud API token HTTP transport", () => {
  it("creates a scoped expiring token and returns the raw credential once", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenHttpHandler(tokenService);
    const response = await handler(request("POST", "/v1/tokens", {
      schemaVersion: "0.1",
      label: "CLI",
      scopes: ["history:read", "history:sync"],
      expiresInDays: 90
    }));

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toEqual(created);
    expect(tokenService.createToken).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        label: "CLI",
        scopes: ["history:read", "history:sync"],
        expiresInDays: 90
      })
    );
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("lists token records without returning raw credentials", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenHttpHandler(tokenService);
    const response = await handler(request("GET", "/v1/tokens"));

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual(listed);
    expect(JSON.stringify(body)).not.toContain(created.token);
  });

  it("revokes an account-scoped token by id", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenHttpHandler(tokenService);
    const response = await handler(
      request("DELETE", `/v1/tokens/${record.id}`)
    );

    expect(response.status).toBe(200);
    expect(tokenService.revokeToken).toHaveBeenCalledWith(principal, record.id);
    expect(JSON.parse(response.body).revokedAt).not.toBeNull();
  });

  it("requires mutation authorisation before token creation", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenHttpHandler(tokenService);
    const response = await handler({
      ...request("POST", "/v1/tokens", {
        schemaVersion: "0.1",
        scopes: ["history:read"],
        expiresInDays: 30
      }),
      auth: { principal, mutationAuthorised: false }
    });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).code).toBe("mutation-not-authorised");
    expect(tokenService.createToken).not.toHaveBeenCalled();
  });

  it("rejects explicitly denied operations", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenHttpHandler(tokenService);
    const response = await handler({
      ...request("GET", "/v1/tokens"),
      auth: {
        principal,
        requestAuthorised: false,
        mutationAuthorised: false
      }
    });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).code).toBe("operation-not-authorised");
    expect(tokenService.listTokens).not.toHaveBeenCalled();
  });

  it("bounds and validates token creation payloads", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenHttpHandler(tokenService, {
      maxBodyBytes: 1024
    });

    const malformed = await handler({
      method: "POST",
      path: "/v1/tokens",
      contentType: "application/json",
      body: "{",
      auth: { principal, mutationAuthorised: true }
    });
    expect(malformed.status).toBe(400);

    const oversized = await handler({
      method: "POST",
      path: "/v1/tokens",
      contentType: "application/json",
      body: JSON.stringify({ padding: "x".repeat(1500) }),
      auth: { principal, mutationAuthorised: true }
    });
    expect(oversized.status).toBe(413);
    expect(tokenService.createToken).not.toHaveBeenCalled();
  });
});
