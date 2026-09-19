import {
  CloudAuthenticatedPrincipalSchema,
  CloudHistoryHttpErrorSchema,
  CloudHistoryIngestRequestSchema,
  CloudProjectConnectRequestSchema,
  CloudProjectListRequestSchema,
  CloudProjectNameUpdateRequestSchema,
  CloudRetentionUpdateRequestSchema,
  type CloudAuthenticatedPrincipal,
  type CloudHistoryHttpError
} from "@ship-check/schemas";
import {
  CloudHistoryServiceOperationError,
  type CloudHistoryService
} from "./cloudHistoryService.js";

export type CloudHistoryHttpAuthContext = {
  principal: CloudAuthenticatedPrincipal;
  mutationAuthorised: boolean;
};

export type CloudHistoryHttpRequest = {
  method: string;
  path: string;
  contentType?: string;
  body?: string;
  auth?: CloudHistoryHttpAuthContext | null;
};

export type CloudHistoryHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type CloudHistoryHttpOptions = {
  maxBodyBytes?: number;
  onInternalError?: (error: unknown) => void;
};

export type CloudHistoryHttpHandler = (
  request: CloudHistoryHttpRequest
) => Promise<CloudHistoryHttpResponse>;

export const CLOUD_HISTORY_DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function baseHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
}

function jsonResponse(status: number, value: unknown, headers: Record<string, string> = {}): CloudHistoryHttpResponse {
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
): CloudHistoryHttpResponse {
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

function query(value: string): URLSearchParams {
  try {
    return new URL(value, "https://ship-check.invalid").searchParams;
  } catch {
    const queryStart = value.indexOf("?");
    if (queryStart < 0) return new URLSearchParams();
    const fragmentStart = value.indexOf("#", queryStart);
    return new URLSearchParams(
      value.slice(queryStart + 1, fragmentStart >= 0 ? fragmentStart : undefined)
    );
  }
}

function routeParts(value: string): string[] {
  return pathname(value).split("/").filter(Boolean);
}

function projectId(value: string): string {
  return CloudHistoryIngestRequestSchema.shape.projectId.parse(value);
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

function expectsJsonBody(parts: string[], method: string): boolean {
  if (method === "POST" && parts.join("/") === "v1/projects/connect") return true;
  if (method === "POST" && parts.length === 4 && parts[0] === "v1" && parts[1] === "projects" && parts[3] === "events") return true;
  if (method === "PATCH" && parts.length === 4 && parts[0] === "v1" && parts[1] === "projects" && (parts[3] === "name" || parts[3] === "retention")) return true;
  return false;
}

function parseJsonBody(request: CloudHistoryHttpRequest, maxBodyBytes: number): unknown {
  const body = request.body ?? "";
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
    throw new HttpBoundaryError(413, "payload-too-large", "Request body exceeds the Cloud history metadata limit.");
  }
  const contentType = request.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpBoundaryError(400, "invalid-request", "Request body must use application/json.");
  }
  if (!body.trim()) {
    throw new HttpBoundaryError(400, "invalid-request", "Request body is required.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpBoundaryError(400, "invalid-request", "Request body must contain valid JSON.");
  }
}

class HttpBoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: CloudHistoryHttpError["code"],
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "HttpBoundaryError";
  }
}

function serviceErrorResponse(error: CloudHistoryServiceOperationError): CloudHistoryHttpResponse {
  if (error.code === "project-not-found" || error.code === "account-not-found") {
    return errorResponse(404, "not-found", error.message);
  }
  if (error.code === "project-list-cursor-invalid") {
    return errorResponse(400, "invalid-request", error.message);
  }
  return errorResponse(409, "conflict", error.message);
}

