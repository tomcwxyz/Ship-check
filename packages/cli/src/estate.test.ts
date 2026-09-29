import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScanReport } from "@ship-check/schemas";
import {
  buildEstateScanReport,
  discoverProjectDirectories,
  renderEstateMarkdown,
  type EstateProjectResult
} from "./estate.js";

const roots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-estate-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function report(overrides: Partial<ScanReport> = {}): ScanReport {
  const base: ScanReport = {
    schemaVersion: "0.1",
    tool: { name: "ship-check", version: "0.0.0-alpha.9" },
    project: {
      path: "fixture",
      gitRepository: false,
      inventorySource: "filesystem",
      fileCount: 1
    },
    packs: ["secure-build"],
    checks: [],
    findings: [],
    suppressedFindings: [],
    gaps: [],
    observations: [],
    coverage: [],
    summary: {
      total: 0,
      suppressed: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    },
    generatedAt: new Date().toISOString()
  };
  return { ...base, ...overrides } as ScanReport;
}

describe("estate discovery", () => {
  it("discovers Git and manifest project roots while skipping dependency directories", async () => {
    const root = await temporaryDirectory();
    await fs.mkdir(path.join(root, "one", ".git"), { recursive: true });
    await fs.writeFile(path.join(root, "one", "README.md"), "one");
    await fs.mkdir(path.join(root, "two"), { recursive: true });
    await fs.writeFile(path.join(root, "two", "pyproject.toml"), "[project]\nname='two'\n");
    await fs.mkdir(path.join(root, "node_modules", "noise"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "noise", "package.json"), "{}");

    const projects = await discoverProjectDirectories(root);

    expect(projects.map((project) => project.relativePath)).toEqual(["one", "two"]);
    expect(projects[0]).toMatchObject({ gitRepository: true });
    expect(projects[1]?.markers).toContain("pyproject.toml");
  });

  it("does not split nested workspaces into separate projects once a project root is found", async () => {
    const root = await temporaryDirectory();
    await fs.mkdir(path.join(root, "workspace", "packages", "child"), { recursive: true });
    await fs.writeFile(path.join(root, "workspace", "package.json"), '{"workspaces":["packages/*"]}');
    await fs.writeFile(path.join(root, "workspace", "packages", "child", "package.json"), '{"name":"child"}');

    const projects = await discoverProjectDirectories(root);

    expect(projects.map((project) => project.relativePath)).toEqual(["workspace"]);
  });

  it("honours a bounded discovery depth", async () => {
    const root = await temporaryDirectory();
    await fs.mkdir(path.join(root, "a", "b", "c"), { recursive: true });
    await fs.writeFile(path.join(root, "a", "b", "c", "package.json"), "{}");

    expect(await discoverProjectDirectories(root, { maxDepth: 2 })).toEqual([]);
    expect((await discoverProjectDirectories(root, { maxDepth: 3 })).map((project) => project.relativePath)).toEqual(["a/b/c"]);
  });
});

describe("estate reporting", () => {
  it("makes unavailable scanner evidence prominent in aggregate output", () => {
    const gap = {
      id: "production.osv-vulnerabilities:osv-unavailable",
      checkId: "production.osv-vulnerabilities",
      pack: "production-ready" as const,
      area: "supply-chain" as const,
      title: "OSV dependency scanner is unavailable",
      summary: "The requested scan could not run.",
      evidence: [{ kind: "configuration" as const, detail: "Scanner missing." }],
      verify: "Install the pinned scanner and rerun."
    };
    const projects: EstateProjectResult[] = [{
      relativePath: "live-service",
      status: "scanned",
      report: report({
        packs: ["production-ready"],
        gaps: [gap],
        checks: [{
          checkId: "production.osv-vulnerabilities",
          checkVersion: "1",
          pack: "production-ready",
          principles: [],
          status: "unverified",
          missingEvidence: [],
          findingCount: 0,
          suppressedCount: 0,
          gapCount: 1,
          observationCount: 0,
          durationMs: 2
        }]
      })
    }];

    const estate = buildEstateScanReport("/tmp/code", projects, "0.0.0-alpha.9");
    const markdown = renderEstateMarkdown(estate);

    expect(estate.summary.scannerUnavailable).toBe(1);
    expect(markdown).toContain("Evidence that could not be collected");
    expect(markdown).toContain("Do not read the affected area as assessed");
    expect(markdown).toContain("live-service");
  });
});
