import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { checksForPacks } from "./index.js";
import {
  aiModelLifecycleCheck,
  cmsComponentInventoryCheck,
  evaluateModelRetirement
} from "./technologyLifecycle.js";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-technology-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AI model lifecycle intelligence", () => {
  it("uses exact model IDs and UTC calendar dates, including retirement boundary", () => {
    expect(evaluateModelRetirement("claude-opus-4-1-20250805", "2026-11-12")).toMatchObject({
      state: "retired",
      entry: { provider: "anthropic", retirementDate: "2026-08-05" }
    });
    expect(evaluateModelRetirement("claude-opus-4-1-20250805", "2026-08-05").state).toBe("retired");
    expect(evaluateModelRetirement("gpt-5", "2026-11-12").daysRemaining).toBe(29);
    expect(evaluateModelRetirement("gpt-6", "2026-11-12")).toMatchObject({ state: "unknown", daysRemaining: null });
  });

  it("reports declared model retirement without falsely claiming deployed usage", async () => {
    const root = await fixture({
      "src/models.ts": [
        'export const config = { model: "gpt-5" };',
        'export const alt = anthropic("claude-opus-4-1-20250805");',
        'export const dynamic = { model: process.env.LLM_MODEL };'
      ].join("\n")
    });
    const report = await scanProject(root, [aiModelLifecycleCheck]);
    expect(report.findings.map((item) => item.summary)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("gpt-5"),
        expect.stringContaining("claude-opus-4-1-20250805")
      ])
    );
    expect(report.findings).toHaveLength(2);
    expect(report.findings.every((item) => item.confidence === "medium")).toBe(true);
    expect(report.gaps.some((item) => item.id.endsWith(":runtime-selection"))).toBe(true);
    expect(report.coverage.find((entry) => entry.area === "supply-chain")?.status).toBe("partial");
  });

  it("records unknown IDs as inventory rather than inventing advisories", async () => {
    const root = await fixture({
      "src/ai.py": 'MODEL_ID = "gemini-2.5-pro"\nmodel = "gpt-6"\n'
    });
    const report = await scanProject(root, [aiModelLifecycleCheck]);
    expect(report.findings).toEqual([]);
    expect(report.observations).toHaveLength(2);
    expect(report.observations.every((item) => item.kind === "inventory")).toBe(true);
    expect(report.gaps).toHaveLength(1);
  });

  it("does not turn model names in documentation and tests into active findings", async () => {
    const root = await fixture({
      "README.md": 'Use model: "gpt-5" only in a demonstration.',
      "docs/models.ts": 'const model = "gpt-5";',
      "src/models.test.ts": 'const model = "claude-opus-4-1-20250805";',
      "src/normal.ts": "export const value = 1;"
    });
    const report = await scanProject(root, [aiModelLifecycleCheck]);
    expect(report.findings).toEqual([]);
    expect(report.observations).toEqual([]);
    expect(report.gaps).toEqual([]);
  });
});

describe("WordPress and Drupal inventory", () => {
  it("discovers WordPress core and extension versions without making vulnerability claims", async () => {
    const root = await fixture({
      "wp-config.php": "<?php // Configuration is loaded elsewhere",
      "wp-includes/version.php": "<?php\n$wp_version = '6.7.2';\n",
      "wp-content/plugins/sample/sample.php": "<?php\n/*\nPlugin Name: Example plugin\nVersion: 1.2.3\n*/\n"
    });
    const report = await scanProject(root, [cmsComponentInventoryCheck]);
    expect(report.findings).toEqual([]);
    expect(report.observations.map((item) => item.summary).join(" ")).toContain("6.7.2");
    expect(report.observations.map((item) => item.summary).join(" ")).toContain("1.2.3");
    expect(report.gaps[0]?.title).toContain("unverified");
  });

  it("reads Drupal versions from Composer lock files and leaves live status unknown", async () => {
    const root = await fixture({
      "composer.json": JSON.stringify({ require: { "drupal/core-recommended": "^11" } }),
      "composer.lock": JSON.stringify({
        packages: [
          { name: "drupal/core-recommended", version: "11.2.0" },
          { name: "drupal/token", version: "1.15.0" },
          { name: "symfony/http-foundation", version: "7.0.0" }
        ]
      })
    });
    const report = await scanProject(root, [cmsComponentInventoryCheck]);
    expect(report.findings).toEqual([]);
    expect(report.observations).toHaveLength(2);
    expect(report.observations.map((item) => item.summary).join(" ")).toContain("drupal/token");
    expect(report.gaps.some((item) => item.id.endsWith(":drupal-advisories"))).toBe(true);
  });

  it("shows an evidence gap when Drupal versions cannot be read", async () => {
    const root = await fixture({
      "composer.json": JSON.stringify({ require: { "drupal/core": "^11" } })
    });
    const report = await scanProject(root, [cmsComponentInventoryCheck]);
    expect(report.findings).toEqual([]);
    expect(report.gaps.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "production.cms-component-inventory:drupal-lockfile",
        "production.cms-component-inventory:drupal-advisories"
      ])
    );
  });

  it("is included in the shared production-ready scan and not the secure-only pack", () => {
    const production = checksForPacks(["production-ready"]).map((check) => check.id);
    const security = checksForPacks(["secure-build"]).map((check) => check.id);
    expect(production).toContain("production.ai-model-lifecycle");
    expect(production).toContain("production.cms-component-inventory");
    expect(security).not.toContain("production.cms-component-inventory");
  });
});
