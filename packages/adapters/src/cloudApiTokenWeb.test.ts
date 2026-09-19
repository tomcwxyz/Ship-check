import { describe, expect, it, vi } from "vitest";
import type {
  CloudApiTokenCreateResult,
  CloudApiTokenListResult,
  CloudApiTokenRecord,
  CloudAuthenticatedPrincipal
} from "@ship-check/schemas";
import type { CloudApiTokenService } from "./cloudApiTokenService.js";
import { createCloudApiTokenWebHandler } from "./cloudApiTokenWeb.js";

const principal: CloudAuthenticatedPrincipal = {
  schemaVersion: "0.1",
  authSubjectHash: "b".repeat(64)
};

const record: CloudApiTokenRecord = {
  schemaVersion: "0.1",
  id: "22222222-2222-4222-8222-222222222222",
  accountId: "11111111-1111-4111-8111-111111111111",
  tokenPrefix: "shipcheck_ABCDEFGH",
  scopes: ["history:read"],
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
    revokeToken: vi.fn(async () => record)
  };
}

describe("cloud API token Web binding", () => {
  it("authenticates before reading token-management bodies", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenWebHandler(tokenService, {
      authenticate: async () => null,
      maxBodyBytes: 1024
    });

    const response = await handler(new Request("https://cloud.example/v1/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "999999"
      },
      body: "{}"
    }));

    expect(response.status).toBe(401);
    expect(tokenService.createToken).not.toHaveBeenCalled();
  });

  it("rejects read-only sessions before reading a mutation body", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenWebHandler(tokenService, {
      authenticate: async () => ({
        principal,
        mutationAuthorised: false
      }),
      maxBodyBytes: 1024
    });

    const response = await handler(new Request("https://cloud.example/v1/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "999999"
      },
      body: "{}"
    }));

    expect(response.status).toBe(403);
    expect(tokenService.createToken).not.toHaveBeenCalled();
  });

  it("passes authorised session requests to the token service", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenWebHandler(tokenService, {
      authenticate: async () => ({
        principal,
        mutationAuthorised: true
      })
    });

    const response = await handler(new Request("https://cloud.example/v1/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "0.1",
        scopes: ["history:read"],
        expiresInDays: 30
      })
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(created);
  });

  it("keeps browser token-management auth separate from bearer route scopes", async () => {
    const tokenService = service();
    const handler = createCloudApiTokenWebHandler(tokenService, {
      authenticate: async () => ({
        principal,
        requestAuthorised: false,
        mutationAuthorised: false
      })
    });

    const response = await handler(
      new Request("https://cloud.example/v1/tokens")
    );

    expect(response.status).toBe(403);
    expect(tokenService.listTokens).not.toHaveBeenCalled();
  });
});
