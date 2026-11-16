import { cloudDatabase, cloudTechnologyRateLimit } from "../../../../lib/cloudRuntime";
import { bearer, claimPairing } from "../../../../lib/cmsConnectors";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"cache-control":"no-store","x-content-type-options":"nosniff"};
export async function POST(request:Request) {
 if(!(await cloudTechnologyRateLimit(request)).allowed) return Response.json({error:"Rate limited"},{status:429,headers});
 if((request.headers.get("content-type")??"").split(";")[0]!=="application/json") return Response.json({error:"JSON required"},{status:415,headers});
 const token=bearer(request,"pair");
 if(!token) return Response.json({error:"Invalid pairing code"},{status:401,headers});
 let input:unknown;
 try {
  if(Number(request.headers.get("content-length")??0)>128) throw Error();
  const raw=await request.text();if(raw.length>128) throw Error();input=JSON.parse(raw);
 }catch{return Response.json({error:"Invalid request"},{status:400,headers});}
 if(!input||typeof input!=="object"||Array.isArray(input)||
   Object.keys(input).length!==1||!["wordpress","drupal"].includes((input as {cms?:string}).cms??"")) return Response.json({error:"Invalid CMS"},{status:400,headers});
 const paired=await claimPairing(cloudDatabase(),token,(input as {cms:"wordpress"|"drupal"}).cms);
 if(!paired) return Response.json({error:"Pairing expired or already used"},{status:409,headers});
 return Response.json(paired,{headers});
}
