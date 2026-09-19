import { describe, expect, it, vi } from "vitest";
import type {
  CloudAccount,
  CloudApiTokenRecord
} from "@ship-check/schemas";
import type { CloudHistoryStore } from "./cloudHistoryStore.js";
import type { CloudApiTokenStore } from "./cloudApiTokenStore.js";
import { createCloudApiTokenService } from "./cloudApiTokenService.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const tokenId = "22222222-2222-4222-8222-222222222222";
const authSubjectHash = "d".repeat(64);
const rawToken = `shipcheck_${"A".repeat(43)}`;
const tokenPrefix = `shipcheck_${"A".repeat(8)}`;
const tokenHash = "e".repeat(64);

const principal = {
  schemaVersion: "0.1" as const,
  authSubjectHash
};

const account: CloudAccount = {
  schemaVersion: "0.1",
  id: accountId,
  authSubjectHash,
  createdAt: "2026-09-19T12:00:00.000Z"
};

const record: CloudApiTokenRecord = {
  schemaVersion: "0.1",
  id: tokenId,
  accountId,
  tokenPrefix,
  label: "CI sync",
  scopes: ["history:read", "history:sync"],
  createdAt: "2026-09-19T12:00:00.000Z",
  expiresAt: "2026-12-18T12:00:00.000Z",
  revokedAt: null,
  lastUsedAt: null
};

function historyStore(
  overrides: Partial<CloudHistoryStore> = {}
): CloudHistoryStore {
  const base = {
    findAccountByAuthSubjectHash: vi.fn(async () => account),
    registerAccount: vi.fn(async () => account)
  } as unknown as CloudHistoryStore;
  return Object.assign(base, overrides);
}

function tokenStore(
  overrides: Partial<CloudApiTokenStore> = {}
): CloudApiTokenStore {
  const base: CloudApiTokenStore = {
    createToken: vi.fn(async () => record),
    listTokens: vi.fn(async () => [record]),
    revokeToken: vi.fn(async () => ({
      ...record,
      revokedAt: "2026-09-20T12:00:00.000Z"
    })),
    authenticateToken: vi.fn(async () => null)
  };
  return { ...base, ...overrides };
}

const fixedNow = () => new Date("2026-09-19T12:00:00.000Z");
const fixedToken = () => ({
  token: rawToken,
  tokenHash,
  tokenPrefix
});

describe("cloud API token service", () => {
  it("creates an expiring scoped token and returns the raw value once", async () => {
    const history = historyStore();
    const tokens = tokenStore();
    const service = createCloudApiTokenService(history, tokens, {
      now: fixedNow,
      newId: () => tokenId,
      generateToken: fixedToken
    });

    const result = await service.createToken(principal, {
      schemaVersion: "0.1",
      label: "CI sync",
      scopes: ["history:read", "history:sync"],
      expiresInDays: 90
    });

    expect(result.token).toBe(rawToken);
    expect(result.record).toEqual(record);
    expect(tokens.createToken).toHaveBeenCalledWith({
      id: tokenId,
      accountId,
      tokenHash,
      tokenPrefix,
      label: "CI sync",
      scopes: ["history:read", "history:sync"],
      createdAt: new Date("2026-09-19T12:00:00.000Z"),
      expiresAt: new Date("2026-12-18T12:00:00.000Z")
    });
    expect(JSON.stringify(result.record)).not.toContain(rawToken);
    expect(JSON.stringify(result.record)).not.toContain(tokenHash);
  });

  it("uses the default 90-day expiry when creation omits expiresInDays", async () => {
    const tokens = tokenStore();
    const service = createCloudApiTokenService(historyStore(), tokens, {
      now: fixedNow,
      newId: () => tokenId,
      generateToken: fixedToken
    });

    await service.createToken(principal, {
      schemaVersion: "0.1",
      scopes: ["history:sync"]
    });

    expect(tokens.createToken).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: new Date("2026-12-18T12:00:00.000Z")
    }));
  });

  it("can bootstrap the opaque account only during explicit token creation", async () => {
    const findAccountByAuthSubjectHash = vi.fn(async () => null);
    const registerAccount = vi.fn(async (input) => ({
      ...account,
      id: input.id,
      createdAt: new Date(input.createdAt ?? fixedNow()).toISOString()
    }));
    const history = historyStore({
      findAccountByAuthSubjectHash,
      registerAccount
    });
    const tokens = tokenStore();
    const ids = [accountId, tokenId];
    const service = createCloudApiTokenService(history, tokens, {
      now: fixedNow,
      newId: () => ids.shift()!,
      generateToken: fixedToken
    });

    await service.createToken(principal, {
      schemaVersion: "0.1",
      scopes: ["history:read"],
      expiresInDays: 30
    });

    expect(registerAccount).toHaveBeenCalledWith({
      id: accountId,
      authSubjectHash,
      createdAt: new Date("2026-09-19T12:00:00.000Z")
    });
    expect(tokens.createToken).toHaveBeenCalledWith(expect.objectContaining({
      id: tokenId,
      accountId
    }));
  });

  it("lists bounded token records without exposing raw credentials", async () => {
    const tokens = tokenStore();
    const service = createCloudApiTokenService(historyStore(), tokens, {
      now: fixedNow
    });

    const result = await service.listTokens(principal);

    expect(result.tokens).toEqual([record]);
    expect(tokens.listTokens).toHaveBeenCalledWith(accountId);
    expect(JSON.stringify(result)).not.toContain(rawToken);
    expect(JSON.stringify(result)).not.toContain(tokenHash);
  });

  it("does not create a ghost account when listing or revoking credentials", async () => {
    const registerAccount = vi.fn(async () => account);
    const history = historyStore({
      findAccountByAuthSubjectHash: vi.fn(async () => null),
      registerAccount
    });
    const service = createCloudApiTokenService(history, tokenStore(), {
      now: fixedNow
    });

    await expect(service.listTokens(principal)).rejects.toMatchObject({
      code: "account-not-found"
    });
    await expect(service.revokeToken(principal, tokenId)).rejects.toMatchObject({
      code: "account-not-found"
    });
    expect(registerAccount).not.toHaveBeenCalled();
  });

  it("revokes only an account-owned token and exposes an explicit not-found state", async () => {
    const tokens = tokenStore();
    const service = createCloudApiTokenService(historyStore(), tokens, {
      now: fixedNow
    });

    const revoked = await service.revokeToken(principal, tokenId);
    expect(revoked.revokedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(tokens.revokeToken).toHaveBeenCalledWith(
      accountId,
      tokenId,
      new Date("2026-09-19T12:00:00.000Z")
    );

    const missingService = createCloudApiTokenService(
      historyStore(),
      tokenStore({ revokeToken: vi.fn(async () => null) }),
      { now: fixedNow }
    );
    await expect(missingService.revokeToken(principal, tokenId)).rejects.toMatchObject({
      code: "api-token-not-found"
    });
  });
});
