import { cloudRuntime } from "../../lib/cloudRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: unknown };
type Args = { projectId?: unknown; limit?: unknown; cursor?: unknown };

function rpc(id: Rpc["id"], result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
function fail(id: Rpc["id"], code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, {
    status, headers: { "cache-control": "no-store" }
  });
}
const tools = [
  { name:"ship_check_list_projects", description:"List the account's connected projects and source-free metadata. This is not an inventory of all repositories.", inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:100},cursor:{type:"string"}},additionalProperties:false} },
  { name:"ship_check_get_project_status", description:"Get the latest available assurance counts and scan freshness for one account-owned project. Zero findings is not a safety guarantee.", inputSchema:{type:"object",properties:{projectId:{type:"string",format:"uuid"}},required:["projectId"],additionalProperties:false} },
  { name:"ship_check_get_project_history", description:"Get a bounded timeline and scan continuity for an account-owned project, newest first.", inputSchema:{type:"object",properties:{projectId:{type:"string",format:"uuid"}},required:["projectId"],additionalProperties:false} },
  { name:"ship_check_get_coverage", description:"Get assessed, partial and unassessed coverage totals from the latest scan.", inputSchema:{type:"object",properties:{projectId:{type:"string",format:"uuid"}},required:["projectId"],additionalProperties:false} },
  { name:"ship_check_get_attention_changes", description:"Summarise whether latest reported counts or coverage changed; not evidence that an issue was fixed.", inputSchema:{type:"object",properties:{projectId:{type:"string",format:"uuid"}},required:["projectId"],additionalProperties:false} }
] as const;

