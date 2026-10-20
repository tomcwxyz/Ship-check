import { NextRequest, NextResponse } from "next/server";
import { parseSource } from "../../../lib/validation.mjs";
import { claimAnonymousScan, LimitsUnavailable, RateLimited } from "../../../lib/limits";
import { scanInSandbox } from "../../../lib/scanner";
import type { ParsedSource } from "../../../lib/sourceTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers });
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return error(403, "This request must come from the playground.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return error(415, "Send a JSON request.");
  if (Number(request.headers.get("content-length") || 0) > 1024)
    return error(413, "Request too large.");
  let source: ParsedSource;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1024) return error(413, "Request too large.");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object") throw new Error("Enter a project to scan.");
    const { url, kind } = body as { url?: unknown; kind?: unknown };
    source = parseSource(url, kind) as ParsedSource;
  } catch (cause) {
    return error(400, cause instanceof Error ? cause.message : "Invalid scan request.");
  }
  try {
    await claimAnonymousScan(request);
    const report = await scanInSandbox(source);
    return NextResponse.json({ report }, { headers });
  } catch (cause) {
    if (cause instanceof RateLimited) return error(429, cause.message);
    if (cause instanceof LimitsUnavailable) return error(503, "Scans are temporarily unavailable; please try again later.");
    if (cause instanceof Error && /repository|report|scan|GitHub|pinned/i.test(cause.message))
      return error(422, cause.message);
    return error(503, "The scan could not be completed just now.");
  }
}
