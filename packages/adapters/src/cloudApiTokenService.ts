import { randomUUID } from "node:crypto";
import {
  CloudApiTokenCreateRequestSchema,
  CloudApiTokenCreateResultSchema,
  CloudApiTokenListResultSchema,
  CloudApiTokenRecordSchema,
  CloudAuthenticatedPrincipalSchema,
  type CloudApiTokenCreateRequest,
  type CloudApiTokenCreateResult,
  type CloudApiTokenListResult,
  type CloudApiTokenRecord,
  type CloudAuthenticatedPrincipal
} from "@ship-check/schemas";
import type { CloudHistoryStore } from "./cloudHistoryStore.js";
import {
  generateCloudApiToken,
  type CloudApiTokenStore
} from "./cloudApiTokenStore.js";
import { CloudHistoryServiceOperationError } from "./cloudHistoryService.js";

export type CloudApiTokenServiceOptions = {
  newId?: () => string;
  now?: () => Date;
};

export type CloudApiTokenService = {
  createToken(
    principal: CloudAuthenticatedPrincipal,
    request: CloudApiTokenCreateRequest
  ): Promise<CloudApiTokenCreateResult>;
  listTokens(
    principal: CloudAuthenticatedPrincipal
  ): Promise<CloudApiTokenListResult>;
  revokeToken(
    principal: CloudAuthenticatedPrincipal,
    tokenId: string
  ): Promise<CloudApiTokenRecord>;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function createCloudApiTokenService(
  historyStore: CloudHistoryStore,
  tokenStore: CloudApiTokenStore,
  options: CloudApiTokenServiceOptions = {}
): CloudApiTokenService {
  const newId = options.newId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  const findAccount = async (
    value: CloudAuthenticatedPrincipal
  ) => {
    const principal = CloudAuthenticatedPrincipalSchema.parse(value);
    return historyStore.findAccountByAuthSubjectHash(principal.authSubjectHash);
  };

  const requireAccount = async (
    value: CloudAuthenticatedPrincipal
  ) => {
    const account = await findAccount(value);
    if (!account) {
      throw new CloudHistoryServiceOperationError(
        "account-not-found",
        "Account was not found."
      );
    }
    return account;
  };

  return {
    async createToken(principalValue, requestValue) {
      const principal = CloudAuthenticatedPrincipalSchema.parse(principalValue);
      const request = CloudApiTokenCreateRequestSchema.parse(requestValue);
      const createdAt = now();

      let account = await findAccount(principal);
      if (!account) {
        account = await historyStore.registerAccount({
          id: newId(),
          authSubjectHash: principal.authSubjectHash,
          createdAt
        });
      }

      const generated = generateCloudApiToken();
      const expiresAt = addDays(createdAt, request.expiresInDays);
      const record = await tokenStore.createToken({
        id: newId(),
        accountId: account.id,
        tokenHash: generated.tokenHash,
        tokenPrefix: generated.tokenPrefix,
        ...(request.label !== undefined ? { label: request.label } : {}),
        scopes: request.scopes,
        createdAt,
        expiresAt
      });

      return CloudApiTokenCreateResultSchema.parse({
        schemaVersion: "0.1",
        token: generated.token,
        record
      });
    },

    async listTokens(principalValue) {
      const account = await requireAccount(principalValue);
      const tokens = (await tokenStore.listTokens(account.id)).slice(0, 100);
      return CloudApiTokenListResultSchema.parse({
        schemaVersion: "0.1",
        tokens
      });
    },

    async revokeToken(principalValue, tokenIdValue) {
      const account = await requireAccount(principalValue);
      const tokenId = CloudApiTokenRecordSchema.shape.id.parse(tokenIdValue);
      const record = await tokenStore.revokeToken(account.id, tokenId, now());
      if (!record) {
        throw new CloudHistoryServiceOperationError(
          "api-token-not-found",
          "API token was not found for this account."
        );
      }
      return record;
    }
  };
}
