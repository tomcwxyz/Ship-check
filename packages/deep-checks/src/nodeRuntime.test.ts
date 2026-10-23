import { describe, expect, it } from "vitest";
import { collectNodeRuntimeVersions, evaluateNodeRuntimeVersions, parseExactNodeVersion } from "./nodeRuntime.js";

const releases = [
  { version: "v24.22.1", date: "2026-10-21", security: true },
  { version: "v24.22.0", date: "2026-10-14", security: false },
  { version: "v22.23.4", date: "2026-10-21", security: true },
  { version: "v26.12.1", date: "2026-10-21", security: true }
];
const schedule = {
  v20: { start: "2023-04-18", end: "2026-04-30" },
  v22: { start: "2024-04-24", end: "2027-04-30" },
  v24: { start: "2025-05-06", end: "2028-04-30" },
  v26: { start: "2026-05-05", end: "2029-04-30" }
};
const today = "2026-10-23";

describe("Node.js runtime security intelligence", () => {
  it("parses only pinned exact release versions", () => {
    expect(parseExactNodeVersion("v24.22.0")).toEqual({ major: 24, minor: 22, patch: 0 });
    expect(parseExactNodeVersion("24")).toBeNull();
    expect(parseExactNodeVersion("^24.20.0")).toBeNull();
    expect(parseExactNodeVersion(">=22.0.0")).toBeNull();
  });
  it("detects a version preceding the latest official security release", () => {
    const outcome = evaluateNodeRuntimeVersions([
      { path: ".nvmrc", declared: "24.22.0", scope: "project" }
    ], releases, schedule, today);
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]).toMatchObject({
      checkId: "production.node-security",
      severity: "high",
      evidence: [{ path: ".nvmrc" }]
    });
    expect(outcome.findings[0]?.summary).toContain("24.22.1");
    expect(outcome.findings[0]?.remediation.verify).toContain("actual runtime");
  });
  it("does not flag security-patched exact releases", () => {
    expect(evaluateNodeRuntimeVersions([
      { path: ".node-version", declared: "v24.22.1", scope: "project" }
    ], releases, schedule, today).findings).toHaveLength(0);
  });
  it("marks broad ranges as unverified, never as vulnerable exact versions", () => {
    const outcome = evaluateNodeRuntimeVersions([
      { path: "package.json", declared: ">=22.0.0", scope: "project" }
    ], releases, schedule, today);
    expect(outcome.findings).toHaveLength(0);
    expect(outcome.gaps[0]?.title).toContain("needs verifying");
  });
  it("flags end-of-life lines even if the old line once received security updates", () => {
    const outcome = evaluateNodeRuntimeVersions([
      { path: "Dockerfile", declared: "20.20.2", scope: "image" }
    ], releases, schedule, today);
    expect(outcome.findings[0]?.title).toContain("outside security support");
  });
  it("does not use security releases dated in the future", () => {
    expect(evaluateNodeRuntimeVersions([
      { path: ".nvmrc", declared: "24.22.1", scope: "project" }
    ], [...releases, { version: "v24.22.2", date: "2026-10-28", security: true }], schedule, today).findings).toHaveLength(0);
  });
  it("keeps Docker, project and CI version provenance separate", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ engines: { node: "^24.0.0" } }),
      ".nvmrc": "24.22.0\n",
      "Dockerfile": "FROM node:24.22.0-alpine AS build\nFROM node:24.22.1 AS runtime",
      ".github/workflows/ci.yml": "steps:\n  - uses: actions/setup-node@v4\n    with:\n      node-version: '22.23.3'"
    };
    const declarations = await collectNodeRuntimeVersions({
      files: Object.keys(files),
      readText: async (file) => files[file] ?? null
    });
    expect(declarations).toEqual(expect.arrayContaining([
      { path: ".nvmrc", declared: "24.22.0", scope: "project" },
      { path: "package.json", declared: "^24.0.0", scope: "project" },
      { path: "Dockerfile", declared: "24.22.1", scope: "image" },
      { path: ".github/workflows/ci.yml", declared: "22.23.3", scope: "ci" }
    ]));
    expect(declarations.filter(x => x.path === "Dockerfile")).toHaveLength(2);
  });
});
