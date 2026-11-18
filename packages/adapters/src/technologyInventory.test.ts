import {describe,expect,it} from "vitest";
import type {ScanReport} from "@ship-check/schemas";
import {extractTechnologyInventory} from "./technologyInventory.js";

const model="production.ai-model-lifecycle";
const cms="production.cms-component-inventory";
const runtime="runtime.cms-fingerprint";
const synthetic=(partial:Partial<ScanReport>)=>({
  tool:{name:"ship-check",version:"0.0.0-test"},
  project:{snapshot:{inventory:{fingerprint:{completeness:"complete"}}}},
  checks:[{checkId:model,status:"passed"},{checkId:cms,status:"passed"}],
  observations:[],findings:[],
  ...partial
} as unknown as ScanReport);

describe("shared source-free technology discovery",()=>{
  it("extracts AI models, WordPress and Drupal identifiers without any paths",()=>{
    const report=synthetic({
      observations:[
        {checkId:model,summary:"Found claude-sonnet-4-5-20250929 in source; no authoritative status.",id:"model",evidence:[{path:"private/secrets.ts",detail:"secret"}]},
        {checkId:cms,id:cms+":wordpress-core",summary:"WordPress core version declared as 6.8.1.",evidence:[]},
        {checkId:cms,id:cms+":wordpress-plugins/akismet",summary:"Akismet declares version 5.0.",evidence:[]},
        {checkId:cms,id:cms+":drupal-drupal/token",summary:"drupal/token declares version 1.15.0.",evidence:[]}
      ] as ScanReport["observations"],
      findings:[{checkId:model,evidence:[{excerpt:"Declared model: gpt-5",path:"src/private.ts",detail:"secret"}]}] as ScanReport["findings"]
    });
    const inventory=extractTechnologyInventory(report);
    expect(inventory.components.map(c=>c.id)).toEqual(["claude-sonnet-4-5-20250929","gpt-5","drupal/token","wordpress","akismet"].sort((a,b)=> {
      const kinds=new Map(inventory.components.map(c=>[c.id,c.kind]));
      return (kinds.get(a)+":"+a).localeCompare(kinds.get(b)+":"+b);
    }));
    expect(inventory.components.find(x=>x.id==="akismet")?.version).toBe("5.0");
    expect(inventory.sourceInventory).toBe("complete");
    expect(JSON.stringify(inventory)).not.toMatch(/private|secrets|src\//);
  });
  it("preserves source data on URL-only runtime scans and emits unverified CMS hints",()=>{
    const report=synthetic({
      project:{snapshot:{inventory:{}}} as unknown as ScanReport["project"],
      checks:[{checkId:model,status:"not-assessed"},{checkId:cms,status:"not-assessed"},{checkId:runtime,status:"passed"}] as ScanReport["checks"],
      observations:[{checkId:runtime,id:runtime+":wordpress",summary:"Likely WordPress from public website signals; not verified.",evidence:[]}] as ScanReport["observations"]
    });
    const inventory=extractTechnologyInventory(report);
    expect(inventory).toMatchObject({sourceInventory:"not-assessed",components:[],siteHints:[{cms:"wordpress",confidence:"likely"}]});
  });
  it("refuses partial or broken source inventories",()=>{
    const report=synthetic({
      project:{snapshot:{inventory:{fingerprint:{completeness:"partial"}}}} as unknown as ScanReport["project"],
    });
    expect(()=>extractTechnologyInventory(report)).toThrow(/complete source inventory/);
    const errored=synthetic({checks:[{checkId:model,status:"error"},{checkId:cms,status:"passed"}] as ScanReport["checks"]});
    expect(()=>extractTechnologyInventory(errored)).toThrow(/did not complete/);
  });
  it("rejects arbitrary observation text, unsafe IDs and over-limit inventories",()=>{
    const report=synthetic({observations:[{checkId:model,id:"untrusted",summary:"Found my-secret-token in source;",evidence:[]}] as ScanReport["observations"]});
    expect(extractTechnologyInventory(report).components).toEqual([]);
    report.observations=Array.from({length:51},(_,n)=>({checkId:model,id:"id-"+n,summary:"Found gpt-"+n+" in source;",evidence:[]})) as ScanReport["observations"];
    expect(()=>extractTechnologyInventory(report)).toThrow(/50/);
  });
});
