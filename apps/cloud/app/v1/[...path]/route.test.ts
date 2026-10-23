import { afterEach, describe, expect, it, vi } from "vitest";

const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("../../../lib/cloudRuntime", () => ({
  cloudRuntime: () => ({ handler })
}));

import { GET, POST } from "./route";

afterEach(() => { vi.resetAllMocks(); });

describe("Published Alpha 12 CLI Cloud API compatibility", () => {
  it("passes CLI /v1/projects directly to the authenticated Cloud service", async () => {
    handler.mockResolvedValue(Response.json({schemaVersion:"0.1",projects:[]}));
    const request = new Request("https://cloud-check.good-ship.co.uk/v1/projects?limit=50", {
      headers: { authorization: "Bearer test-token" }
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request);
    expect(new URL(handler.mock.calls[0]?.[0].url).pathname).toBe("/v1/projects");
  });
  it("passes project connect without tampering with body or auth", async () => {
    handler.mockResolvedValue(Response.json({ok:true}));
    const request = new Request("https://cloud-check.good-ship.co.uk/v1/projects/connect", {
      method:"POST",
      headers:{authorization:"Bearer test-token","content-type":"application/json"},
      body:JSON.stringify({schemaVersion:"0.1"})
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request);
    expect((await handler.mock.calls[0]?.[0].text())).toContain("schemaVersion");
  });
});
