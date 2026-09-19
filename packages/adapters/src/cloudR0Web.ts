import {
  CloudHistoryHttpErrorSchema,
  type CloudHistoryHttpError
} from "@ship-check/schemas";
import { createCloudApiTokenWebAuthenticator } from "./cloudApiTokenAuth.js";
import type { CloudApiTokenStore } from "./cloudApiTokenStore.js";
import {
  createCloudApiTokenWebHandler,
  type CloudApiTokenWebAuthenticator
} from "./cloudApiTokenWeb.js";
import type { CloudApiTokenService } from "./cloudApiTokenService.js";
import {
  createCloudHistoryWebHandler,
  type CloudHistoryWebAuthenticator
} from "./cloudHistoryWeb.js";
import type { CloudHistoryService } from "./cloudHistoryService.js";

export type CloudR0CredentialKind = "bearer" | "session";
export type CloudR0RouteFamily = "history" | "token-management";

export type CloudR0RateLimitContext = {
  request: Request;
  credential: CloudR0CredentialKind;
  routeFamily: CloudR0RouteFamily;
};

export type CloudR0RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type CloudR0WebOptions = {
  authenticateSession: CloudHistoryWebAuthenticator;
  allowedOrigins?: string[];
  rateLimit?: (
    context: CloudR0RateLimitContext
  ) => Promise<CloudR0RateLimitDecision> | CloudR0RateLimitDecision;
  maxHistoryBodyBytes?: number;
  maxTokenBodyBytes?: number;
  onInternalError?: (error: unknown) => void;
  onAuthenticationError?: (error: unknown) => void;
};

export type CloudR0WebHandler = (request: Request) => Promise<Response>;

function jsonError(
  status: number,
  code: CloudHistoryHttpError["code"],
  message: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify(
      CloudHistoryHttpErrorSchema.parse({
        schemaVersion: "0.1",
        type: "cloud-history-http-error",
        code,
        message
      })
    ),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...headers
      }
    }
  );
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

function routeFamily(request: Request): CloudR0RouteFamily {
  const path = requestPath(request);
  return path === "/v1/tokens" || path.startsWith("/v1/tokens/")
    ? "token-management"
    : "history";
}

function isMutation(request: Request): boolean {
  const method = request.method.trim().toUpperCase();
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

function hasAuthorizationHeader(request: Request): boolean {
  return request.headers.has("authorization");
}

function normaliseAllowedOrigins(values: string[]): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid Cloud allowed origin: ${value}`);
    }
    if (url.origin === "null") {
      throw new Error(`Invalid Cloud allowed origin: ${value}`);
    }
    result.add(url.origin);
  }
  return result;
}

function sessionOriginAuthorised(
  request: Request,
  allowedOrigins: Set<string>
): boolean {
  const originValue = request.headers.get("origin");
  if (!originValue || originValue === "null") return false;

  let origin: URL;
  let target: URL;
  try {
    origin = new URL(originValue);
    target = new URL(request.url);
  } catch {
    return false;
  }

  return (
    origin.origin === target.origin ||
    allowedOrigins.has(origin.origin)
  );
}

function credentialKind(
  request: Request,
  family: CloudR0RouteFamily
): CloudR0CredentialKind {
  // Token management is deliberately a browser/session authority. A bearer
  // header never upgrades or replaces that requirement.
  if (family === "token-management") return "session";
  return hasAuthorizationHeader(request) ? "bearer" : "session";
}

export function createCloudR0WebHandler(
  historyService: CloudHistoryService,
  tokenService: CloudApiTokenService,
  tokenStore: CloudApiTokenStore,
  options: CloudR0WebOptions
): CloudR0WebHandler {
  const allowedOrigins = normaliseAllowedOrigins(options.allowedOrigins ?? []);
  const bearerAuthenticate = createCloudApiTokenWebAuthenticator(tokenStore);

  const sessionHistory = createCloudHistoryWebHandler(historyService, {
    authenticate: options.authenticateSession,
    ...(options.maxHistoryBodyBytes !== undefined
      ? { maxBodyBytes: options.maxHistoryBodyBytes }
      : {}),
    onInternalError: options.onInternalError,
    onAuthenticationError: options.onAuthenticationError
  });

  const bearerHistory = createCloudHistoryWebHandler(historyService, {
    authenticate: bearerAuthenticate,
    ...(options.maxHistoryBodyBytes !== undefined
      ? { maxBodyBytes: options.maxHistoryBodyBytes }
      : {}),
    onInternalError: options.onInternalError,
    onAuthenticationError: options.onAuthenticationError
  });

  const tokenManagement = createCloudApiTokenWebHandler(tokenService, {
    authenticate: options.authenticateSession as CloudApiTokenWebAuthenticator,
    ...(options.maxTokenBodyBytes !== undefined
      ? { maxBodyBytes: options.maxTokenBodyBytes }
      : {}),
    onInternalError: options.onInternalError,
    onAuthenticationError: options.onAuthenticationError
  });

  return async (request) => {
    const family = routeFamily(request);
    const credential = credentialKind(request, family);

    if (options.rateLimit) {
      let decision: CloudR0RateLimitDecision;
      try {
        decision = await options.rateLimit({
          request,
          credential,
          routeFamily: family
        });
      } catch (error) {
        options.onInternalError?.(error);
        return jsonError(
          500,
          "internal-error",
          "Unexpected Cloud request guard error."
        );
      }

      if (!decision.allowed) {
        const retryAfter =
          decision.retryAfterSeconds !== undefined &&
          Number.isInteger(decision.retryAfterSeconds) &&
          decision.retryAfterSeconds > 0
            ? String(decision.retryAfterSeconds)
            : undefined;
        return jsonError(
          429,
          "rate-limited",
          "Too many Cloud requests. Try again later.",
          retryAfter ? { "retry-after": retryAfter } : {}
        );
      }
    }

    if (
      credential === "session" &&
      isMutation(request) &&
      !sessionOriginAuthorised(request, allowedOrigins)
    ) {
      return jsonError(
        403,
        "origin-not-authorised",
        "Browser session mutations require an authorised Origin."
      );
    }

    if (family === "token-management") {
      return tokenManagement(request);
    }

    // The presence of any Authorization header selects bearer authentication.
    // Invalid/malformed bearer credentials therefore fail closed instead of
    // falling back to a browser session.
    return credential === "bearer"
      ? bearerHistory(request)
      : sessionHistory(request);
  };
}
