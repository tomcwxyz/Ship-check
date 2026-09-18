import { describe, expect, it } from "vitest";
import { resolveDatabaseInspection } from "./databaseInspection.js";

describe("database inspection CLI boundary", () => {
  it("does not open database inspection unless explicitly enabled", () => {
    expect(resolveDatabaseInspection({ inspectDatabase: false }, {})).toBeNull();
  });

  it("rejects database options when the explicit opt-in is absent", () => {
    expect(() => resolveDatabaseInspection({
      inspectDatabase: false,
      databasePlatform: "supabase"
    }, {})).toThrow(/require --inspect-database/);
  });

  it("reads the connection URL from a named environment variable without returning it as the environment name", () => {
    const resolved = resolveDatabaseInspection({
      inspectDatabase: true,
      databaseUrlEnv: "MY_READONLY_DATABASE_URL",
      databasePlatform: "supabase",
      databaseTableLimit: "250"
    }, {
      MY_READONLY_DATABASE_URL: "postgresql://reader:secret@example.com/app"
    });

    expect(resolved).toEqual({
      connectionString: "postgresql://reader:secret@example.com/app",
      envName: "MY_READONLY_DATABASE_URL",
      platform: "supabase",
      tableLimit: 250
    });
  });

  it("uses SHIP_CHECK_DATABASE_URL by default", () => {
    const resolved = resolveDatabaseInspection({ inspectDatabase: true }, {
      SHIP_CHECK_DATABASE_URL: "postgresql://reader:secret@example.com/app"
    });
    expect(resolved?.envName).toBe("SHIP_CHECK_DATABASE_URL");
    expect(resolved?.platform).toBe("postgres");
  });

  it("does not accept a connection URL where an environment variable name is expected", () => {
    expect(() => resolveDatabaseInspection({
      inspectDatabase: true,
      databaseUrlEnv: "postgresql://reader:secret@example.com/app"
    }, {})).toThrow(/must name an environment variable/);
  });

  it("requires the named environment variable to exist", () => {
    expect(() => resolveDatabaseInspection({
      inspectDatabase: true,
      databaseUrlEnv: "MISSING_DATABASE_URL"
    }, {})).toThrow(/MISSING_DATABASE_URL environment variable/);
  });

  it("bounds the requested table inventory", () => {
    expect(() => resolveDatabaseInspection({
      inspectDatabase: true,
      databaseTableLimit: "5001"
    }, { SHIP_CHECK_DATABASE_URL: "postgresql://reader:secret@example.com/app" })).toThrow(/1 to 5000/);
  });
});
