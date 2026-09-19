import {
  CloudApiTokenValueSchema,
  type CloudApiTokenScope
} from "@ship-check/schemas";
import type { CloudHistoryHttpAuthContext } from "./cloudHistoryHttp.js";
import type { CloudHistoryWebAuthenticator } from "./cloudHistoryWeb.js";
import type { CloudApiTokenStore } from "./cloudApiTokenStore.js";

function pathname(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

function parts(request: Request): string[] {
  return pathname(request).split("/").filter(Boolean);
}

function isProjectIdPath(parts: string[]): boolean {
  return parts.length >= 3 && parts[0] === "v1" && parts[1] === "projects";
}

export function requiredCloudApiTokenScope(
  request: Pick<Request, "method" | "url">
): CloudApiTokenScope | null {
  const method = request.method.trim().toUpperCase();
  const path = (() => {
    try {
      return new URL(request.url).pathname.split("/").filter(Boolean);
    } catch {
      return [];
    }
  })();

  if (method === "GET" && path.join("/") === "v1/projects") {
    return "history:read";
  }

  if (method === "POST" && path.join("/") === "v1/projects/connect") {
    return "history:sync";
  }

  if (isProjectIdPath(path)) {
    if (path.length === 3) {
      if (method === "GET") return "history:read";
      if (method === "DELETE") return "project:manage";
      return null;
    }

    if (path.length === 4) {
      if (
        method === "GET" &&
        (path[3] === "timeline" || path[3] === "export")
      ) {
        return "history:read";
      }
      if (method === "POST" && path[3] === "events") {
        return "history:sync";
      }
      if (
        method === "PATCH" &&
        (path[3] === "name" || path[3] === "retention")
      ) {
        return "project:manage";
      }
    }
  }

  // Account deletion and any future/unknown route are intentionally outside
  // the first API-token authority map until explicitly added.
  return null;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer[ 	]+([^ 	]+)$/i.exec(value.trim());
  if (!match) return null;

  const parsed = CloudApiTokenValueSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

export function createCloudApiTokenWebAuthenticator(
  tokenStore: CloudApiTokenStore
): CloudHistoryWebAuthenticator {
  return async (request): Promise<CloudHistoryHttpAuthContext | null> => {
    const token = bearerToken(request);
    if (!token) return null;

    const authenticated = await tokenStore.authenticateToken(token);
    if (!authenticated) return null;

    const requiredScope = requiredCloudApiTokenScope(request);
    const requestAuthorised =
      requiredScope !== null && authenticated.scopes.includes(requiredScope);
    const method = request.method.trim().toUpperCase();
    const mutation = method === "POST" || method === "PATCH" || method === "DELETE";

    return {
      principal: {
        schemaVersion: "0.1",
        authSubjectHash: authenticated.authSubjectHash
      },
      requestAuthorised,
      mutationAuthorised: requestAuthorised && mutation
    };
  };
}
