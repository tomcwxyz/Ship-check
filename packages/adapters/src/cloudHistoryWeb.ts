import {
  CloudHistoryHttpErrorSchema,
  type CloudHistoryHttpError
} from "@ship-check/schemas";
import {
  CLOUD_HISTORY_DEFAULT_MAX_BODY_BYTES,
  createCloudHistoryHttpHandler,
  type CloudHistoryHttpAuthContext,
  type CloudHistoryHttpOptions
} from "./cloudHistoryHttp.js";
import type { CloudHistoryService } from "./cloudHistoryService.js";

export type CloudHistoryWebAuthenticator = (
  request: Request
) => Promise<CloudHistoryHttpAuthContext | null>;

export type CloudHistoryWebOptions = CloudHistoryHttpOptions & {
  authenticate: CloudHistoryWebAuthenticator;
  onAuthenticationError?: (error: unknown) => void;
};

export type CloudHistoryWebHandler = (request: Request) => Promise<Response>;

class WebPayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the Cloud history metadata limit.");
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
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

function shouldReadBody(method: string): boolean {
  return method === "POST" || method === "PATCH";
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

export function createCloudHistoryWebHandler(
  service: CloudHistoryService,
  options: CloudHistoryWebOptions
): CloudHistoryWebHandler {
  const maxBodyBytes = options.maxBodyBytes ?? CLOUD_HISTORY_DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
    throw new Error("Cloud history Web maxBodyBytes must be an integer of at least 1024 bytes.");
  }

  const transport = createCloudHistoryHttpHandler(service, {
    maxBodyBytes,
    onInternalError: options.onInternalError
  });

  return async (request) => {
    let auth: CloudHistoryHttpAuthContext | null;
    try {
      auth = await options.authenticate(request);
    } catch (error) {
      options.onAuthenticationError?.(error);
      return errorResponse(500, "internal-error", "Unexpected Cloud history server error.");
    }

    let body: string | undefined;
    if (shouldReadBody(request.method.trim().toUpperCase())) {
      try {
        body = await readBoundedBody(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof WebPayloadTooLargeError) {
          return errorResponse(
            413,
            "payload-too-large",
            "Request body exceeds the Cloud history metadata limit."
          );
        }
        options.onInternalError?.(error);
        return errorResponse(400, "invalid-request", "Request body could not be read.");
      }
    }

    const response = await transport({
      method: request.method,
      path: requestPath(request),
      contentType: request.headers.get("content-type") ?? undefined,
      ...(body !== undefined ? { body } : {}),
      auth
    });

    return responseFromTransport(response);
  };
}
