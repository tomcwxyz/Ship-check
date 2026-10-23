import { createHash } from "node:crypto";

/**
 * Thin, same-origin Neon Auth bridge for the email/password Alpha 12 pilot.
 *
 * The upstream Auth server alone validates sessions. Browser-provided user IDs
 * or unsigned client session state are never accepted as authentication.
 */
const AUTH_PATHS = new Set([
  "get-session",
  "sign-in/email",
  "sign-up/email",
  "sign-out",
  "forget-password",
  "reset-password",
  "request-password-reset"
]);

export function neonAuthBaseUrl(): string {
  const raw = process.env.NEON_AUTH_BASE_URL?.trim();
  if (!raw) throw new Error("Neon Auth is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Neon Auth must be an HTTPS origin and path.");
  }
  return url.href.replace(/\/$/, "");
}

export type NeonIdentity = {
  id: string;
  email: string;
  name: string;
};

export function subjectHash(userId: string): string {
  return createHash("sha256").update(`neon-auth-user-v1\0${userId}`).digest("hex");
}

export async function verifiedIdentity(
  cookieHeader: string | null
): Promise<NeonIdentity | null> {
  if (!cookieHeader || cookieHeader.length > 8192) return null;
  const response = await fetch(`${neonAuthBaseUrl()}/get-session`, {
    method: "GET",
    headers: {
      cookie: cookieHeader,
      accept: "application/json"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) return null;
  const result: unknown = await response.json();
  if (!result || typeof result !== "object") return null;
  const data = result as { user?: unknown; session?: unknown };
  if (!data.session || typeof data.session !== "object" || !data.user || typeof data.user !== "object") {
    return null;
  }
  const user = data.user as Record<string, unknown>;
  if (typeof user.id !== "string" || user.id.length < 1 || user.id.length > 256) return null;
  if (typeof user.email !== "string" || user.email.length > 320) return null;
  return {
    id: user.id,
    email: user.email,
    name: typeof user.name === "string" ? user.name.slice(0, 160) : ""
  };
}

export async function authenticateNeonSession(
  request: Request
): Promise<{ principal: { schemaVersion: "0.1"; authSubjectHash: string }; mutationAuthorised: true } | null> {
  // Existing browser sessions are validated by Neon on every API call.
  const identity = await verifiedIdentity(request.headers.get("cookie"));
  if (!identity) return null;
  return {
    principal: {
      schemaVersion: "0.1",
      authSubjectHash: subjectHash(identity.id)
    },
    mutationAuthorised: true
  };
}

function allowedBrowserOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const allowed = (process.env.SHIP_CHECK_ALLOWED_ORIGINS ?? "")
    .split(",").map(v => v.trim()).filter(Boolean);
  if (!origin || origin === "null") return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && allowed.includes(parsed.origin);
  } catch {
    return false;
  }
}

function cleanCookie(raw: string): string | null {
  // Set-Cookie is server-authored, but don't forward upstream Domain or Path
  // attributes: the reverse proxy intentionally owns same-origin session cookies.
  if (raw.length > 4096 || /[\r\n]/.test(raw)) return null;
  const parts = raw.split(";").map(x => x.trim()).filter(Boolean);
  if (!/^[A-Za-z0-9_.-]+=[^;]*$/.test(parts[0] ?? "")) return null;
  const flags = parts.slice(1).filter(x => !/^(domain|path|samesite|secure)=?/i.test(x));
  return [parts[0], "Path=/", ...flags, "SameSite=Lax", "Secure"].join("; ");
}

export async function proxyNeonAuth(request: Request, pathParts: string[]): Promise<Response> {
  const path = pathParts.join("/");
  const method = request.method.toUpperCase();
  if (!AUTH_PATHS.has(path) || (method !== "GET" && method !== "POST") ||
      (method === "GET" && path !== "get-session") ||
      (method === "POST" && path === "get-session")) {
    return Response.json({ error: "Unknown authentication operation." }, { status: 404 });
  }
  if (method === "POST" && !allowedBrowserOrigin(request)) {
    return Response.json({ error: "Origin not authorised." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16384) return Response.json({ error: "Auth request too large." }, { status: 413 });
  let body: ArrayBuffer | undefined;
  if (method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > 16384) return Response.json({ error: "Auth request too large." }, { status: 413 });
  }
  try {
    const headers = new Headers({ accept: "application/json" });
    const cookie = request.headers.get("cookie");
    if (cookie && cookie.length <= 8192) headers.set("cookie", cookie);
    if (method === "POST") {
      const type = request.headers.get("content-type") ?? "";
      if (!type.toLowerCase().startsWith("application/json")) {
        return Response.json({ error: "Authentication requests must be JSON." }, { status: 415 });
      }
      headers.set("content-type", "application/json");
      headers.set("origin", (process.env.SHIP_CHECK_ALLOWED_ORIGINS ?? "").split(",")[0]?.trim() ?? "");
    }
    const upstream = await fetch(`${neonAuthBaseUrl()}/${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return Response.json({ error: "Unexpected authentication redirect." }, { status: 502 });
    }
    const payload = await upstream.text();
    if (payload.length > 65536) return Response.json({ error: "Auth response too large." }, { status: 502 });
    const responseHeaders = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    const cookies = upstream.headers.getSetCookie();
    for (const cookieLine of cookies) {
      const safe = cleanCookie(cookieLine);
      if (safe) responseHeaders.append("set-cookie", safe);
    }
    return new Response(payload, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: "Authentication service is temporarily unavailable." }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
