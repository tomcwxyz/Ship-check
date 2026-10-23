import { cloudRuntime } from "../../../lib/cloudRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The published Alpha 12 CLI and GitHub Action use /v1/* directly, while
// the Cloud dashboard uses /api/v1/*. Both must reach the same authenticated
// handlers so existing immutable npm releases can sync and read history.
function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/v1/")) {
    return Promise.resolve(Response.json({ error: "Unknown Cloud API route." }, { status: 404 }));
  }
  return cloudRuntime().handler(request);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
