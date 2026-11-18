import { ProjectHistoryMetadataSchema } from "@ship-check/schemas";
import { cloudDatabase, cloudRuntime, cloudTechnologyRateLimit } from "../../../../lib/cloudRuntime";
import { verifiedIdentity, subjectHash } from "../../../../lib/neonAuth";
import { parseComponents, syncDiscoveredTechnologyInventory } from "../../../../lib/technologyMonitoring";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_BYTES=18_000;
const headers={"cache-control":"no-store","x-content-type-options":"nosniff"};
const fail=(status:number,message:string)=>Response.json({error:message},{status,headers});

async function boundedJson(request:Request):Promise<unknown> {
  if(!(request.headers.get("content-type")??"").toLowerCase().startsWith("application/json")) throw new Error("json-required");
  const length=Number(request.headers.get("content-length")??0);
  if(!Number.isSafeInteger(length)||length>MAX_BYTES) throw new Error("too-large");
  if(!request.body) throw new Error("no-body");
  const reader=request.body.getReader();
  const parts:Uint8Array[]=[]; let bytes=0;
  try {
    while(true){
      const {value,done}=await reader.read();
      if(done) break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES) throw new Error("too-large");
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts,bytes)));
}
function parseHints(value:unknown) {
  if(value===undefined) return [];
  if(!Array.isArray(value)||value.length>2) throw new Error("invalid-hints");
  const seen=new Set<string>();
  return value.map(item=>{
    if(!item||typeof item!=="object"||Array.isArray(item)) throw new Error("invalid-hints");
    const hint=item as Record<string,unknown>;
    if(Object.keys(hint).some(k=>k!=="cms"&&k!=="confidence")||
       !["wordpress","drupal"].includes(String(hint.cms))||
       !["likely","possible"].includes(String(hint.confidence))||
       seen.has(String(hint.cms))) throw new Error("invalid-hints");
    seen.add(String(hint.cms));
    return {cms:hint.cms as "wordpress"|"drupal",confidence:hint.confidence as "likely"|"possible"};
  });
}

/** Explicit, signed-in continuation from the public Playground. The browser
 * posts only the canonical source-free handoff. It never posts report findings,
 * source paths, source files, repository URLs, cookies or secrets.
 */
export async function POST(request:Request):Promise<Response> {
  if(process.env.SHIP_CHECK_TECH_MONITORING_ENABLED!=="1") return fail(503,"Monitoring is temporarily unavailable.");
  if(request.headers.get("origin")!==new URL(request.url).origin) return fail(403,"Origin not authorised.");
  try {
    const rate=await cloudTechnologyRateLimit(request);
    if(!rate.allowed) return fail(429,"Too many requests.");
    const identity=await verifiedIdentity(request.headers.get("cookie"));
    if(!identity) return fail(401,"Sign in to continue.");
    let payload:unknown;
    try{payload=await boundedJson(request);}
    catch{return fail(400,"Invalid or oversized scan handoff.");}
    if(!payload||typeof payload!=="object"||Array.isArray(payload)) return fail(400,"Invalid scan handoff.");
    const body=payload as Record<string,unknown>;
    if(Object.keys(body).some(k=>k!=="handoff"&&k!=="displayName")||
       !body.handoff||typeof body.handoff!=="object"||Array.isArray(body.handoff)||
       (body.displayName!==undefined && (typeof body.displayName!=="string"||body.displayName.trim().length<1||body.displayName.length>120)))
      return fail(400,"Unsupported handoff.");
    const handoff=body.handoff as Record<string,unknown>;
    if(Object.keys(handoff).some(k=>!["schemaVersion","metadata","inventory"].includes(k))||
       handoff.schemaVersion!=="ship-check-monitoring-handoff/0.1"||
       !handoff.inventory||typeof handoff.inventory!=="object"||Array.isArray(handoff.inventory))
      return fail(400,"Unsupported handoff.");
    const inv=handoff.inventory as Record<string,unknown>;
    if(Object.keys(inv).some(k=>!["schemaVersion","components","siteHints","sourceInventory"].includes(k))||
       inv.schemaVersion!=="ship-check-technology-inventory/0.1"||
       !Array.isArray(inv.components)||
       !["complete","not-assessed"].includes(String(inv.sourceInventory)))
      return fail(400,"Invalid technology inventory.");
    let metadata:ReturnType<typeof ProjectHistoryMetadataSchema.parse>;
    let components:ReturnType<typeof parseComponents>;
    let hints:ReturnType<typeof parseHints>;
    try {
      metadata=ProjectHistoryMetadataSchema.parse(handoff.metadata);
      components=inv.components.length?parseComponents(inv.components):[];
      hints=parseHints(inv.siteHints);
      if(inv.sourceInventory==="not-assessed"&&components.length) throw new Error("no source evidence");
      if(inv.sourceInventory==="complete"&&!metadata.project.evidenceSources.some(x=>x.capabilities.includes("source-files")))
        throw new Error("no source evidence");
    } catch { return fail(400,"The scan inventory could not be verified."); }

    const principal={schemaVersion:"0.1" as const,authSubjectHash:subjectHash(identity.id)};
    const result=await cloudRuntime().historyService.connectProject(principal,{
      schemaVersion:"0.1",event:metadata,retention:"90-days",
      ...(body.displayName?{displayName:(body.displayName as string).trim()}:{})
    });
    const synced=await syncDiscoveredTechnologyInventory(
      cloudDatabase(),result.project.id,result.project.accountId,components,
      {optIn:true,replaceComponents:inv.sourceInventory==="complete",siteHints:hints}
    );
    if(!synced) return fail(409,"Unable to enable monitoring for this project.");
    return Response.json({projectId:result.project.id,monitoringEnabled:true,componentCount:components.length,
      siteHintCount:hints.length},{headers});
  } catch(e) {
    // History may have saved on failure. The operation is idempotent on retry.
    console.error("Browser scan handoff failed",e instanceof Error?e.name:"unknown");
    return fail(503,"Could not complete Cloud monitoring. Please retry.");
  }
}
