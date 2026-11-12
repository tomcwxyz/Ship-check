import { cloudDatabase, cloudRuntime, cloudTechnologyRateLimit } from "../../../../../lib/cloudRuntime";
import { verifiedIdentity, subjectHash } from "../../../../../lib/neonAuth";
import { getTechnologyInventory, parseComponents, saveTechnologyInventory, stopTechnologyMonitoring } from "../../../../../lib/technologyMonitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES = 12_000;
const RESPONSE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: RESPONSE_HEADERS });
}

function allowedOrigin(request: Request): boolean {
  const value = request.headers.get("origin");
  if (!value) return false;
  try {
    const origin = new URL(value);
    return origin.protocol === "https:" &&
      (origin.origin === new URL(request.url).origin ||
        (process.env.SHIP_CHECK_ALLOWED_ORIGINS ?? "").split(",").map(x => x.trim()).includes(origin.origin));
  } catch { return false; }
}

async function handle(request: Request, context: Context): Promise<Response> {
  if (process.env.SHIP_CHECK_TECH_MONITORING_ENABLED !== "1") return error(503, "Technology monitoring is not enabled on this deployment.");
  const { id } = await context.params;
  if (!UUID.test(id)) return error(404, "Project not found.");
  const method = request.method;
  if (method !== "GET" && !allowedOrigin(request)) return error(403, "Origin not authorised.");
  try {
    const allowed = await cloudTechnologyRateLimit(request);
    if (!allowed.allowed) return error(429, "Too many requests.");
    const identity = await verifiedIdentity(request.headers.get("cookie"));
    if (!identity) return error(401, "Sign in required.");
    const principal = { schemaVersion: "0.1" as const, authSubjectHash: subjectHash(identity.id) };
    let project: Awaited<ReturnType<ReturnType<typeof cloudRuntime>["historyService"]["getProject"]>>;
    try {
      project = await cloudRuntime().historyService.getProject(principal, id);
    } catch { return error(404, "Project not found."); }

    const db = cloudDatabase();
    if (method === "GET") {
      return Response.json(await getTechnologyInventory(db, id, project.accountId), { headers: RESPONSE_HEADERS });
    }
    if (method === "DELETE") {
      await stopTechnologyMonitoring(db, id, project.accountId);
      return Response.json({ enabled: false }, { headers: RESPONSE_HEADERS });
    }
    if (method !== "PUT") return error(405, "Method not allowed.");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return error(415, "Expected JSON.");
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(length) || length > MAX_BYTES) return error(413, "Inventory too large.");
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return error(413, "Inventory too large.");
    let data: unknown;
    try { data = JSON.parse(raw); }
    catch { return error(400, "Invalid JSON."); }
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some(k => k !== "components")) {
      return error(400, "Expected components only.");
    }
    let components;
    try { components = parseComponents((data as {components?:unknown}).components); }
    catch (e) { return error(400, e instanceof Error ? e.message : "Invalid inventory."); }
    await saveTechnologyInventory(db, id, project.accountId, components);
    return Response.json(await getTechnologyInventory(db, id, project.accountId), { headers: RESPONSE_HEADERS });
  } catch (e) {
    // Never expose tokens, source evidence or SQL errors to clients.
    console.error("Technology monitoring route failed", e instanceof Error ? e.name : "unknown");
    return error(503, "Technology monitoring is temporarily unavailable.");
  }
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
