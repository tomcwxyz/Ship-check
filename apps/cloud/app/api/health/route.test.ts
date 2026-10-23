import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/cloudRuntime", () => ({
  cloudDatabaseReady: vi.fn()
}));

import { cloudDatabaseReady } from "../../../lib/cloudRuntime";
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("Cloud health boundary", () => {
  it("refuses to claim readiness before Neon Auth and DB are configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NEON_AUTH_BASE_URL", "");
    vi.stubEnv("SHIP_CHECK_ALLOWED_ORIGINS", "");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status:"configuration-incomplete",database:"unavailable" });
    expect(cloudDatabaseReady).not.toHaveBeenCalled();
  });

  it("reports verified schema readiness only after the dependency responds", async () => {
    vi.stubEnv("DATABASE_URL","postgresql://not-a-real-database.invalid/neondb");
    vi.stubEnv("NEON_AUTH_BASE_URL","https://example.invalid/auth");
    vi.stubEnv("SHIP_CHECK_ALLOWED_ORIGINS","https://example.invalid");
    vi.mocked(cloudDatabaseReady).mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status:"ready",database:"ready",monitoring:"opt-in-ci-only" });
    expect(JSON.stringify(await response.json().catch(()=>({})))).not.toContain("postgresql://");
  });

  it("returns 503 when the schema is unavailable without leaking credentials", async () => {
    vi.stubEnv("DATABASE_URL","postgresql://sensitive.invalid/secret");
    vi.stubEnv("NEON_AUTH_BASE_URL","https://example.invalid/auth");
    vi.stubEnv("SHIP_CHECK_ALLOWED_ORIGINS","https://example.invalid");
    vi.mocked(cloudDatabaseReady).mockRejectedValue(new Error("secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("secret");
  });
});
