import { cloudDatabase, cloudTechnologyRateLimit } from "../../../../lib/cloudRuntime";
import { bearer, parseCmsInventory, saveCmsInventory } from "../../../../lib/cmsConnectors";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"cache-control":"no-store","x-content-type-options":"nosniff"};
export async function PUT(request:Request) {
 if(!(await cloudTechnologyRateLimit(request)).allowed) return Response.json({error:"Rate limited"},{status:429,headers});
 if((request.headers.get("content-type")??"").split(";")[0]!=="application/json") return Response.json({error:"JSON required"},{status:415,headers});
 const token=bearer(request,"site");
 if(!token) return Response.json({error:"Invalid connector token"},{status:401,headers});
 let body:unknown;
 try {
  if(Number(request.headers.get("content-length")??0)>64000) throw Error();
  const raw=await request.text();if(raw.length>64000) throw Error();
  body=JSON.parse(raw);
 }catch{return Response.json({error:"Invalid or oversized inventory"},{status:400,headers});}
 if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).sort().join(",")!=="cms,components") return Response.json({error:"Invalid contract"},{status:400,headers});
 const b=body as {cms:unknown;components:unknown};
 if(b.cms!=="wordpress"&&b.cms!=="drupal") return Response.json({error:"Invalid CMS"},{status:400,headers});
 let components;
 try {components=parseCmsInventory(b.components,b.cms);}
 catch{return Response.json({error:"Invalid components"},{status:400,headers});}
 const ok=await saveCmsInventory(cloudDatabase(),token,components);
 if(!ok) return Response.json({error:"Connector not authorised"},{status:403,headers});
 return Response.json({synced:true,components:components.length},{headers});
}
