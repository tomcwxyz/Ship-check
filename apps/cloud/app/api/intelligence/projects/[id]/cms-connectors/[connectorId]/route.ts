import { cloudDatabase,cloudRuntime,cloudTechnologyRateLimit } from "../../../../../../../lib/cloudRuntime";
import { verifiedIdentity,subjectHash } from "../../../../../../../lib/neonAuth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const headers={"cache-control":"no-store","x-content-type-options":"nosniff"};
export async function DELETE(request:Request,context:{params:Promise<{id:string;connectorId:string}>}) {
 const {id,connectorId}=await context.params;
 if(!UUID.test(id)||!UUID.test(connectorId)) return Response.json({error:"Not found"},{status:404,headers});
 if(request.headers.get("origin")!==new URL(request.url).origin) return Response.json({error:"Origin rejected"},{status:403,headers});
 if(!(await cloudTechnologyRateLimit(request)).allowed) return Response.json({error:"Rate limited"},{status:429,headers});
 const identity=await verifiedIdentity(request.headers.get("cookie"));
 if(!identity) return Response.json({error:"Sign in required"},{status:401,headers});
 const principal={schemaVersion:"0.1" as const,authSubjectHash:subjectHash(identity.id)};
 let project;
 try {project=await cloudRuntime().historyService.getProject(principal,id);}
 catch {return Response.json({error:"Not found"},{status:404,headers});}
 const db=cloudDatabase();
 await db.transaction(async tx=>{
  await tx.query(
   "UPDATE ship_check_cms_connectors SET revoked_at=now() WHERE id=$1 AND project_id=$2 AND account_id=$3",
   [connectorId,id,project.accountId]);
  await tx.query(
   "DELETE FROM ship_check_cms_components WHERE connector_id=$1 AND project_id=$2",
   [connectorId,id]);
  await tx.query(
   `DELETE FROM ship_check_technology_alerts a WHERE a.project_id=$1 AND NOT EXISTS (
      SELECT 1 FROM ship_check_cms_components c
       JOIN ship_check_cms_connectors s ON s.id=c.connector_id AND s.revoked_at IS NULL
       WHERE c.project_id=a.project_id AND c.kind=a.component_kind
         AND c.component_id=a.component_id
         AND COALESCE(c.version,'')=COALESCE(a.component_version,'')
      UNION ALL SELECT 1 FROM ship_check_technology_components m
       WHERE m.project_id=a.project_id AND m.kind=a.component_kind
         AND m.component_id=a.component_id
         AND COALESCE(m.version,'')=COALESCE(a.component_version,'')
      UNION ALL SELECT 1 FROM ship_check_discovered_components d
       WHERE d.project_id=a.project_id AND d.kind=a.component_kind
         AND d.component_id=a.component_id
         AND COALESCE(d.version,'')=COALESCE(a.component_version,'')
   )`,[id]);
 });
 return Response.json({revoked:true},{headers});
}
