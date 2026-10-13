import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { ciQualityCheck } from "./ciQuality.js";

const roots: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-ci-quality-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const goodWorkflow = [
  "name: Validate",
  "on:",
  "  pull_request:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  validate:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - run: pnpm install --frozen-lockfile",
  "      - run: pnpm test",
  "      - run: pnpm check"
].join("\n");

describe("CI quality source assessment", () => {
  it("records visible PR verification without claiming it is enforced", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      ".github/workflows/validate.yml": goodWorkflow
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps).toHaveLength(0);
    expect(report.observations[0]?.title).toContain("Pull-request quality");
    expect(report.coverage.find((entry) => entry.area === "supply-chain")?.status).toBe("partial");
  });

  it("detects an explicitly masked test failure", async () => {
    const root = await fixture({
      ".github/workflows/validate.yml": goodWorkflow.replace("pnpm test", "pnpm test || true")
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.findings).toEqual([expect.objectContaining({
      checkId: "production.ci-quality",
      severity: "medium",
      evidence: [expect.objectContaining({ path: ".github/workflows/validate.yml" })]
    })]);
  });

  it("asks for evidence when a project has scripts but no GitHub CI", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } })
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps.map((item) => item.id)).toContain("production.ci-quality:no-workflows");
  });

  it("identifies push-only checks as an unverified PR gate", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      ".github/workflows/push.yml": goodWorkflow.replace("  pull_request:\n", "")
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.gaps.map((item) => item.id)).toContain("production.ci-quality:no-pr-verification");
  });

  it("asks when the only PR verification workflow is path-filtered", async () => {
    const root = await fixture({
      ".github/workflows/validate.yml": goodWorkflow.replace(
        "  pull_request:", "  pull_request:\n    paths: [src/**]"
      )
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.gaps.map((item) => item.id)).toContain("production.ci-quality:pr-path-filters");
  });

  it("does not treat a comment as a pull-request trigger", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
      ".github/workflows/check.yml": "on:\n  push:\n#  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test"
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.gaps.map((item) => item.id)).toContain("production.ci-quality:no-pr-verification");
  });

  it("treats tolerated failures as verification questions rather than definite broken gates", async () => {
    const root = await fixture({
      ".github/workflows/validate.yml": goodWorkflow + "\n      - continue-on-error: true\n        run: pnpm lint"
    });
    const report = await scanProject(root, [ciQualityCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps.map((item) => item.id)).toContain("production.ci-quality:continue-on-error:.github/workflows/validate.yml");
  });
});
