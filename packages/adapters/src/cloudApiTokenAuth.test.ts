import { describe, expect, it, vi } from "vitest";
import type { CloudApiTokenStore } from "./cloudApiTokenStore.js";
import type { CloudHistoryService } from "./cloudHistoryService.js";
import { createCloudHistoryWebHandler } from "./cloudHistoryWeb.js";
import {
  createCloudApiTokenWebAuthenticator,
  requiredCloudApiTokenScope
} from "./cloudApiTokenAuth.js";

const rawToken = `shipcheck_${"A".repeat(43)}`;
const authSubjectHash = "d".repeat(64);
const tokenId = "22222222-2222-4222-8222-222222222222";
const accountId = "11111111-1111-4111-8111-111111111111";

function store(scopes: Array<"history:read" | "history:sync" | "project:manage">): CloudApiTokenStore {
  return {
    createToken: vi.fn(async () => {
      throw new Error("createToken is not used by bearer-auth tests.");
    }),
    listTokens: vi.fn(async () => []),
    revokeToken: vi.fn(async () => null),
    authenticateToken: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      tokenId,
      accountId,
      authSubjectHash,
      scopes
    }))
  };
}

function request(path: string, method = "GET", token = rawToken): Request {
  return new Request(`https://cloud.example${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
}

describe("cloud API token route scope policy", () => {
  it("maps only explicitly supported routes to narrow scopes", () => {
    expect(requiredCloudApiTokenScope(request("/v1/projects"))).toBe("history:read");
    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222"))).toBe("history:read");
    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222/timeline"))).toBe("history:read");
    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222/export"))).toBe("history:read");

    expect(requiredCloudApiTokenScope(request("/v1/projects/connect", "POST"))).toBe("history:sync");
    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222/events", "POST"))).toBe("history:sync");

    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222/name", "PATCH"))).toBe("project:manage");
    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222/retention", "PATCH"))).toBe("project:manage");
    expect(requiredCloudApiTokenScope(request("/v1/projects/22222222-2222-4222-8222-222222222222", "DELETE"))).toBe("project:manage");

    expect(requiredCloudApiTokenScope(request("/v1/account", "DELETE"))).toBeNull();
    expect(requiredCloudApiTokenScope(request("/v1/future-route"))).toBeNull();
  });
});

describe("cloud API token Web authenticator", () => {
  it("authenticates and authorises a read-scoped token only for read routes", async () => {
    const tokenStore = store(["history:read"]);
    const authenticate = createCloudApiTokenWebAuthenticator(tokenStore);

    const read = await authenticate(request("/v1/projects"));
    expect(read).toEqual({
      principal: {
        schemaVersion: "0.1",
        authSubjectHash
      },
      requestAuthorised: true,
      mutationAuthorised: false
    });

    const sync = await authenticate(request("/v1/projects/connect", "POST"));
    expect(sync).toMatchObject({
      requestAuthorised: false,
      mutationAuthorised: false
    });
  });

  it("allows history sync only on connect/event mutation routes", async () => {
    const authenticate = createCloudApiTokenWebAuthenticator(store(["history:sync"]));

    const connect = await authenticate(request("/v1/projects/connect", "POST"));
    expect(connect).toMatchObject({
      requestAuthorised: true,
      mutationAuthorised: true
    });

    const read = await authenticate(request("/v1/projects"));
    expect(read).toMatchObject({
      requestAuthorised: false,
      mutationAuthorised: false
    });
  });

  it("allows project management but never account deletion", async () => {
    const authenticate = createCloudApiTokenWebAuthenticator(store(["project:manage"]));

    const projectDelete = await authenticate(request(
      "/v1/projects/22222222-2222-4222-8222-222222222222",
      "DELETE"
    ));
    expect(projectDelete).toMatchObject({
      requestAuthorised: true,
      mutationAuthorised: true
    });

    const accountDelete = await authenticate(request("/v1/account", "DELETE"));
    expect(accountDelete).toMatchObject({
      requestAuthorised: false,
      mutationAuthorised: false
    });
  });

  it("does not treat one scope as implying another", async () => {
    const authenticate = createCloudApiTokenWebAuthenticator(
      store(["history:sync", "project:manage"])
    );

    const read = await authenticate(request("/v1/projects"));
    expect(read?.requestAuthorised).toBe(false);
  });

  it("rejects missing/malformed bearer credentials before token-store lookup", async () => {
    const tokenStore = store(["history:read"]);
    const authenticate = createCloudApiTokenWebAuthenticator(tokenStore);

    expect(await authenticate(new Request("https://cloud.example/v1/projects"))).toBeNull();
    expect(await authenticate(new Request("https://cloud.example/v1/projects", {
      headers: { authorization: "Basic abc" }
    }))).toBeNull();
    expect(await authenticate(new Request("https://cloud.example/v1/projects", {
      headers: { authorization: "Bearer not-a-ship-check-token" }
    }))).toBeNull();

    expect(tokenStore.authenticateToken).not.toHaveBeenCalled();
  });

  it("feeds under-scoped bearer auth into the Web transport as a bounded 403", async () => {
    const tokenStore = store(["history:sync"]);
    const listProjects = vi.fn();
    const historyService = {
      listProjects
    } as unknown as CloudHistoryService;
    const handler = createCloudHistoryWebHandler(historyService, {
      authenticate: createCloudApiTokenWebAuthenticator(tokenStore)
    });

    const response = await handler(request("/v1/projects"));
    const body = await response.json() as { code: string };

    expect(response.status).toBe(403);
    expect(body.code).toBe("operation-not-authorised");
    expect(listProjects).not.toHaveBeenCalled();
  });

  it("returns unauthenticated when a syntactically valid token is inactive", async () => {
    const tokenStore = store(["history:read"]);
    vi.mocked(tokenStore.authenticateToken).mockResolvedValueOnce(null);
    const authenticate = createCloudApiTokenWebAuthenticator(tokenStore);

    expect(await authenticate(request("/v1/projects"))).toBeNull();
    expect(tokenStore.authenticateToken).toHaveBeenCalledWith(rawToken);
  });
});
