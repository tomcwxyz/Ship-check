import { describe, expect, it, vi } from "vitest";
import type { CloudAuthenticatedPrincipal } from "@ship-check/schemas";
import type { CloudApiTokenService } from "./cloudApiTokenService.js";
import type { CloudApiTokenStore } from "./cloudApiTokenStore.js";
import type { CloudHistoryService } from "./cloudHistoryService.js";
import { createCloudR0WebHandler } from "./cloudR0Web.js";

const principal: CloudAuthenticatedPrincipal = {
  schemaVersion: "0.1",
  authSubjectHash: "a".repeat(64)
};
const projectId = "22222222-2222-4222-8222-222222222222";
const rawToken = `shipcheck_${"A".repeat(43)}`;

function historyService() {
  return {
    listProjects: vi.fn(async () => ({
      schemaVersion: "0.1",
      projects: []
    })),
    deleteProject: vi.fn(async () => ({
      schemaVersion: "0.1",
      projectId,
      deletedAt: "2026-09-19T20:00:00.000Z",
      deletedEventCount: 0
    }))
  } as unknown as CloudHistoryService;
}

function tokenService() {
  return {
    listTokens: vi.fn(async () => ({
      schemaVersion: "0.1",
      tokens: []
    })),
    createToken: vi.fn(),
    revokeToken: vi.fn()
  } as unknown as CloudApiTokenService;
}

function tokenStore(scopes: Array<"history:read" | "history:sync" | "project:manage">) {
  return {
    authenticateToken: vi.fn(async () => ({
      schemaVersion: "0.1" as const,
      tokenId: "33333333-3333-4333-8333-333333333333",
      accountId: "11111111-1111-4111-8111-111111111111",
      authSubjectHash: principal.authSubjectHash,
      scopes
    })),
    createToken: vi.fn(),
    listTokens: vi.fn(),
    revokeToken: vi.fn()
  } as unknown as CloudApiTokenStore;
}

describe("Cloud R0 Web composition", () => {
  it("prefers bearer auth for history routes when Authorization is present", async () => {
    const history = historyService();
    const tokens = tokenStore(["history:read"]);
    const authenticateSession = vi.fn(async () => ({
      principal,
      mutationAuthorised: true
    }));
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokens,
      { authenticateSession }
    );

    const response = await handler(new Request("https://cloud.example/v1/projects", {
      headers: { authorization: `Bearer ${rawToken}` }
    }));

    expect(response.status).toBe(200);
    expect(tokens.authenticateToken).toHaveBeenCalledWith(rawToken);
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(history.listProjects).toHaveBeenCalledOnce();
  });

  it("does not fall back to a browser session for malformed bearer credentials", async () => {
    const history = historyService();
    const tokens = tokenStore(["history:read"]);
    const authenticateSession = vi.fn(async () => ({
      principal,
      mutationAuthorised: true
    }));
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokens,
      { authenticateSession }
    );

    const response = await handler(new Request("https://cloud.example/v1/projects", {
      headers: { authorization: "Bearer invalid" }
    }));

    expect(response.status).toBe(401);
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(tokens.authenticateToken).not.toHaveBeenCalled();
    expect(history.listProjects).not.toHaveBeenCalled();
  });

  it("keeps API token management behind session authentication", async () => {
    const tokens = tokenStore(["project:manage", "history:read", "history:sync"]);
    const service = tokenService();
    const authenticateSession = vi.fn(async () => null);
    const handler = createCloudR0WebHandler(
      historyService(),
      service,
      tokens,
      { authenticateSession }
    );

    const response = await handler(new Request("https://cloud.example/v1/tokens", {
      headers: { authorization: `Bearer ${rawToken}` }
    }));

    expect(response.status).toBe(401);
    expect(authenticateSession).toHaveBeenCalledOnce();
    expect(tokens.authenticateToken).not.toHaveBeenCalled();
    expect(service.listTokens).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser-session mutations before auth or body handling", async () => {
    const history = historyService();
    const authenticateSession = vi.fn(async () => ({
      principal,
      mutationAuthorised: true
    }));
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokenStore(["project:manage"]),
      { authenticateSession }
    );

    const response = await handler(new Request(
      `https://cloud.example/v1/projects/${projectId}`,
      {
        method: "DELETE",
        headers: { origin: "https://evil.example" }
      }
    ));

    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code)
      .toBe("origin-not-authorised");
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(history.deleteProject).not.toHaveBeenCalled();
  });

  it("allows same-origin browser-session mutations", async () => {
    const history = historyService();
    const authenticateSession = vi.fn(async () => ({
      principal,
      mutationAuthorised: true
    }));
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokenStore(["project:manage"]),
      { authenticateSession }
    );

    const response = await handler(new Request(
      `https://cloud.example/v1/projects/${projectId}`,
      {
        method: "DELETE",
        headers: { origin: "https://cloud.example" }
      }
    ));

    expect(response.status).toBe(200);
    expect(authenticateSession).toHaveBeenCalledOnce();
    expect(history.deleteProject).toHaveBeenCalledOnce();
  });

  it("does not apply browser Origin checks to scoped bearer mutations", async () => {
    const history = historyService();
    const authenticateSession = vi.fn();
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokenStore(["project:manage"]),
      { authenticateSession }
    );

    const response = await handler(new Request(
      `https://cloud.example/v1/projects/${projectId}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${rawToken}`,
          origin: "https://automation.example"
        }
      }
    ));

    expect(response.status).toBe(200);
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(history.deleteProject).toHaveBeenCalledOnce();
  });

  it("allows an explicitly configured browser Origin", async () => {
    const history = historyService();
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokenStore(["project:manage"]),
      {
        authenticateSession: async () => ({
          principal,
          mutationAuthorised: true
        }),
        allowedOrigins: ["https://app.example"]
      }
    );

    const response = await handler(new Request(
      `https://api.example/v1/projects/${projectId}`,
      {
        method: "DELETE",
        headers: { origin: "https://app.example" }
      }
    ));

    expect(response.status).toBe(200);
  });

  it("applies the rate-limit guard before authentication or service work", async () => {
    const history = historyService();
    const authenticateSession = vi.fn(async () => ({
      principal,
      mutationAuthorised: false
    }));
    const rateLimit = vi.fn(async () => ({
      allowed: false,
      retryAfterSeconds: 60
    }));
    const handler = createCloudR0WebHandler(
      history,
      tokenService(),
      tokenStore(["history:read"]),
      { authenticateSession, rateLimit }
    );

    const response = await handler(
      new Request("https://cloud.example/v1/projects")
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((await response.json() as { code: string }).code)
      .toBe("rate-limited");
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(history.listProjects).not.toHaveBeenCalled();
  });
});
