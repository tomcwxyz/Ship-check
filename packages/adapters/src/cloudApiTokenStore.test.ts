import { describe, expect, it } from "vitest";
import type {
  CloudHistoryDatabase,
  CloudHistoryQueryResult,
  CloudHistorySqlExecutor
} from "./cloudHistoryStore.js";
import {
  createCloudApiTokenStore,
  generateCloudApiToken,
  hashCloudApiToken
} from "./cloudApiTokenStore.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const tokenId = "22222222-2222-4222-8222-222222222222";
const rawToken = `shipcheck_${"A".repeat(43)}`;
const tokenPrefix = `shipcheck_${"A".repeat(8)}`;
const authSubjectHash = "d".repeat(64);

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

function tokenRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: tokenId,
    account_id: accountId,
    token_prefix: tokenPrefix,
    label: "CI sync",
    scopes: ["history:read", "history:sync"],
    created_at: "2026-09-19T12:00:00.000Z",
    expires_at: "2026-12-18T12:00:00.000Z",
    revoked_at: null,
    last_used_at: null,
    ...overrides
  };
}

describe("cloud API token crypto helpers", () => {
  it("generates a strong one-time token, display prefix and SHA-256 digest", () => {
    const generated = generateCloudApiToken();

    expect(generated.token).toMatch(/^shipcheck_[A-Za-z0-9_-]{43}$/);
    expect(generated.tokenPrefix).toBe(generated.token.slice(0, 18));
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).toBe(hashCloudApiToken(generated.token));
    expect(generated.tokenHash).not.toContain(generated.token);
  });

  it("domain-separated token hashing is deterministic and token-specific", () => {
    expect(hashCloudApiToken(rawToken)).toBe(hashCloudApiToken(rawToken));
    expect(hashCloudApiToken(rawToken)).not.toBe(
      hashCloudApiToken(`shipcheck_${"B".repeat(43)}`)
    );
  });
});

describe("cloud API token store", () => {
  it("creates a token record without ever sending the raw credential to SQL", async () => {
    const db = new FakeDatabase([{ rows: [tokenRow()] }]);
    const store = createCloudApiTokenStore(db);
    const tokenHash = hashCloudApiToken(rawToken);

    const record = await store.createToken({
      id: tokenId,
      accountId,
      tokenHash,
      tokenPrefix,
      label: "CI sync",
      scopes: ["history:read", "history:sync"],
      createdAt: "2026-09-19T12:00:00.000Z",
      expiresAt: "2026-12-18T12:00:00.000Z"
    });

    expect(record.tokenPrefix).toBe(tokenPrefix);
    expect(record.scopes).toEqual(["history:read", "history:sync"]);
    expect(JSON.stringify(record)).not.toContain(tokenHash);
    expect(db.calls[0]?.values).toContain(tokenHash);
    expect(JSON.stringify(db.calls[0]?.values)).not.toContain(rawToken);
  });

  it("rejects non-forward expiry before touching the database", async () => {
    const db = new FakeDatabase([]);
    const store = createCloudApiTokenStore(db);

    await expect(store.createToken({
      id: tokenId,
      accountId,
      tokenHash: hashCloudApiToken(rawToken),
      tokenPrefix,
      scopes: ["history:read"],
      createdAt: "2026-09-19T12:00:00.000Z",
      expiresAt: "2026-09-19T12:00:00.000Z"
    })).rejects.toThrow(/expiry must be after creation/i);

    expect(db.calls).toHaveLength(0);
  });

  it("lists at most the bounded account-scoped token records", async () => {
    const db = new FakeDatabase([{ rows: [tokenRow()] }]);
    const store = createCloudApiTokenStore(db);

    const records = await store.listTokens(accountId);

    expect(records).toHaveLength(1);
    expect(db.calls[0]?.values).toEqual([accountId]);
    expect(db.calls[0]?.text).toMatch(/WHERE account_id = \$1/i);
    expect(db.calls[0]?.text).toMatch(/LIMIT 100/i);
  });

  it("revokes only a token owned by the supplied account", async () => {
    const db = new FakeDatabase([{
      rows: [tokenRow({ revoked_at: "2026-09-20T12:00:00.000Z" })]
    }]);
    const store = createCloudApiTokenStore(db);

    const record = await store.revokeToken(
      accountId,
      tokenId,
      "2026-09-20T12:00:00.000Z"
    );

    expect(record?.revokedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(db.calls[0]?.values).toEqual([
      tokenId,
      accountId,
      "2026-09-20T12:00:00.000Z"
    ]);
    expect(db.calls[0]?.text).toMatch(/WHERE id = \$1 AND account_id = \$2/i);
  });

  it("authenticates by hash, rejects revoked/expired rows and returns the account subject hash", async () => {
    const tokenHash = hashCloudApiToken(rawToken);
    const db = new FakeDatabase([{
      rows: [tokenRow({
        auth_subject_hash: authSubjectHash,
        last_used_at: "2026-09-20T12:00:00.000Z"
      })]
    }]);
    const store = createCloudApiTokenStore(db);

    const authenticated = await store.authenticateToken(
      rawToken,
      "2026-09-20T12:00:00.000Z"
    );

    expect(authenticated).toEqual({
      schemaVersion: "0.1",
      tokenId,
      accountId,
      authSubjectHash,
      scopes: ["history:read", "history:sync"]
    });
    expect(db.calls[0]?.values).toEqual([
      tokenHash,
      "2026-09-20T12:00:00.000Z"
    ]);
    expect(JSON.stringify(db.calls[0]?.values)).not.toContain(rawToken);
    expect(db.calls[0]?.text).toMatch(/revoked_at IS NULL/i);
    expect(db.calls[0]?.text).toMatch(/expires_at > \$2/i);
  });

  it("treats malformed credentials and inactive-token misses as authentication failure", async () => {
    const malformedDb = new FakeDatabase([]);
    const malformedStore = createCloudApiTokenStore(malformedDb);

    expect(await malformedStore.authenticateToken("not-a-ship-check-token")).toBeNull();
    expect(malformedDb.calls).toHaveLength(0);

    const inactiveDb = new FakeDatabase([{ rows: [] }]);
    const inactiveStore = createCloudApiTokenStore(inactiveDb);
    expect(await inactiveStore.authenticateToken(
      rawToken,
      "2027-01-01T00:00:00.000Z"
    )).toBeNull();
  });
});
