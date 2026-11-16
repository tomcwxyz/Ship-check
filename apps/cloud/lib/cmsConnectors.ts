import { createHash, randomBytes } from "node:crypto";
import type { CloudHistoryDatabase } from "@ship-check/adapters";

export const cmsKinds = new Set(["wordpress-core","wordpress-plugin","wordpress-theme","drupal-package"]);
const idPattern = /^[A-Za-z0-9._/-]{1,160}$/;
const versionPattern = /^[A-Za-z0-9._+/-]{1,80}$/;
const tokenPattern = /^sc_(pair|site)_[a-f0-9]{64}$/;
export type CmsComponent = {kind:"wordpress-core"|"wordpress-plugin"|"wordpress-theme"|"drupal-package";id:string;version?:string;active:boolean};
export function hashToken(token:string) {return createHash("sha256").update(token).digest("hex");}
export function makeToken(type:"pair"|"site") {return "sc_"+type+"_"+randomBytes(32).toString("hex");}
export function parseCmsInventory(value:unknown,cms:"wordpress"|"drupal"):CmsComponent[] {
 if(!Array.isArray(value)||value.length>500) throw new Error("Invalid inventory size.");
 const seen=new Set<string>();
 return value.map(entry=>{
  if(!entry||typeof entry!=="object"||Array.isArray(entry)) throw new Error("Invalid component.");
  const e=entry as Record<string,unknown>;
  if(Object.keys(e).some(k=>!["kind","id","version","active"].includes(k))) throw new Error("Unexpected component field.");
  if(typeof e.kind!=="string"||!cmsKinds.has(e.kind)||typeof e.id!=="string"||!idPattern.test(e.id)||
     typeof e.active!=="boolean"||(e.version!==undefined&&(typeof e.version!=="string"||!versionPattern.test(e.version)))) throw new Error("Invalid component.");
  if(cms==="wordpress"&&!e.kind.startsWith("wordpress-")||cms==="drupal"&&e.kind!=="drupal-package") throw new Error("CMS mismatch.");
  const key=e.kind+":"+e.id;
  if(seen.has(key)) throw new Error("Duplicate component.");
  seen.add(key);
  return {kind:e.kind as CmsComponent["kind"],id:e.id,active:e.active,...(e.version?{version:e.version as string}:{})};
 });
}
export function bearer(request:Request,type:"pair"|"site"):string|null {
 const auth=request.headers.get("authorization")??"";
 const token=/^Bearer (sc_(?:pair|site)_[a-f0-9]{64})$/.exec(auth)?.[1];
 return token&&tokenPattern.test(token)&&token.startsWith("sc_"+type+"_")?token:null;
}
export async function createPairing(db:CloudHistoryDatabase,projectId:string,accountId:string) {
 const token=makeToken("pair");
 await db.query(
  `INSERT INTO ship_check_cms_pairings(project_id,account_id,token_hash,expires_at)
   VALUES ($1,$2,$3,now()+interval '10 minutes')`,
  [projectId,accountId,hashToken(token)]
 );
 return {pairingCode:token,expiresInSeconds:600};
}
export async function claimPairing(db:CloudHistoryDatabase,token:string,cms:"wordpress"|"drupal") {
 const connectorToken=makeToken("site");
 const outcome=await db.transaction(async tx=>{
  const pairing=await tx.query<{id:string;project_id:string;account_id:string}>(
   `SELECT id,project_id,account_id FROM ship_check_cms_pairings
     WHERE token_hash=$1 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE`,[hashToken(token)]);
  const row=pairing.rows[0];if(!row) return false;
  await tx.query("UPDATE ship_check_cms_pairings SET consumed_at=now() WHERE id=$1",[row.id]);
  await tx.query(
   `INSERT INTO ship_check_cms_connectors(project_id,account_id,cms,token_hash)
    VALUES($1,$2,$3,$4)`,[row.project_id,row.account_id,cms,hashToken(connectorToken)]);
  return true;
 });
 return outcome?{connectorToken}:null;
}
export async function saveCmsInventory(db:CloudHistoryDatabase,token:string,components:CmsComponent[]) {
 return db.transaction(async tx=>{
  const found=await tx.query<{id:string;project_id:string;cms:"wordpress"|"drupal"}>(
   `SELECT id,project_id,cms FROM ship_check_cms_connectors
     WHERE token_hash=$1 AND revoked_at IS NULL FOR UPDATE`,[hashToken(token)]);
  const connector=found.rows[0];if(!connector) return false;
  if(components.some(c=>connector.cms==="wordpress"?!c.kind.startsWith("wordpress-"):c.kind!=="drupal-package")) return false;
  await tx.query("DELETE FROM ship_check_cms_components WHERE connector_id=$1",[connector.id]);
  for(const c of components) {
   await tx.query(
    `INSERT INTO ship_check_cms_components(connector_id,project_id,kind,component_id,version,active)
     VALUES($1,$2,$3,$4,$5,$6)`,[connector.id,connector.project_id,c.kind,c.id,c.version??null,c.active]);
  }
  await tx.query("UPDATE ship_check_cms_connectors SET last_seen_at=now() WHERE id=$1",[connector.id]);
  return true;
 });
}
