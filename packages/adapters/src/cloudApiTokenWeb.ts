import {
  CloudHistoryHttpErrorSchema,
  type CloudHistoryHttpError
} from "@ship-check/schemas";
import {
  CLOUD_API_TOKEN_DEFAULT_MAX_BODY_BYTES,
  createCloudApiTokenHttpHandler,
  type CloudApiTokenHttpAuthContext,
  type CloudApiTokenHttpOptions
} from "./cloudApiTokenHttp.js";
import type { CloudApiTokenService } from "./cloudApiTokenService.js";

export type CloudApiTokenWebAuthenticator = (
  request: Request
) => Promise<CloudApiTokenHttpAuthContext | null>;

export type CloudApiTokenWebOptions = CloudApiTokenHttpOptions & {
  authenticate: CloudApiTokenWebAuthenticator;
  onAuthenticationError?: (error: unknown) => void;
};

export type CloudApiTokenWebHandler = (request: Request) => Promise<Response>;

class WebPayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the Cloud API token limit.");
    this.name = "WebPayloadTooLargeError";
  }
}

function errorResponse(
  status: number,
  code: CloudHistoryHttpError["code"],
  message: string
): Response {
  const payload = CloudHistoryHttpErrorSchema.parse({
    schemaVersion: "0.1",
    type: "cloud-history-http-error",
    code,
    message
  });
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function responseFromTransport(value: {
  status: number;
  headers: Record<string, string>;
  body: string;
}): Response {
  return new Response(value.body, {
    status: value.status,
    headers: value.headers
  });
}

function requestPath(request: Request): string {
  try {
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

async function readBoundedBody(
  request: Request,
  maxBodyBytes: number
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declared = Number(contentLength);
    if (Number.isSafeInteger(declared) && declared > maxBodyBytes) {
      throw new WebPayloadTooLargeError();
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new WebPayloadTooLargeError();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export function createCloudApiTokenWebHandler(
  service: CloudApiTokenService,
  options: CloudApiTokenWebOptions
): CloudApiTokenWebHandler {
  const maxBodyBytes =
    options.maxBodyBytes ?? CLOUD_API_TOKEN_DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
    throw new Error(
      "Cloud API token Web maxBodyBytes must be an integer of at least 1024 bytes."
    );
  }

  const transport = createCloudApiTokenHttpHandler(service, {
    maxBodyBytes,
    onInternalError: options.onInternalError
  });

  return async (request) => {
    let auth: CloudApiTokenHttpAuthContext | null;
    try {
      auth = await options.authenticate(request);
    } catch (error) {
      options.onAuthenticationError?.(error);
      return errorResponse(
        500,
        "internal-error",
        "Unexpected Cloud API token server error."
      );
    }

    if (!auth || auth.requestAuthorised === false) {
      return responseFromTransport(
        await transport({
          method: request.method,
          path: requestPath(request),
          contentType: request.headers.get("content-type") ?? undefined,
          auth
        })
      );
    }

    const method = request.method.trim().toUpperCase();
    const mutation = method === "POST" || method === "PATCH" || method === "DELETE";
    if (mutation && auth.mutationAuthorised !== true) {
      return responseFromTransport(
        await transport({
          method: request.method,
          path: requestPath(request),
          contentType: request.headers.get("content-type") ?? undefined,
          auth
        })
      );
    }

    let body: string | undefined;
    if (method === "POST") {
      try {
        body = await readBoundedBody(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof WebPayloadTooLargeError) {
          return errorResponse(
            413,
            "payload-too-large",
            "Request body exceeds the Cloud API token limit."
          );
        }
        options.onInternalError?.(error);
        return errorResponse(400, "invalid-request", "Request body could not be read.");
      }
    }

    return responseFromTransport(
      await transport({
        method: request.method,
        path: requestPath(request),
        contentType: request.headers.get("content-type") ?? undefined,
        ...(body !== undefined ? { body } : {}),
        auth
      })
    );
  };
}
