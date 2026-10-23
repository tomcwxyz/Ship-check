import { cloudRuntime } from "../../../lib/cloudRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  // Next mounts this route under /api; the existing Cloud contract routes are
  // /v1/*. Preserve the query string, method, headers and bounded body.
  const { path } = await context.params;
  if (path[0] !== "v1" || path.length > 6 || path.some(x => !/^[A-Za-z0-9_-]+$/.test(x))) {
    return Response.json({ error: "Unknown Cloud API route." }, { status: 404 });
  }
  const url = new URL(request.url);
  url.pathname = "/" + path.join("/");
  const forwarded = new Request(url, request);
  return cloudRuntime().handler(forwarded);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
