import { afterEach, describe, expect, it, vi } from "vitest";
const { handler, dbQuery, getTechnologyInventory } = vi.hoisted(() => ({ handler: vi.fn(), dbQuery: vi.fn(), getTechnologyInventory: vi.fn() }));
vi.mock("../../lib/cloudRuntime",()=>({cloudRuntime:()=>({handler}),cloudDatabase:()=>({query:dbQuery})}));
vi.mock("../../lib/technologyMonitoring",()=>({getTechnologyInventory}));
import { POST } from "./route";

afterEach(()=>{ vi.resetAllMocks(); });
const ID="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACCOUNT="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function projectAccess(){handler.mockImplementation((request:Request)=>{
  const pathname=new URL(request.url).pathname;
  if(pathname==="/v1/projects")return Promise.resolve(Response.json({projects:[]}));
  if(pathname==="/v1/projects/"+ID)return Promise.resolve(Response.json({id:ID,accountId:ACCOUNT}));
  return Promise.resolve(Response.json({error:"not found"},{status:404}));
});}


function request(method:string, params?:unknown, token="shipcheck_fake"):Request {
  return new Request("https://cloud-check.good-ship.co.uk/mcp",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method,...(params===undefined?{}:{params})})
  });
}

describe("Cloud MCP bearer-only boundary",()=>{
  it("never exposes tools without a bearer credential",async()=>{
    const result=await POST(new Request("https://cloud-check.good-ship.co.uk/mcp",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})
    }));
    expect(result.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects invalid or expired tokens",async()=>{
    handler.mockResolvedValue(Response.json({message:"Unauthenticated"},{status:401}));
    const result=await POST(request("tools/list"));
    expect(result.status).toBe(401);
  });

  it("offers only bounded read-only MCP tools with account-owned bearer access",async()=>{
    handler.mockResolvedValue(Response.json({schemaVersion:"0.1",projects:[]}));
    const result=await POST(request("tools/list"));
    expect(result.status).toBe(200);
    const body=await result.json() as {result:{tools:Array<{name:string}>}};
    expect(body.result.tools).toHaveLength(8);
    expect(body.result.tools.map(t=>t.name)).not.toContain("ship_check_delete_project");
    expect(handler).toHaveBeenCalled();
  });

  it("does not return another account's project even if its UUID is known",async()=>{
    handler.mockImplementation((r:Request)=>new URL(r.url).pathname.endsWith("/timeline")
      ? Promise.resolve(Response.json({message:"not-found"},{status:404}))
      : new URL(r.url).pathname === "/v1/projects"
      ? Promise.resolve(Response.json({projects:[]}))
      : Promise.resolve(Response.json({message:"not-found"},{status:404})));
    const result=await POST(request("tools/call",{name:"ship_check_get_project_status",arguments:{projectId:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}}));
    const body=await result.json() as {result:{isError:boolean;content:Array<{text:string}>}};
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toMatch(/not accessible/);
  });
});

describe("Cloud MCP monitoring and scanner version",()=>{
  it("uses root release version instead of a stale hard-coded MCP version",async()=>{
    handler.mockResolvedValue(Response.json({projects:[]}));
    const init=await POST(request("initialize"));
    const parsed=await init.json() as {result:{serverInfo:{version:string}}};
    expect(parsed.result.serverInfo.version).toBe("0.0.0-alpha.14");
    const status=await POST(request("tools/call",{name:"ship_check_get_mcp_version",arguments:{}}));
    const value=await status.json() as {result:{content:Array<{text:string}>}};
    expect(JSON.parse(value.result.content[0]!.text).serverVersion).toBe("0.0.0-alpha.14");
  });
  it("requires server-confirmed project ownership before reading technology data",async()=>{
    handler.mockImplementation((request:Request)=>new URL(request.url).pathname==="/v1/projects"
      ? Promise.resolve(Response.json({projects:[]}))
      : Promise.resolve(Response.json({error:"missing"},{status:404})));
    const response=await POST(request("tools/call",{name:"ship_check_get_monitored_technologies",arguments:{projectId:ID}}));
    const data=await response.json() as {result:{isError:boolean}};
    expect(data.result.isError).toBe(true);
    expect(getTechnologyInventory).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });
  it("does not accept an account identifier supplied by the caller",async()=>{
    projectAccess();
    getTechnologyInventory.mockResolvedValue({
      enabled:true,autoDiscovery:true,components:[],discoveredComponents:[
        {kind:"ai-model",id:"gpt-5",evidence:"source-declared"}
      ],siteHints:[{cms:"wordpress",confidence:"possible",lastSeenAt:"2026-11-18T12:00:00Z"}],
      cmsConnectors:[{id:"private-connector-id",cms:"wordpress",components:1,lastSeenAt:"2026-11-18T12:00:00Z"}],
      alerts:[],feeds:[]
    });
    dbQuery.mockResolvedValue({rows:[{kind:"wordpress-plugin",component_id:"akismet",version:"5.0",
      active:true,observed_at:"2026-11-18T12:00:00Z",cms:"wordpress"}]});
    const result=await POST(request("tools/call",{name:"ship_check_get_monitored_technologies",
      arguments:{projectId:ID}}));
    const body=await result.json() as {result:{isError:boolean;content:Array<{text:string}>}};
    expect(body.result.isError).toBe(false);
    expect(getTechnologyInventory).toHaveBeenCalledWith(expect.anything(),ID,ACCOUNT);
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining("s.account_id=$2"),[ID,ACCOUNT]);
    const response=JSON.parse(body.result.content[0]!.text);
    expect(response.sourceDeclared[0].id).toBe("gpt-5");
    expect(response.installed[0]).toMatchObject({id:"akismet",version:"5.0",evidence:"connector-reported"});
    expect(JSON.stringify(response)).not.toContain("private-connector-id");
  });
  it("bounds notice lists and displays failed intelligence feeds",async()=>{
    projectAccess();
    getTechnologyInventory.mockResolvedValue({
      enabled:true,autoDiscovery:true,components:[],discoveredComponents:[],siteHints:[],
      cmsConnectors:[],
      alerts:[{provider:"openai",componentId:"gpt-5",status:"retiring",scope:"model",
        summary:"Model retirement notice",sourceUrl:"https://platform.openai.com/docs",
        effectiveDate:"2027-01-01",lastSeenAt:"2026-11-18T12:00:00Z"}],
      feeds:[{provider:"drupal",checkedAt:"2026-11-18T12:00:00Z",successAt:null,errorCode:"feed-incomplete"}]
    });
    const result=await POST(request("tools/call",{name:"ship_check_list_technology_notices",
      arguments:{projectId:ID,limit:1}}));
    const body=await result.json() as {result:{isError:boolean;content:Array<{text:string}>}};
    expect(body.result.isError).toBe(false);
    const data=JSON.parse(body.result.content[0]!.text);
    expect(data.notices).toHaveLength(1);
    expect(data.providerHealth[0].errorCode).toBe("feed-incomplete");
    const bad=await POST(request("tools/call",{name:"ship_check_list_technology_notices",
      arguments:{projectId:ID,limit:300}}));
    const invalid=await bad.json() as {result:{isError:boolean}};
    expect(invalid.result.isError).toBe(true);
  });
});
