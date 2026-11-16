import {test} from "node:test";
import assert from "node:assert/strict";
import {extractTechnologyInventory} from "./technology-inventory.mjs";
const modelCheck="production.ai-model-lifecycle", cmsCheck="production.cms-component-inventory";
const base=() => ({
  project:{snapshot:{inventory:{fingerprint:{completeness:"complete"}}}},
  checks:[{checkId:modelCheck,status:"findings"},{checkId:cmsCheck,status:"unverified"}],
  observations:[],findings:[]
});
test("discovers model declarations in findings and observations without file paths",()=>{
  const r=base();
  r.observations=[{checkId:modelCheck,summary:"Found claude-sonnet-4-5-20250929 in source; no authoritative lifecycle status is bundled.",evidence:[{path:"src/private.ts",excerpt:"secret"}]}];
  r.findings=[{checkId:modelCheck,evidence:[{excerpt:"Declared model: gpt-5",path:"secret/path.ts"},{excerpt:"API_KEY=leak"}]}];
  const parsed=extractTechnologyInventory(r);
  assert.deepEqual(parsed.components.map(x=>x.id),["claude-sonnet-4-5-20250929","gpt-5"]);
  assert.ok(!JSON.stringify(parsed).includes("secret"));
});
test("discovers WordPress core, plugins and Drupal lock packages",()=>{
  const r=base();r.observations=[
    {checkId:cmsCheck,id:cmsCheck+":wordpress-core",summary:"WordPress core version declared as 6.8.1."},
    {checkId:cmsCheck,id:cmsCheck+":wordpress-plugins/akismet",summary:"Akismet declares version 5.0."},
    {checkId:cmsCheck,id:cmsCheck+":wordpress-themes/twentytwentyfive",summary:"Theme declares version 1.2."},
    {checkId:cmsCheck,id:cmsCheck+":drupal-drupal/token",summary:"drupal/token declares version 1.15.0."}
  ];
  const parsed=extractTechnologyInventory(r);
  assert.deepEqual(parsed.components.map(x=>x.kind).sort(),["drupal-package","wordpress-core","wordpress-plugin","wordpress-theme"]);
});
test("refuses incomplete checks and partial scans, preserves intentional zero components",()=>{
  const r=base();assert.deepEqual(extractTechnologyInventory(r).components,[]);
  r.checks[0].status="error";assert.throws(()=>extractTechnologyInventory(r),/did not complete/);
  r.checks[0].status="passed";r.project.snapshot.inventory.fingerprint.completeness="partial";
  assert.throws(()=>extractTechnologyInventory(r),/complete source/);
});
test("rejects unknown, untrusted observation text and never sends arbitrary properties",()=>{
  const r=base();
  r.observations=[{checkId:"other",summary:"Found gpt-5 in source;"},{checkId:modelCheck,summary:"Found my-custom-secret in source;"}];
  assert.deepEqual(extractTechnologyInventory(r).components,[]);
});
