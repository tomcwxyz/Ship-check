import {
  CloudApiTokenValueSchema,
  CloudHistoryHttpErrorSchema,
  CloudHistoryIngestResultSchema,
  CloudHistoryRetentionSchema,
  CloudProjectConnectResultSchema,
  CloudProjectListPageSchema,
  ProjectHistoryMetadataSchema,
  ProjectHistoryTimelineSchema,
  type CloudHistoryIngestResult,
  type CloudHistoryRetention,
  type CloudProjectConnectResult,
  type CloudProjectListPage,
  type ProjectHistoryMetadata,
  type ProjectHistoryTimeline
} from "@ship-check/schemas";

export const SHIP_CHECK_CLOUD_URL_ENV = "SHIP_CHECK_CLOUD_URL";
export const SHIP_CHECK_CLOUD_TOKEN_ENV = "SHIP_CHECK_CLOUD_TOKEN";
export const CLOUD_CLIENT_DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export type CloudHistoryClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
};

export type ConnectCloudProjectOptions = {
  event: ProjectHistoryMetadata;
  retention?: CloudHistoryRetention;
  displayName?: string;
};

export class CloudHistoryClientError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "CloudHistoryClientError";
    this.status = options.status;
    this.code = options.code;
  }
}

function normaliseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CloudHistoryClientError("Cloud URL must be an absolute http(s) URL.");
  }

  if (url.username || url.password) {
    throw new CloudHistoryClientError("Cloud URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new CloudHistoryClientError("Cloud URL must not contain a query string or fragment.");
  }

  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new CloudHistoryClientError(
      "Cloud URL must use HTTPS, except for localhost development."
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

async function readBoundedResponse(
  response: Response,
  maxResponseBytes: number
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) {
    throw new CloudHistoryClientError(
      "Cloud response exceeded the configured size limit.",
      { status: response.status }
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new CloudHistoryClientError(
          "Cloud response exceeded the configured size limit.",
          { status: response.status }
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export function createCloudHistoryClient(options: CloudHistoryClientOptions) {
  const baseUrl = normaliseBaseUrl(options.baseUrl);
  const token = CloudApiTokenValueSchema.parse(options.token);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResponseBytes =
    options.maxResponseBytes ?? CLOUD_CLIENT_DEFAULT_MAX_RESPONSE_BYTES;

  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024) {
    throw new CloudHistoryClientError(
      "Cloud response limit must be an integer of at least 1024 bytes."
    );
  }

  const request = async <T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers
        },
        redirect: "error"
      });
    } catch (error) {
      throw new CloudHistoryClientError(
        `Cloud request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const text = await readBoundedResponse(response, maxResponseBytes);
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new CloudHistoryClientError(
          "Cloud returned a non-JSON response.",
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      const parsed = CloudHistoryHttpErrorSchema.safeParse(payload);
      throw new CloudHistoryClientError(
        parsed.success
          ? parsed.data.message
          : `Cloud request failed with HTTP ${response.status}.`,
        {
          status: response.status,
          ...(parsed.success ? { code: parsed.data.code } : {})
        }
      );
    }

    try {
      return parse(payload);
    } catch {
      throw new CloudHistoryClientError(
        "Cloud response did not match the Ship Check contract.",
        { status: response.status }
      );
    }
  };

  return {
    async connectProject(
      input: ConnectCloudProjectOptions
    ): Promise<CloudProjectConnectResult> {
      const event = ProjectHistoryMetadataSchema.parse(input.event);
      const retention = CloudHistoryRetentionSchema.parse(
        input.retention ?? "90-days"
      );
      return request(
        "/v1/projects/connect",
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "0.1",
            event,
            retention,
            ...(input.displayName ? { displayName: input.displayName } : {})
          })
        },
        (value) => CloudProjectConnectResultSchema.parse(value)
      );
    },

    async syncProject(
      projectId: string,
      eventValue: ProjectHistoryMetadata
    ): Promise<CloudHistoryIngestResult> {
      const event = ProjectHistoryMetadataSchema.parse(eventValue);
      return request(
        `/v1/projects/${encodeURIComponent(projectId)}/events`,
        {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: "0.1",
            projectId,
            event
          })
        },
        (value) => CloudHistoryIngestResultSchema.parse(value)
      );
    },

    async listProjects(limit = 50, cursor?: string): Promise<CloudProjectListPage> {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      return request(
        `/v1/projects?${params.toString()}`,
        { method: "GET" },
        (value) => CloudProjectListPageSchema.parse(value)
      );
    },

    async getTimeline(projectId: string): Promise<ProjectHistoryTimeline> {
      return request(
        `/v1/projects/${encodeURIComponent(projectId)}/timeline`,
        { method: "GET" },
        (value) => ProjectHistoryTimelineSchema.parse(value)
      );
    }
  };
}

export function resolveCloudClientConfig(values: {
  cloudUrl?: string;
  cloudToken?: string;
  env?: NodeJS.ProcessEnv;
}): { baseUrl: string; token: string } {
  const env = values.env ?? process.env;
  const baseUrl = values.cloudUrl ?? env[SHIP_CHECK_CLOUD_URL_ENV];
  const token = values.cloudToken ?? env[SHIP_CHECK_CLOUD_TOKEN_ENV];

  if (!baseUrl) {
    throw new CloudHistoryClientError(
      `Cloud URL is required via --cloud-url or ${SHIP_CHECK_CLOUD_URL_ENV}.`
    );
  }
  if (!token) {
    throw new CloudHistoryClientError(
      `Cloud API token is required via ${SHIP_CHECK_CLOUD_TOKEN_ENV}.`
    );
  }

  return { baseUrl, token };
}
