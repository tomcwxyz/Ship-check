import {
  CloudApiTokenCreateRequestSchema,
  CloudApiTokenRecordSchema,
  CloudAuthenticatedPrincipalSchema,
  CloudHistoryHttpErrorSchema,
  type CloudAuthenticatedPrincipal,
  type CloudHistoryHttpError
} from "@ship-check/schemas";
import type { CloudApiTokenService } from "./cloudApiTokenService.js";
import { CloudHistoryServiceOperationError } from "./cloudHistoryService.js";

export type CloudApiTokenHttpAuthContext = {
  principal: CloudAuthenticatedPrincipal;
  requestAuthorised?: boolean;
  mutationAuthorised: boolean;
};

export type CloudApiTokenHttpRequest = {
  method: string;
  path: string;
  contentType?: string;
  body?: string;
  auth?: CloudApiTokenHttpAuthContext | null;
};

export type CloudApiTokenHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type CloudApiTokenHttpOptions = {
  maxBodyBytes?: number;
  onInternalError?: (error: unknown) => void;
};

export type CloudApiTokenHttpHandler = (
  request: CloudApiTokenHttpRequest
) => Promise<CloudApiTokenHttpResponse>;

export const CLOUD_API_TOKEN_DEFAULT_MAX_BODY_BYTES = 16 * 1024;

function baseHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
}

function jsonResponse(
  status: number,
  value: unknown,
  headers: Record<string, string> = {}
): CloudApiTokenHttpResponse {
  return {
    status,
    headers: { ...baseHeaders(), ...headers },
    body: JSON.stringify(value)
  };
}

function errorResponse(
  status: number,
  code: CloudHistoryHttpError["code"],
  message: string,
  headers: Record<string, string> = {}
): CloudApiTokenHttpResponse {
  return jsonResponse(
    status,
    CloudHistoryHttpErrorSchema.parse({
      schemaVersion: "0.1",
      type: "cloud-history-http-error",
      code,
      message
    }),
    headers
  );
}

function pathname(value: string): string {
  try {
    return new URL(value, "https://ship-check.invalid").pathname;
  } catch {
    return value.split("?")[0]?.split("#")[0] || "/";
  }
}

function routeParts(value: string): string[] {
  return pathname(value).split("/").filter(Boolean);
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

function parseJsonBody(request: CloudApiTokenHttpRequest, maxBodyBytes: number): unknown {
  const body = request.body ?? "";
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
    throw new TokenHttpBoundaryError(
      413,
      "payload-too-large",
      "Request body exceeds the Cloud API token limit."
    );
  }

  const contentType = request.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new TokenHttpBoundaryError(
      400,
      "invalid-request",
      "Request body must use application/json."
    );
  }
  if (!body.trim()) {
    throw new TokenHttpBoundaryError(400, "invalid-request", "Request body is required.");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new TokenHttpBoundaryError(
      400,
      "invalid-request",
      "Request body must contain valid JSON."
    );
  }
}

class TokenHttpBoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: CloudHistoryHttpError["code"],
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "TokenHttpBoundaryError";
  }
}

function serviceErrorResponse(
  error: CloudHistoryServiceOperationError
): CloudApiTokenHttpResponse {
  if (error.code === "account-not-found" || error.code === "api-token-not-found") {
    return errorResponse(404, "not-found", error.message);
  }
  return errorResponse(409, "conflict", error.message);
}

export function createCloudApiTokenHttpHandler(
  service: CloudApiTokenService,
  options: CloudApiTokenHttpOptions = {}
): CloudApiTokenHttpHandler {
  const maxBodyBytes = options.maxBodyBytes ?? CLOUD_API_TOKEN_DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
    throw new Error("Cloud API token HTTP maxBodyBytes must be an integer of at least 1024 bytes.");
  }

  return async (request) => {
    const method = request.method.trim().toUpperCase();
    const parts = routeParts(request.path);

    if (!request.auth) {
      return errorResponse(401, "unauthenticated", "Authentication is required.");
    }

    let principal: CloudAuthenticatedPrincipal;
    try {
      principal = CloudAuthenticatedPrincipalSchema.parse(request.auth.principal);
    } catch {
      return errorResponse(401, "unauthenticated", "Authentication is required.");
    }

    if (request.auth.requestAuthorised === false) {
      return errorResponse(
        403,
        "operation-not-authorised",
        "This authenticated request is not authorised for API token management."
      );
    }

    if (isMutation(method) && request.auth.mutationAuthorised !== true) {
      return errorResponse(
        403,
        "mutation-not-authorised",
        "This authenticated request is not authorised to manage API tokens."
      );
    }

    try {
      if (parts.join("/") === "v1/tokens") {
        if (method === "GET") {
          return jsonResponse(200, await service.listTokens(principal));
        }
        if (method === "POST") {
          const input = CloudApiTokenCreateRequestSchema.parse(
            parseJsonBody(request, maxBodyBytes)
          );
          return jsonResponse(201, await service.createToken(principal, input));
        }
        return errorResponse(
          405,
          "method-not-allowed",
          "Use GET or POST for API tokens.",
          { allow: "GET, POST" }
        );
      }

      if (
        parts.length === 3 &&
        parts[0] === "v1" &&
        parts[1] === "tokens"
      ) {
        if (method !== "DELETE") {
          return errorResponse(
            405,
            "method-not-allowed",
            "Use DELETE to revoke an API token.",
            { allow: "DELETE" }
          );
        }
        const tokenId = CloudApiTokenRecordSchema.shape.id.parse(parts[2]);
        return jsonResponse(200, await service.revokeToken(principal, tokenId));
      }

      return errorResponse(404, "not-found", "Cloud API token route was not found.");
    } catch (error) {
      if (error instanceof TokenHttpBoundaryError) {
        return errorResponse(error.status, error.code, error.message, error.headers);
      }
      if (error instanceof CloudHistoryServiceOperationError) {
        return serviceErrorResponse(error);
      }
      if (error instanceof Error && error.name === "ZodError") {
        return errorResponse(
          400,
          "invalid-request",
          "Request payload does not match the Cloud API token contract."
        );
      }

      options.onInternalError?.(error);
      return errorResponse(500, "internal-error", "Unexpected Cloud API token server error.");
    }
  };
}
