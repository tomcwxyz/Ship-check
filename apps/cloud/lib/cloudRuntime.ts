import {
  type CloudHistoryWebAuthenticator
} from "@ship-check/adapters";
import { createCloudRuntime } from "@ship-check/cloud-runtime";
import { cloudSessionPrincipal } from "./auth/server";

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

export const authenticateHostedSession: CloudHistoryWebAuthenticator = async () => {
  const principal = await cloudSessionPrincipal();
  if (!principal) return null;

  return {
    principal,
    mutationAuthorised: true
  };
};

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
      authenticateSession: authenticateHostedSession,
      allowedOrigins: allowedOrigins(),
      persistentRateLimit: {
        windowSeconds: 60,
        sessionLimit: 60,
        bearerLimit: 120
      },
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
