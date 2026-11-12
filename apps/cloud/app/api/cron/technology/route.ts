import { timingSafeEqual } from "node:crypto";
import { cloudDatabase } from "../../../lib/cloudRuntime";
import { refreshTechnologyMonitoring } from "../../../lib/technologyRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function equalSecret(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (process.env.SHIP_CHECK_TECH_MONITORING_ENABLED !== "1") {
    return Response.json({ error: "Not enabled." }, { status: 503, headers });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24) return Response.json({ error: "Scheduler not configured." }, { status: 503, headers });
  const auth = request.headers.get("authorization") ?? "";
  if (!equalSecret(auth, "Bearer " + secret)) {
    return Response.json({ error: "Unauthorised." }, { status: 401, headers });
  }
  try {
    const result = await refreshTechnologyMonitoring(cloudDatabase(), {
      openAIKey: process.env.SHIP_CHECK_OPENAI_MODELS_API_KEY
    });
    return Response.json(result, { headers });
  } catch (err) {
    console.error("Technology refresh failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Technology refresh did not complete." }, { status: 503, headers });
  }
}
