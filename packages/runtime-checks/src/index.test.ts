import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "@ship-check/core/runtime";
import {
  cookieCorsBoundaryCheck,
  responseSecurityHeadersCheck,
  transportSecurityCheck
} from "./index.js";

function context(overrides: Partial<RuntimeContext["http"]> = {}): RuntimeContext {
  const target = new URL("https://example.com/");
  return {
    target,
    source: {
      schemaVersion: "0.1",
      id: "url:https://example.com/",
      type: "deployment",
      provider: "url",
      label: "https://example.com/",
      acquisition: "runtime-probe",
      executionLocation: "user-device",
      capabilities: ["runtime-http"],
      ephemeral: true,
      acquiredAt: "2026-09-18T12:00:00.000Z"
    },
    http: {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      redirects: [],
      requestOrigin: "https://ship-check.invalid",
      headers: {},
      cookies: [],
      ...overrides
    }
  };
}

describe("runtime HTTP checks", () => {
  it("treats an external HTTP final target as a high-confidence transport finding", async () => {
    const result = await transportSecurityCheck.run(context({ finalUrl: "http://example.com/" }));
    expect(Array.isArray(result) ? result : result.findings?.[0]).toMatchObject({
      id: "runtime.transport-security:http-only",
      severity: "high",
      confidence: "high"
    });
  });

  it("reports the bounded header baseline without retaining header values", async () => {
    const result = await responseSecurityHeadersCheck.run(context());
    const finding = Array.isArray(result) ? result[0] : result.findings?.[0];
    expect(finding).toMatchObject({
      id: "runtime.response-security-headers:incomplete",
      severity: "low"
    });
    expect(finding?.evidence[0]?.detail).toContain("Missing response header names");
  });

  it("flags credentialed reflection of the synthetic external Origin", async () => {
    const result = await cookieCorsBoundaryCheck.run(context({
      headers: {
        accessControlAllowOrigin: "https://ship-check.invalid",
        accessControlAllowCredentials: "true"
      }
    }));
    const findings = Array.isArray(result) ? result : result.findings ?? [];
    expect(findings).toContainEqual(expect.objectContaining({
      id: "runtime.cookie-cors-boundaries:reflected-origin",
      severity: "high"
    }));
  });
});
