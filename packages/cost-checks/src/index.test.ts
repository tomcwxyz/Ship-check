import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { costAwareChecks } from "./index.js";

const temporaryRoots: string[] = [];
const cronCheck = costAwareChecks.find((check) => check.id === "cost.vercel-cron-frequency");
if (!cronCheck) throw new Error("Missing cron cost check");

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-cost-"));
  temporaryRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Vercel cron cadence × work", () => {
  it("treats a five-minute AI job as high severity", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/brief", schedule: "*/5 * * * *" }] }),
      "app/api/cron/brief/route.ts": 'import { buildBrief } from "@/lib/brief"; export async function GET() { return buildBrief(); }',
      "lib/brief.ts": 'export async function buildBrief() { return generateText({ model: "example" }); }'
    });

    const report = await scanProject(root, [cronCheck]);
    expect(report.findings[0]).toMatchObject({
      checkId: "cost.vercel-cron-frequency",
      severity: "high",
      title: "Frequent scheduled work reaches cost-bearing operations"
    });
    expect(report.findings[0]?.summary).toMatch(/AI\/model work/);
    expect(report.findings[0]?.evidence.some((item) => item.path === "lib/brief.ts")).toBe(true);
  });

  it("keeps a five-minute lightweight route at medium rather than treating cadence alone as high", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/heartbeat", schedule: "*/5 * * * *" }] }),
      "app/api/cron/heartbeat/route.ts": 'export async function GET() { return Response.json({ ok: true }); }'
    });

    const report = await scanProject(root, [cronCheck]);
    expect(report.findings[0]).toMatchObject({
      severity: "medium",
      title: "Scheduled server work runs more often than hourly"
    });
    expect(report.findings[0]?.summary).toMatch(/did not find a recognised model/);
  });

  it("raises a thirty-minute database job above a lightweight thirty-minute schedule", async () => {
    const databaseRoot = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/sync", schedule: "*/30 * * * *" }] }),
      "app/api/cron/sync/route.ts": 'import { sync } from "@/lib/sync"; export async function GET() { return sync(); }',
      "lib/sync.ts": 'export async function sync() { return db.update({ where: { id: 1 } }); }'
    });
    const lightRoot = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/light", schedule: "*/30 * * * *" }] }),
      "app/api/cron/light/route.ts": 'export async function GET() { return Response.json({ ok: true }); }'
    });

    const databaseReport = await scanProject(databaseRoot, [cronCheck]);
    const lightReport = await scanProject(lightRoot, [cronCheck]);

    expect(databaseReport.findings[0]?.severity).toBe("medium");
    expect(databaseReport.findings[0]?.summary).toMatch(/database work/);
    expect(lightReport.findings[0]?.severity).toBe("low");
  });

  it("does not report an hourly schedule through the frequent-cron check", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/hourly", schedule: "0 * * * *" }] }),
      "app/api/cron/hourly/route.ts": 'export async function GET() { return generateText({ model: "example" }); }'
    });

    const report = await scanProject(root, [cronCheck]);
    expect(report.findings).toEqual([]);
  });
});
