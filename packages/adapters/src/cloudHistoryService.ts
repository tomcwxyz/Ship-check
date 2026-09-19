import { randomUUID } from "node:crypto";
import {
  CloudAuthenticatedPrincipalSchema,
  CloudHistoryIngestRequestSchema,
  CloudHistoryServiceErrorSchema,
  CloudProjectConnectRequestSchema,
  CloudProjectConnectResultSchema,
  CloudRetentionUpdateRequestSchema,
  type CloudAccount,
  type CloudAccountDeletionReceipt,
  type CloudAuthenticatedPrincipal,
  type CloudHistoryIngestRequest,
  type CloudHistoryIngestResult,
  type CloudHistoryServiceError,
  type CloudHistoryServiceErrorCode,
  type CloudProject,
  type CloudProjectConnectRequest,
  type CloudProjectConnectResult,
  type CloudProjectDeletionReceipt,
  type CloudProjectHistoryExport,
  type CloudRetentionUpdateRequest
} from "@ship-check/schemas";
import type { CloudHistoryStore } from "./cloudHistoryStore.js";

export class CloudHistoryServiceOperationError extends Error {
  readonly code: CloudHistoryServiceErrorCode;

  constructor(code: CloudHistoryServiceErrorCode, message: string) {
    super(message);
    this.name = "CloudHistoryServiceOperationError";
    this.code = code;
  }

  toContract(): CloudHistoryServiceError {
    return CloudHistoryServiceErrorSchema.parse({
      schemaVersion: "0.1",
      code: this.code,
      message: this.message
    });
  }
}

export type CloudHistoryServiceOptions = {
  newId?: () => string;
  now?: () => Date;
};

export type CloudHistoryService = {
  resolveAccount(principal: CloudAuthenticatedPrincipal): Promise<CloudAccount>;
  connectProject(
    principal: CloudAuthenticatedPrincipal,
    request: CloudProjectConnectRequest
  ): Promise<CloudProjectConnectResult>;
  getProject(
    principal: CloudAuthenticatedPrincipal,
    projectId: string
  ): Promise<CloudProject>;
  sync(
    principal: CloudAuthenticatedPrincipal,
    request: CloudHistoryIngestRequest
  ): Promise<CloudHistoryIngestResult>;
  exportProject(
    principal: CloudAuthenticatedPrincipal,
    projectId: string
  ): Promise<CloudProjectHistoryExport>;
  updateRetention(
    principal: CloudAuthenticatedPrincipal,
    request: CloudRetentionUpdateRequest
  ): Promise<CloudProject>;
  deleteProject(
    principal: CloudAuthenticatedPrincipal,
    projectId: string
  ): Promise<CloudProjectDeletionReceipt>;
  deleteAccount(
    principal: CloudAuthenticatedPrincipal
  ): Promise<CloudAccountDeletionReceipt>;
};

function operationError(
  code: CloudHistoryServiceErrorCode,
  message: string
): CloudHistoryServiceOperationError {
  return new CloudHistoryServiceOperationError(code, message);
}

function mapStoreError(error: unknown): never {
  if (error instanceof CloudHistoryServiceOperationError) throw error;
  const message = error instanceof Error ? error.message : String(error);

  if (/project was not found for this account/i.test(message)) {
    throw operationError("project-not-found", "Project was not found for this account.");
  }
  if (/account was not found/i.test(message)) {
    throw operationError("account-not-found", "Account was not found.");
  }
  if (/different project identity basis|does not match the hosted project/i.test(message)) {
    throw operationError(
      "project-identity-conflict",
      "Project identity does not match the connected hosted project."
    );
  }
  if (/conflicting assurance metadata|conflicting comparison metadata/i.test(message)) {
    throw operationError(
      "history-conflict",
      "This scan identity is already associated with different assurance metadata."
    );
  }
  if (/no assurance metadata history to export/i.test(message)) {
    throw operationError("history-empty", "Project has no assurance metadata history to export.");
  }

  throw error;
}

