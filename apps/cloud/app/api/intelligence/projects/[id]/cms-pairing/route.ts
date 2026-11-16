import { cloudDatabase, cloudRuntime, cloudTechnologyRateLimit } from "../../../../../../lib/cloudRuntime";
import { verifiedIdentity, subjectHash } from "../../../../../../lib/neonAuth";
import { createPairing } from "../../../../../../lib/cmsConnectors";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const headers={"cache-control":"no-store","x-content-type-options":"nosniff"};
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params;
 if(!UUID.test(id)) return Response.json({error:"Not found"},{status:404,headers});
 const origin=request.headers.get("origin");
 if(!origin||origin!==new URL(request.url).origin) return Response.json({error:"Invalid origin"},{status:403,headers});
 if(!(await cloudTechnologyRateLimit(request)).allowed) return Response.json({error:"Rate limited"},{status:429,headers});
 const identity=await verifiedIdentity(request.headers.get("cookie"));
 if(!identity) return Response.json({error:"Sign in required"},{status:401,headers});
 const principal={schemaVersion:"0.1" as const,authSubjectHash:subjectHash(identity.id)};
 let project;
 try{project=await cloudRuntime().historyService.getProject(principal,id);}
 catch{return Response.json({error:"Not found"},{status:404,headers});}
 return Response.json(await createPairing(cloudDatabase(),id,project.accountId),{headers});
}
