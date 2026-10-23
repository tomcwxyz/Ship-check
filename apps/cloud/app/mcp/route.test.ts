import { afterEach, describe, expect, it, vi } from "vitest";
const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("../../lib/cloudRuntime",()=>({cloudRuntime:()=>({handler})}));
import { POST } from "./route";

afterEach(()=>{ vi.resetAllMocks(); });

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
    expect(body.result.tools).toHaveLength(5);
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
