import { createHash, timingSafeEqual } from "node:crypto";
import {
  type CloudHistoryWebAuthenticator,
  type CloudR0RateLimitContext,
  type CloudR0RateLimitDecision
} from "@ship-check/adapters";
import { createCloudRuntime } from "@ship-check/cloud-runtime";

type Window = {
  startedAt: number;
  count: number;
};

const windows = new Map<string, Window>();

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required Cloud environment variable: ${name}`);
  return value;
}

function allowedOrigins(): string[] {
  return (process.env.SHIP_CHECK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(hash(left), "hex");
  const b = Buffer.from(hash(right), "hex");
  return timingSafeEqual(a, b);
}

export const authenticatePilotSession: CloudHistoryWebAuthenticator = async (
  request
) => {
  const expected = process.env.SHIP_CHECK_PILOT_SESSION_SECRET?.trim();
  if (!expected) return null;

  const supplied = request.headers.get("x-ship-check-pilot-session")?.trim();
  if (!supplied || !sameSecret(supplied, expected)) return null;

  return {
    principal: {
      schemaVersion: "0.1",
      authSubjectHash: hash("ship-check-cloud-pilot")
    },
    mutationAuthorised: true
  };
};

function rateKey(context: CloudR0RateLimitContext): string {
  const forwarded = context.request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const ip = forwarded || context.request.headers.get("x-real-ip") || "unknown";
  return `${context.credential}:${context.routeFamily}:${hash(ip).slice(0, 16)}`;
}

export function pilotRateLimit(
  context: CloudR0RateLimitContext
): CloudR0RateLimitDecision {
  const now = Date.now();
  const durationMs = 60_000;
  const limit = context.credential === "bearer" ? 120 : 60;
  const key = rateKey(context);
  const current = windows.get(key);

  if (!current || now - current.startedAt >= durationMs) {
    windows.set(key, { startedAt: now, count: 1 });
    return { allowed: true };
  }

  current.count += 1;
  if (current.count <= limit) return { allowed: true };

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((durationMs - (now - current.startedAt)) / 1000)
    )
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __shipCheckCloudRuntime:
    | ReturnType<typeof createCloudRuntime>
    | undefined;
}

export function cloudRuntime() {
  if (!globalThis.__shipCheckCloudRuntime) {
    globalThis.__shipCheckCloudRuntime = createCloudRuntime({
      postgres: {
        connectionString: env("DATABASE_URL"),
        maxConnections: 5,
        connectionTimeoutMs: 5_000,
        applicationName: "ship-check-cloud"
      },
      authenticateSession: authenticatePilotSession,
      allowedOrigins: allowedOrigins(),
      rateLimit: pilotRateLimit,
      onInternalError: (error) => {
        console.error("Ship Check Cloud internal error", error);
      },
      onAuthenticationError: (error) => {
        console.warn("Ship Check Cloud authentication error", error);
      }
    });
  }
  return globalThis.__shipCheckCloudRuntime;
}
