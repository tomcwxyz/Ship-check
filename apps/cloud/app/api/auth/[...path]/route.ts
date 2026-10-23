import { proxyNeonAuth } from "../../../../lib/neonAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handler(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return proxyNeonAuth(request, path);
}

export const GET = handler;
export const POST = handler;
