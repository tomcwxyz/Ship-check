import { cloudDatabaseReady } from "../../../lib/cloudRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const configured = Boolean(
    process.env.DATABASE_URL?.trim() &&
    process.env.NEON_AUTH_BASE_URL?.trim() &&
    process.env.SHIP_CHECK_ALLOWED_ORIGINS?.trim()
  );
  let databaseReady = false;
  if (configured) {
    try {
      databaseReady = await cloudDatabaseReady();
    } catch {
      // A health check must not expose Postgres connection details.
    }
  }
  const ready = configured && databaseReady;
  return Response.json({
    status: ready ? "ready" : configured ? "dependency-unavailable" : "configuration-incomplete",
    service: "ship-check-cloud",
    schemaVersion: "0.1",
    database: databaseReady ? "ready" : "unavailable",
    authentication: configured ? "neon-auth-configured" : "configuration-incomplete",
    monitoring: "opt-in-ci-only",
    mcp: "bearer-scoped-read-only"
  }, {
    status: ready ? 200 : 503,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
