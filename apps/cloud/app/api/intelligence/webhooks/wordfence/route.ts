import { cloudDatabase } from "../../../../../lib/cloudRuntime";
import {
  applyWordfenceChange, parseWordfenceChange, verifyWordfenceSignature
} from "../../../../../lib/cmsWordfence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 256_000;
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const error = (status: number) => Response.json({ error: "Webhook unavailable or unauthorised." }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SHIP_CHECK_WORDFENCE_WEBHOOK_SECRET ?? "";
  if (process.env.SHIP_CHECK_TECH_MONITORING_ENABLED !== "1" || secret.length < 32) {
    return error(503);
  }
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) return error(415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > MAX_BYTES) return error(413);
  let body: string;
  try {
    body = await request.text();
  } catch { return error(413); }
  if (Buffer.byteLength(body,"utf8") > MAX_BYTES) return error(413);
  const signature = request.headers.get("x-wordfence-signature");
  if (!verifyWordfenceSignature(body,signature,secret)) return error(401);
  try {
    const data: unknown = JSON.parse(body);
    const change = parseWordfenceChange(data,new Date().toISOString());
    await applyWordfenceChange(cloudDatabase(),change);
    return Response.json({
      accepted: true, upserts: change.upserts.length, deleted: change.deletions.length
    },{ headers });
  } catch (e) {
    console.error("Wordfence update rejected", e instanceof Error ? e.name : "unknown");
    return error(400);
  }
}