export function createCloudHistoryService(
  store: CloudHistoryStore,
  options: CloudHistoryServiceOptions = {}
): CloudHistoryService {
  const newId = options.newId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  const resolveAccount = async (
    value: CloudAuthenticatedPrincipal
  ): Promise<CloudAccount> => {
    const principal = CloudAuthenticatedPrincipalSchema.parse(value);
    const existing = await store.findAccountByAuthSubjectHash(principal.authSubjectHash);
    if (existing) return existing;

    return store.registerAccount({
      id: newId(),
      authSubjectHash: principal.authSubjectHash,
      createdAt: now()
    });
  };

  const requireExistingAccount = async (
    value: CloudAuthenticatedPrincipal
  ): Promise<CloudAccount> => {
    const principal = CloudAuthenticatedPrincipalSchema.parse(value);
    const account = await store.findAccountByAuthSubjectHash(principal.authSubjectHash);
    if (!account) {
      throw operationError("account-not-found", "Account was not found.");
    }
    return account;
  };

  const requireProject = async (
    principal: CloudAuthenticatedPrincipal,
    projectId: string
  ): Promise<{ account: CloudAccount; project: CloudProject }> => {
    const account = await requireExistingAccount(principal);
    const project = await store.getProject(account.id, projectId);
    if (!project) {
      throw operationError("project-not-found", "Project was not found for this account.");
    }
    return { account, project };
  };

  return {
    resolveAccount,

    async connectProject(principalValue, requestValue) {
      const principal = CloudAuthenticatedPrincipalSchema.parse(principalValue);
      const request = CloudProjectConnectRequestSchema.parse(requestValue);
      const account = await resolveAccount(principal);

      try {
        let project = await store.findProjectByIdentity(
          account.id,
          request.event.project.identity.value
        );

        if (project) {
          if (project.identityBasis !== request.event.project.identityBasis) {
            throw operationError(
              "project-identity-conflict",
              "Connected project uses a different project identity basis."
            );
          }
          if (project.retention !== request.retention) {
            throw operationError(
              "project-retention-conflict",
              "Connected project already has a different retention policy; update retention explicitly."
            );
          }
          if (
            request.displayName !== undefined &&
            request.displayName !== project.displayName
          ) {
            throw operationError(
              "project-name-conflict",
              "Connected project already has a different display name; rename it explicitly."
            );
          }
        } else {
          project = await store.createProject({
            id: newId(),
            accountId: account.id,
            projectIdentity: request.event.project.identity,
            identityBasis: request.event.project.identityBasis,
            ...(request.displayName !== undefined ? { displayName: request.displayName } : {}),
            retention: request.retention,
            createdAt: now()
          });
        }

        const ingest = await store.ingest(
          account.id,
          project.id,
          request.event,
          now()
        );

        return CloudProjectConnectResultSchema.parse({
          schemaVersion: "0.1",
          account,
          project,
          ingest
        });
      } catch (error) {
        mapStoreError(error);
      }
    },

    async getProject(principal, projectId) {
      return (await requireProject(principal, projectId)).project;
    },

    async sync(principalValue, requestValue) {
      const principal = CloudAuthenticatedPrincipalSchema.parse(principalValue);
      const request = CloudHistoryIngestRequestSchema.parse(requestValue);
      const { account } = await requireProject(principal, request.projectId);

      try {
        return await store.ingest(
          account.id,
          request.projectId,
          request.event,
          now()
        );
      } catch (error) {
        mapStoreError(error);
      }
    },

    async exportProject(principal, projectId) {
      const { account } = await requireProject(principal, projectId);
      try {
        return await store.exportProject(account.id, projectId, now());
      } catch (error) {
        mapStoreError(error);
      }
    },

    async updateRetention(principalValue, requestValue) {
      const principal = CloudAuthenticatedPrincipalSchema.parse(principalValue);
      const request = CloudRetentionUpdateRequestSchema.parse(requestValue);
      const { account } = await requireProject(principal, request.projectId);

      try {
        return await store.updateRetention(
          account.id,
          request.projectId,
          request.retention,
          now()
        );
      } catch (error) {
        mapStoreError(error);
      }
    },

    async deleteProject(principal, projectId) {
      const { account } = await requireProject(principal, projectId);
      try {
        return await store.deleteProject(account.id, projectId, now());
      } catch (error) {
        mapStoreError(error);
      }
    },

    async deleteAccount(principalValue) {
      const principal = CloudAuthenticatedPrincipalSchema.parse(principalValue);
      const account = await requireExistingAccount(principal);

      try {
        return await store.deleteAccount(account.id, now());
      } catch (error) {
        mapStoreError(error);
      }
    }
  };
}
