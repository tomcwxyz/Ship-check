import { createHash, randomBytes } from "node:crypto";
import {
  CloudApiTokenAuthenticationSchema,
  CloudApiTokenRecordSchema,
  CloudApiTokenScopesSchema,
  CloudApiTokenValueSchema,
  type CloudApiTokenAuthentication,
  type CloudApiTokenRecord,
  type CloudApiTokenScope,
  type CloudApiTokenValue
} from "@ship-check/schemas";
import type { CloudHistoryDatabase } from "./cloudHistoryStore.js";

type TokenRow = {
  id: string;
  account_id: string;
  token_prefix: string;
  label: string | null;
  scopes: string[];
  created_at: string | Date;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  last_used_at: string | Date | null;
};

type AuthenticatedTokenRow = TokenRow & {
  auth_subject_hash: string;
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function tokenRecordFromRow(row: TokenRow): CloudApiTokenRecord {
  return CloudApiTokenRecordSchema.parse({
    schemaVersion: "0.1",
    id: row.id,
    accountId: row.account_id,
    tokenPrefix: row.token_prefix,
    ...(row.label ? { label: row.label } : {}),
    scopes: row.scopes,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null
  });
}

export function hashCloudApiToken(value: CloudApiTokenValue | string): string {
  const token = CloudApiTokenValueSchema.parse(value);
  return createHash("sha256")
    .update(`ship-check-api-token-v1\0${token}`)
    .digest("hex");
}

export function generateCloudApiToken(): {
  token: CloudApiTokenValue;
  tokenHash: string;
  tokenPrefix: string;
} {
  const secret = randomBytes(32).toString("base64url");
  const token = CloudApiTokenValueSchema.parse(`shipcheck_${secret}`);
  return {
    token,
    tokenHash: hashCloudApiToken(token),
    tokenPrefix: `shipcheck_${secret.slice(0, 8)}`
  };
}

export type CreateCloudApiTokenRecordInput = {
  id: string;
  accountId: string;
  tokenHash: string;
  tokenPrefix: string;
  label?: string;
  scopes: CloudApiTokenScope[];
  createdAt: string | Date;
  expiresAt: string | Date;
};

export type CloudApiTokenStore = {
  createToken(input: CreateCloudApiTokenRecordInput): Promise<CloudApiTokenRecord>;
  listTokens(accountId: string): Promise<CloudApiTokenRecord[]>;
  revokeToken(
    accountId: string,
    tokenId: string,
    revokedAt?: string | Date
  ): Promise<CloudApiTokenRecord | null>;
  authenticateToken(
    token: CloudApiTokenValue | string,
    usedAt?: string | Date
  ): Promise<CloudApiTokenAuthentication | null>;
};

export function createCloudApiTokenStore(
  database: CloudHistoryDatabase
): CloudApiTokenStore {
  return {
    async createToken(input) {
      const scopes = CloudApiTokenScopesSchema.parse(input.scopes);
      const createdAt = iso(input.createdAt);
      const expiresAt = iso(input.expiresAt);
      const parsed = CloudApiTokenRecordSchema.parse({
        schemaVersion: "0.1",
        id: input.id,
        accountId: input.accountId,
        tokenPrefix: input.tokenPrefix,
        ...(input.label !== undefined ? { label: input.label } : {}),
        scopes,
        createdAt,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null
      });
      if (new Date(expiresAt).getTime() <= new Date(createdAt).getTime()) {
        throw new Error("Cloud API token expiry must be after creation.");
      }
      if (!/^[a-f0-9]{64}$/.test(input.tokenHash)) {
        throw new Error("Cloud API token hash must be a lowercase SHA-256 digest.");
      }

      const result = await database.query<TokenRow>(
        `INSERT INTO ship_check_api_tokens (
           id, account_id, token_hash, token_prefix, label, scopes,
           created_at, expires_at, revoked_at, last_used_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, NULL, NULL)
         RETURNING id, account_id, token_prefix, label, scopes,
                   created_at, expires_at, revoked_at, last_used_at`,
        [
          parsed.id,
          parsed.accountId,
          input.tokenHash,
          parsed.tokenPrefix,
          parsed.label ?? null,
          parsed.scopes,
          parsed.createdAt,
          parsed.expiresAt
        ]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Cloud API token creation did not return a token record.");
      return tokenRecordFromRow(row);
    },

    async listTokens(accountId) {
      const result = await database.query<TokenRow>(
        `SELECT id, account_id, token_prefix, label, scopes,
                created_at, expires_at, revoked_at, last_used_at
         FROM ship_check_api_tokens
         WHERE account_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [accountId]
      );
      return result.rows.map(tokenRecordFromRow);
    },

    async revokeToken(accountId, tokenId, revokedAt = new Date()) {
      const result = await database.query<TokenRow>(
        `UPDATE ship_check_api_tokens
         SET revoked_at = COALESCE(revoked_at, $3)
         WHERE id = $1 AND account_id = $2
         RETURNING id, account_id, token_prefix, label, scopes,
                   created_at, expires_at, revoked_at, last_used_at`,
        [tokenId, accountId, iso(revokedAt)]
      );
      return result.rows[0] ? tokenRecordFromRow(result.rows[0]) : null;
    },

    async authenticateToken(value, usedAt = new Date()) {
      let tokenHash: string;
      try {
        tokenHash = hashCloudApiToken(value);
      } catch {
        return null;
      }
      const when = iso(usedAt);
      const result = await database.query<AuthenticatedTokenRow>(
        `UPDATE ship_check_api_tokens t
         SET last_used_at = $2
         FROM ship_check_accounts a
         WHERE t.token_hash = $1
           AND t.account_id = a.id
           AND t.revoked_at IS NULL
           AND t.expires_at > $2
         RETURNING t.id, t.account_id, t.token_prefix, t.label, t.scopes,
                   t.created_at, t.expires_at, t.revoked_at, t.last_used_at,
                   a.auth_subject_hash`,
        [tokenHash, when]
      );
      const row = result.rows[0];
      if (!row) return null;
      return CloudApiTokenAuthenticationSchema.parse({
        schemaVersion: "0.1",
        tokenId: row.id,
        accountId: row.account_id,
        authSubjectHash: row.auth_subject_hash,
        scopes: row.scopes
      });
    }
  };
}
