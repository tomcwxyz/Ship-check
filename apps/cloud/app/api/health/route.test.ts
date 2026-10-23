import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";

afterEach(() => vi.unstubAllEnvs());

describe("Cloud health boundary", () => {
  it("refuses to imply Cloud readiness without database and pilot session configuration", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SHIP_CHECK_PILOT_SESSION_SECRET", "");
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      status: "configuration-incomplete",
      database: "not-tested",
      monitoring: "not-scheduled"
    });
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports configuration present without pretending to test DB connectivity", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://fake:fake@localhost/fake");
    vi.stubEnv("SHIP_CHECK_PILOT_SESSION_SECRET", "test-only-pilot-credential");
    const result = await GET();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: "configuration-present",
      database: "not-tested"
    });
    expect(JSON.stringify(await (await GET()).json())).not.toContain("postgresql://");
  });
});
