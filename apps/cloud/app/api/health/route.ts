export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness is not database readiness. This endpoint deliberately does not
// connect to Postgres or reveal environment-variable names or values.
export async function GET(): Promise<Response> {
  const configured = Boolean(
    process.env.DATABASE_URL?.trim() &&
    process.env.SHIP_CHECK_PILOT_SESSION_SECRET?.trim()
  );
  return Response.json(
    {
      status: configured ? "configuration-present" : "configuration-incomplete",
      service: "ship-check-cloud",
      schemaVersion: "0.1",
      database: "not-tested",
      monitoring: "not-scheduled"
    },
    {
      status: configured ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    }
  );
}