type DataReply = { ok: boolean; status: number; data: unknown };
async function read(request: Request, path: string): Promise<DataReply> {
  const url = new URL(path, request.url);
  const response = await cloudRuntime().handler(new Request(url, {
    method: "GET",
    headers: { authorization: request.headers.get("authorization") ?? "" }
  }));
  const data: unknown = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function details(value: unknown): { timeline: Record<string, unknown>; latestEvent: Record<string, unknown> } {
  const timeline = object(value);
  const events = Array.isArray(timeline.events) ? timeline.events : [];
  const last = object(events.at(-1));
  return { timeline, latestEvent: object(last.event) };
}
function parsedArgs(params: unknown): Args {
  const args = object(object(params).arguments);
  if (Object.keys(args).some(k => !["projectId", "limit", "cursor"].includes(k))) throw Error("Unsupported arguments.");
  return args;
}
async function invoke(request: Request, name: string, args: Args): Promise<unknown> {
  if (name === "ship_check_list_projects") {
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) throw Error("Invalid limit.");
    if (args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length > 512)) throw Error("Invalid cursor.");
    const params = new URLSearchParams();
    if (args.limit !== undefined) params.set("limit", String(args.limit));
    if (args.cursor) params.set("cursor", args.cursor);
    const result = await read(request, "/v1/projects" + (params.size ? "?" + params : ""));
    if (!result.ok) throw Error(`Project access failed (${result.status}).`);
    return result.data;
  }
  if (!UUID.test(String(args.projectId ?? ""))) throw Error("A valid projectId is required.");
  const id = String(args.projectId);
  const project = await read(request, "/v1/projects/" + id);
  if (!project.ok) throw Error(`Project not accessible (${project.status}).`);
  const history = await read(request, "/v1/projects/" + id + "/timeline");
  if (!history.ok) throw Error(`Project history not accessible (${history.status}).`);
  const { timeline, latestEvent } = details(history.data);
  const counts = object(latestEvent.counts);
  const scan = object(latestEvent.scan);
  if (name === "ship_check_get_project_status") {
    return { project: project.data, latestAt: timeline.latestAt ?? null, scan: {
      generatedAt: scan.generatedAt ?? null,
      engineVersion: scan.engineVersion ?? null,
      ruleset: scan.ruleset ?? null
    }, counts, latestAttention: timeline.latestAttention ?? null, evidenceBoundary: "source-free assurance-metadata only", warning:"No finding is not proof of a safe or complete assessment." };
  }
  if (name === "ship_check_get_project_history") {
    return {
      project: project.data, eventCount: timeline.eventCount ?? 0,
      firstAt: timeline.firstAt ?? null, latestAt: timeline.latestAt ?? null,
      events: (Array.isArray(timeline.events) ? timeline.events : []).slice(-20).reverse(),
      truncated: Number(timeline.eventCount ?? 0) > 20
    };
  }
  if (name === "ship_check_get_coverage") {
    return { projectId: id, latestAt: timeline.latestAt ?? null,
      coverage: timeline.latestAttention && object(timeline.latestAttention).coverage || null,
      sourceCoverage: latestEvent.coverage ?? null,
      warning: "Unassessed and partial areas are not verified controls." };
  }
  if (name === "ship_check_get_attention_changes") {
    const events = Array.isArray(timeline.events) ? timeline.events : [];
    const latest = object(events.at(-1));
    const previous = object(events.at(-2));
    const newer = object(object(latest.event).counts);
    const older = object(object(previous.event).counts);
    const delta: Record<string, number | null> = {};
    for(const key of ["findings","critical","high","unverified","checkErrors","notAssessed"]) {
      delta[key] = typeof newer[key] === "number" && typeof older[key] === "number"
        ? newer[key] - older[key] : null;
    }
    return {
      projectId:id, latestAt:timeline.latestAt ?? null, previousAt:object(object(previous.event).scan).generatedAt ?? null,
      delta, continuity: latest.continuity ?? null,
      warning: "Counts may change when rulesets, source snapshots or scan coverage change; disappearance does not prove remediation."
    };
  }
  throw Error("Unknown tool.");
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const canonical = "https://cloud-check.good-ship.co.uk";
  if (origin && origin !== canonical) return fail(null, -32000, "Origin not authorised.", 403);
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Bearer token required." }), {
      status:401,
      headers:{ "www-authenticate":'Bearer realm="ship-check-cloud", scope="history:read"', "content-type":"application/json", "cache-control":"no-store" }
    });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(null,-32600,"Request too large.",413);
  let rpcRequest: Rpc;
  try {
    if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return fail(null,-32600,"JSON required.",415);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return fail(null,-32600,"Request too large.",413);
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const data = object(body);
    if (data.jsonrpc !== "2.0" || typeof data.method !== "string") return fail(null,-32600,"Invalid JSON-RPC request.");
    rpcRequest = data as Rpc;
  } catch { return fail(null,-32700,"Invalid JSON."); }

  // Authentication is required even for initialization and tool discovery.
  const authorised = await read(request, "/v1/projects?limit=1").catch(()=>({ok:false,status:503,data:null}));
  if (!authorised.ok) {
    return fail(rpcRequest.id,-32001,authorised.status===401?"Invalid or expired token.": "Project access unavailable.",authorised.status===401?401:authorised.status===403?403:503);
  }

  if (rpcRequest.method === "notifications/initialized") return new Response(null,{status:202});
  if (rpcRequest.method === "initialize") {
    return rpc(rpcRequest.id,{
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ship-check-cloud", version: "0.0.0-alpha.12" },
      instructions: "Read-only, account-scoped metadata. Never infer that no findings means safe."
    });
  }
  if (rpcRequest.method === "ping") return rpc(rpcRequest.id,{});
  if (rpcRequest.method === "tools/list") return rpc(rpcRequest.id,{tools});
  if (rpcRequest.method === "tools/call") {
    const params = object(rpcRequest.params);
    const tool = typeof params.name === "string" ? params.name : "";
    if (!tools.some(t=>t.name===tool)) return fail(rpcRequest.id,-32602,"Unknown tool.");
    try {
      const result = await invoke(request, tool, parsedArgs(rpcRequest.params));
      return rpc(rpcRequest.id, { content:[{type:"text", text: JSON.stringify(result)}], isError:false });
    } catch (error) {
      return rpc(rpcRequest.id, {content:[{type:"text",text:error instanceof Error ? error.message : "Tool failed."}],isError:true});
    }
  }
  return fail(rpcRequest.id,-32601,"Method not found.");
}

export async function GET(): Promise<Response> {
  return new Response(null,{status:405,headers:{allow:"POST", "cache-control":"no-store"}});
}
export async function DELETE(): Promise<Response> {
  return new Response(null,{status:405,headers:{allow:"POST", "cache-control":"no-store"}});
}
