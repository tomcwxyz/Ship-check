import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { costAwareChecks } from "../src/index.js";

const risky = fileURLToPath(new URL("../../../test-fixtures/cost-risky/", import.meta.url));
const safe = fileURLToPath(new URL("../../../test-fixtures/cost-safe/", import.meta.url));

describe("cost-aware checks", () => {
  it("finds frequent scheduled and polling work", async () => {
    const report = await scanProject(risky, costAwareChecks);
    const ids = report.findings.map((finding) => finding.checkId);
    expect(ids).toContain("cost.vercel-cron-frequency");
    expect(ids).toContain("cost.frequent-network-polling");
  });

  it("does not flag deliberate daily jobs or on-demand refresh", async () => {
    const report = await scanProject(safe, costAwareChecks);
    expect(report.findings).toHaveLength(0);
  });
});
