export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      status: "ok",
      service: "ship-check-cloud",
      schemaVersion: "0.1"
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    }
  );
}
