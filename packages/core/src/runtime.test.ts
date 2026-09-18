import { describe, expect, it } from "vitest";
import { parseRuntimeTargetUrl, scanRuntimeTarget, type RuntimeCheckDefinition } from "./runtime.js";

function sequentialFetch(responses: Response[]): typeof fetch {
  let index = 0;
  return (async () => {
    const response = responses[index++];
    if (!response) throw new Error("unexpected fetch");
    return response;
  }) as typeof fetch;
}

describe("runtime URL evidence", () => {
  it("rejects credentials embedded in deployment URLs", () => {
    expect(() => parseRuntimeTargetUrl("https://user:secret@example.com")).toThrow(/credentials/i);
  });

  it("records runtime evidence while source-only checks remain not assessed", async () => {
    const runtimeCheck: RuntimeCheckDefinition = {
      id: "runtime.test",
      pack: "production-ready",
      title: "Runtime test",
      description: "Test runtime evidence",
      requiresEvidence: ["runtime-http"],
      coverage: [{ area: "runtime", status: "assessed" }],
      async run(context) {
        return {
          observations: [{
            id: "runtime.test:response",
            checkId: "runtime.test",
            pack: "production-ready",
            area: "runtime",
            kind: "verified-control",
            title: "Runtime response observed",
            summary: "The test response was acquired.",
            evidence: [{ kind: "configuration", detail: `Status ${context.http.status}` }]
          }]
        };
      }
    };

    const report = await scanRuntimeTarget(
      "http://example.com",
      [{ id: "production.source-only", pack: "production-ready" }],
      [runtimeCheck],
      "0.0.0-test",
      {
        fetchImpl: sequentialFetch([
          new Response(null, { status: 301, headers: { location: "https://example.com/" } }),
          new Response(null, {
            status: 200,
            headers: {
              "content-security-policy": "default-src 'self'",
              "x-content-type-options": "nosniff"
            }
          })
        ])
      }
    );

    expect(report.project.path).toBe("http://example.com/");
    expect(report.project.fileCount).toBe(0);
    expect(report.project.snapshot?.source).toMatchObject({
      type: "deployment",
      provider: "url",
      acquisition: "runtime-probe",
      capabilities: ["runtime-http"]
    });
    expect(report.checks.find((check) => check.checkId === "production.source-only")).toMatchObject({
      status: "not-assessed",
      missingEvidence: ["source-files"]
    });
    expect(report.checks.find((check) => check.checkId === "runtime.test")).toMatchObject({
      status: "passed",
      observationCount: 1
    });
    expect(report.coverage.find((entry) => entry.area === "runtime")?.status).toBe("assessed");
    expect(report.coverage.find((entry) => entry.area === "database")?.status).toBe("not-assessed");
  });
});
