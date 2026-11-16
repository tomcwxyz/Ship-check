import { describe,it,expect } from "vitest";
import { parseCmsInventory,makeToken,bearer,hashToken } from "./cmsConnectors";
describe("CMS connector inventory validation",()=>{
 it("accepts WordPress core and installed plugins without secrets",()=>{
  expect(parseCmsInventory([{kind:"wordpress-core",id:"wordpress",version:"6.8",active:true},
   {kind:"wordpress-plugin",id:"contact-form-7",version:"6.0",active:false}],"wordpress")).toHaveLength(2);
 });
 it("rejects mixed CMS, duplicates, extraneous data and missing active status",()=>{
  for(const components of [
   [{kind:"drupal-package",id:"drupal/token",active:true}],
   [{kind:"wordpress-plugin",id:"foo",active:true},{kind:"wordpress-plugin",id:"foo",active:false}],
   [{kind:"wordpress-plugin",id:"foo",active:true,secret:"password"}],
   [{kind:"wordpress-plugin",id:"foo"}]
  ]) expect(()=>parseCmsInventory(components,"wordpress")).toThrow();
 });
 it("only accepts exact scoped bearer tokens",()=>{
  const token=makeToken("site");
  expect(bearer(new Request("https://example.com",{headers:{authorization:"Bearer "+token}}),"site")).toBe(token);
  expect(bearer(new Request("https://example.com",{headers:{authorization:"Bearer "+token}}),"pair")).toBeNull();
  expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
 });
});
