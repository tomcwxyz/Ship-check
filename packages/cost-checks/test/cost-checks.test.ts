import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { costAwareChecks } from "../src/index.js";

const risky = fileURLToPath(new URL("../../../test-fixtures/cost-risky/", import.meta.url));
const safe = fileURLToPath(new URL("../../../test-fixtures/cost-safe/", import.meta.url));
const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-cost-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

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

  it("grades five-minute cron work high and fifteen-minute work medium", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(
      path.join(root, "vercel.json"),
      JSON.stringify({
        crons: [
          { path: "/api/five", schedule: "*/5 * * * *" },
          { path: "/api/fifteen", schedule: "*/15 * * * *" },
          { path: "/api/hourly", schedule: "0 * * * *" },
        ],
      }),
    );

    const report = await scanProject(root, costAwareChecks);
    const cronFindings = report.findings.filter((finding) => finding.checkId === "cost.vercel-cron-frequency");

    expect(cronFindings).toHaveLength(2);
    expect(cronFindings.find((finding) => finding.summary.includes("every 5 minutes"))?.severity).toBe("high");
    expect(cronFindings.find((finding) => finding.summary.includes("every 15 minutes"))?.severity).toBe("medium");
    expect(JSON.stringify(cronFindings)).not.toContain("/api/hourly is scheduled");
  });

  it("does not treat a short timer as polling unless the file also performs network work", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "timer.ts"), "setInterval(() => tick(), 30000);\n");

    const report = await scanProject(root, costAwareChecks);

    expect(report.findings.some((finding) => finding.checkId === "cost.frequent-network-polling")).toBe(false);
  });

  it("ignores polling patterns inside test files", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(
      path.join(root, "polling.test.ts"),
      "async function go(){ await fetch('/api/status'); setInterval(() => fetch('/api/status'), 30000); }\n",
    );

    const report = await scanProject(root, costAwareChecks);

    expect(report.findings.some((finding) => finding.checkId === "cost.frequent-network-polling")).toBe(false);
  });
});
