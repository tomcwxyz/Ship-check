import { createCloudApiTokenStore } from "@ship-check/adapters";
import { cloudDatabase, cloudTechnologyRateLimit } from "../../../../../../lib/cloudRuntime";
import { parseComponents, syncDiscoveredTechnologyInventory } from "../../../../../../lib/technologyMonitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_BYTES = 12_000;
const headers = { "cache-control":"no-store","x-content-type-options":"nosniff" };
type Context = { params: Promise<{ id: string }> };
const failure = (status: number, message: string) =>
  Response.json({ error:message },{status,headers});

async function readBounded(request: Request): Promise<string> {
  const length=Number(request.headers.get("content-length")??0);
  if (!Number.isSafeInteger(length)||length>MAX_BYTES) throw new Error("payload-too-large");
  const reader=request.body?.getReader();
  if (!reader) throw new Error("missing-body");
  let total=0;
  const chunks:Uint8Array[]=[];
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>MAX_BYTES) throw new Error("payload-too-large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,total));
}

/**
 * Existing CI updates remain blocked until the project owner opts in. A direct
 * CLI/Desktop publish can explicitly opt in with monitor:true and a scoped
 * history:sync token. Never accept source, URLs or whole scan reports.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  if(process.env.SHIP_CHECK_TECH_MONITORING_ENABLED!=="1") return failure(503,"Monitoring disabled.");
  const {id}=await context.params;
  if(!UUID.test(id)) return failure(404,"Project not found.");
  if(!(request.headers.get("content-type")??"").toLowerCase().startsWith("application/json")) {
    return failure(415,"JSON required.");
  }
  const token=/^Bearer[ \t]+(shipcheck_[A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization")??"")?.[1];
  if(!token) return failure(401,"Bearer token required.");
  try {
    const rate=await cloudTechnologyRateLimit(request);
    if(!rate.allowed) return failure(429,"Rate limited.");
    const db=cloudDatabase();
    const authenticated=await createCloudApiTokenStore(db).authenticateToken(token);
    if(!authenticated?.scopes.includes("history:sync")) return failure(403,"Sync permission required.");
    const project=await db.query<{id:string}>(
      "SELECT id FROM ship_check_projects WHERE id=$1 AND account_id=$2",
      [id,authenticated.accountId]
    );
    if(project.rows.length!==1) return failure(404,"Project not found.");
    let payload:unknown;
    try { payload=JSON.parse(await readBounded(request)); }
    catch { return failure(400,"Invalid or oversized inventory."); }
    if(!payload||typeof payload!=="object"||Array.isArray(payload)) return failure(400,"Inventory object required.");
    const body=payload as Record<string,unknown>;
    if(Object.keys(body).some(k=>!["schemaVersion","components","monitor","siteHints","sourceInventory"].includes(k)) ||
       body.schemaVersion!=="ship-check-technology-inventory/0.1" ||
       !Array.isArray(body.components) ||
       (body.monitor!==undefined && body.monitor!==true) ||
       (body.sourceInventory!==undefined && body.sourceInventory!=="complete" && body.sourceInventory!=="not-assessed") ||
       (body.siteHints!==undefined && !Array.isArray(body.siteHints))) return failure(400,"Unsupported inventory contract.");
    const siteHints:Array<{cms:"wordpress"|"drupal";confidence:"likely"|"possible"}>=[];
    if(Array.isArray(body.siteHints)) {
      if(body.siteHints.length>2) return failure(400,"Too many site hints.");
      for(const item of body.siteHints) {
        if(!item||typeof item!=="object"||Array.isArray(item)) return failure(400,"Invalid CMS hint.");
        const hint=item as Record<string,unknown>;
        if(Object.keys(hint).some(k=>k!=="cms"&&k!=="confidence") ||
           !["wordpress","drupal"].includes(String(hint.cms)) ||
           !["likely","possible"].includes(String(hint.confidence)) ||
           siteHints.some(h=>h.cms===hint.cms)) return failure(400,"Invalid CMS hint.");
        siteHints.push(hint as {cms:"wordpress"|"drupal";confidence:"likely"|"possible"});
      }
    }
    let components;
    try { components=body.components.length ? parseComponents(body.components) : []; }
    catch { return failure(400,"Invalid component identifiers."); }
    const saved=await syncDiscoveredTechnologyInventory(db,id,authenticated.accountId,components,
      {optIn:body.monitor===true,siteHints,replaceComponents:body.sourceInventory!=="not-assessed"});
    if(!saved) return failure(409,"Enable automatic discovery in Cloud or explicitly opt in when publishing a scan.");
    return Response.json({synced:true,componentCount:components.length,monitoringEnabled:true},{headers});
  } catch (e) {
    console.error("Discovered inventory sync failed",e instanceof Error ? e.name : "unknown");
    return failure(503,"Discovery sync temporarily unavailable.");
  }
}
