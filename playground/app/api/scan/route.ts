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
async function readBoundedJson(request: NextRequest): Promise<unknown> {
  if (!request.body) throw new Error("Enter a project to scan.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      throw new Error("Request too large.");
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
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
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object") throw new Error("Enter a project to scan.");
    const { url, kind } = body as { url?: unknown; kind?: unknown };
    source = parseSource(url, kind) as ParsedSource;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Invalid scan request.";
    return error(message === "Request too large." ? 413 : 400, message);
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
    // Diagnostics intentionally avoid messages, request targets, source and report
    // content, which can contain sensitive security evidence.
    const diagnostic = cause && typeof cause === "object"
      ? cause as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown }
      : {};
    console.error("[ship-check-playground] scan failed", {
      name: typeof diagnostic.name === "string" ? diagnostic.name.slice(0, 60) : "unknown",
      code: typeof diagnostic.code === "string" ? diagnostic.code.slice(0, 60) : undefined,
      status: typeof diagnostic.status === "number" ? diagnostic.status : undefined,
      statusCode: typeof diagnostic.statusCode === "number" ? diagnostic.statusCode : undefined
    });
    return error(503, "The scan could not be completed just now.");
  }
}
