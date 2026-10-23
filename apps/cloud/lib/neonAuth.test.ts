import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateNeonSession, proxyNeonAuth, subjectHash, verifiedIdentity } from "./neonAuth";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Neon Auth session security", () => {
  it("rejects missing cookies and unsigned browser account claims", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await verifiedIdentity(null)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not recognise a user without a valid upstream session", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://neon.example/auth");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: { id:"spoofed",email:"fake@example.com" } })));
    expect(await verifiedIdentity("better-auth.session_token=notreal")).toBeNull();
  });

  it("derives an opaque principal only from the verified Neon session", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://neon.example/auth");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      user:{id:"user-a",email:"user@example.com",name:"User A"},
      session:{id:"session-a"}
    })));
    const auth = await authenticateNeonSession(new Request("https://cloud-check.good-ship.co.uk/v1/projects",{
      headers:{cookie:"better-auth.session_token=example"}
    }));
    expect(auth).toMatchObject({principal:{authSubjectHash:subjectHash("user-a")}, mutationAuthorised:true});
    expect(subjectHash("user-a")).not.toEqual(subjectHash("user-b"));
  });

  it("rejects cross-origin login POST before proxying credentials", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://neon.example/auth");
    vi.stubEnv("SHIP_CHECK_ALLOWED_ORIGINS", "https://cloud-check.good-ship.co.uk");
    const fetcher=vi.fn();
    vi.stubGlobal("fetch",fetcher);
    const request = new Request("https://cloud-check.good-ship.co.uk/api/auth/sign-in/email", {
      method:"POST",headers:{origin:"https://evil.example", "content-type":"application/json"},
      body:JSON.stringify({email:"a@example.com",password:"secret"})
    });
    const response=await proxyNeonAuth(request,["sign-in","email"]);
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never proxies arbitrary backend auth paths", async () => {
    const fetcher=vi.fn();
    vi.stubGlobal("fetch",fetcher);
    const response=await proxyNeonAuth(new Request("https://cloud-check.good-ship.co.uk/api/auth/admin/list-users"),["admin","list-users"]);
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