export function createCloudHistoryHttpHandler(
  service: CloudHistoryService,
  options: CloudHistoryHttpOptions = {}
): CloudHistoryHttpHandler {
  const maxBodyBytes = options.maxBodyBytes ?? CLOUD_HISTORY_DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
    throw new Error("Cloud history HTTP maxBodyBytes must be an integer of at least 1024 bytes.");
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

    if (isMutation(method) && request.auth.mutationAuthorised !== true) {
      return errorResponse(
        403,
        "mutation-not-authorised",
        "This authenticated request is not authorised to change Cloud history."
      );
    }

    try {
      const body = expectsJsonBody(parts, method)
        ? parseJsonBody(request, maxBodyBytes)
        : undefined;

      if (parts.join("/") === "v1/projects/connect") {
        if (method !== "POST") {
          return errorResponse(405, "method-not-allowed", "Use POST for project connect.", { allow: "POST" });
        }
        const input = CloudProjectConnectRequestSchema.parse(body);
        return jsonResponse(200, await service.connectProject(principal, input));
      }

      if (parts.join("/") === "v1/projects") {
        if (method !== "GET") {
          return errorResponse(405, "method-not-allowed", "Use GET to list connected projects.", { allow: "GET" });
        }
        const params = query(request.path);
        const limitValue = params.get("limit");
        const cursorValue = params.get("cursor");
        const input = CloudProjectListRequestSchema.parse({
          schemaVersion: "0.1",
          ...(limitValue !== null ? { limit: Number(limitValue) } : {}),
          ...(cursorValue ? { cursor: cursorValue } : {})
        });
        return jsonResponse(200, await service.listProjects(principal, input));
      }

      if (parts.length >= 3 && parts[0] === "v1" && parts[1] === "projects") {
        const id = projectId(parts[2]!);

        if (parts.length === 3) {
          if (method === "GET") {
            return jsonResponse(200, await service.getProject(principal, id));
          }
          if (method === "DELETE") {
            return jsonResponse(200, await service.deleteProject(principal, id));
          }
          return errorResponse(
            405,
            "method-not-allowed",
            "Use GET or DELETE for this project route.",
            { allow: "GET, DELETE" }
          );
        }

        if (parts.length === 4 && parts[3] === "events") {
          if (method !== "POST") {
            return errorResponse(405, "method-not-allowed", "Use POST to sync project metadata.", { allow: "POST" });
          }
          const input = CloudHistoryIngestRequestSchema.parse(body);
          if (input.projectId !== id) {
            return errorResponse(400, "invalid-request", "Body projectId must match the project route.");
          }
          return jsonResponse(200, await service.sync(principal, input));
        }

        if (parts.length === 4 && parts[3] === "export") {
          if (method !== "GET") {
            return errorResponse(405, "method-not-allowed", "Use GET to export project history.", { allow: "GET" });
          }
          return jsonResponse(200, await service.exportProject(principal, id), {
            "content-disposition": `attachment; filename="ship-check-history-${id}.json"`
          });
        }

        if (parts.length === 4 && parts[3] === "timeline") {
          if (method !== "GET") {
            return errorResponse(405, "method-not-allowed", "Use GET to read the project timeline.", { allow: "GET" });
          }
          return jsonResponse(200, await service.getTimeline(principal, id));
        }

        if (parts.length === 4 && parts[3] === "name") {
          if (method !== "PATCH") {
            return errorResponse(405, "method-not-allowed", "Use PATCH to update the project name.", { allow: "PATCH" });
          }
          const input = CloudProjectNameUpdateRequestSchema.parse(body);
          if (input.projectId !== id) {
            return errorResponse(400, "invalid-request", "Body projectId must match the project route.");
          }
          return jsonResponse(200, await service.updateDisplayName(principal, input));
        }

        if (parts.length === 4 && parts[3] === "retention") {
          if (method !== "PATCH") {
            return errorResponse(405, "method-not-allowed", "Use PATCH to update project retention.", { allow: "PATCH" });
          }
          const input = CloudRetentionUpdateRequestSchema.parse(body);
          if (input.projectId !== id) {
            return errorResponse(400, "invalid-request", "Body projectId must match the project route.");
          }
          return jsonResponse(200, await service.updateRetention(principal, input));
        }
      }

      if (parts.join("/") === "v1/account") {
        if (method !== "DELETE") {
          return errorResponse(405, "method-not-allowed", "Use DELETE for account deletion.", { allow: "DELETE" });
        }
        return jsonResponse(200, await service.deleteAccount(principal));
      }

      return errorResponse(404, "not-found", "Cloud history route was not found.");
    } catch (error) {
      if (error instanceof HttpBoundaryError) {
        return errorResponse(error.status, error.code, error.message, error.headers);
      }
      if (error instanceof CloudHistoryServiceOperationError) {
        return serviceErrorResponse(error);
      }
      if (error instanceof Error && error.name === "ZodError") {
        return errorResponse(400, "invalid-request", "Request payload does not match the Cloud history contract.");
      }

      options.onInternalError?.(error);
      return errorResponse(500, "internal-error", "Unexpected Cloud history server error.");
    }
  };
}
