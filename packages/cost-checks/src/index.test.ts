import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { costAwareChecks } from "./index.js";

const temporaryRoots: string[] = [];
const cronCheck = costAwareChecks.find((check) => check.id === "cost.vercel-cron-frequency");
const pollingCheck = costAwareChecks.find((check) => check.id === "cost.frequent-network-polling");
if (!cronCheck) throw new Error("Missing cron cost check");
if (!pollingCheck) throw new Error("Missing polling cost check");
const recurringCheck = costAwareChecks.find((check) => check.id === "cost.recurring-provider-work");
const duplicateCheck = costAwareChecks.find((check) => check.id === "cost.duplicate-cron-route");
if (!recurringCheck || !duplicateCheck) throw new Error("Missing recurring-work checks");

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

  it("traces model work through a configured tsconfig path alias", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@jobs/*": ["src/jobs/*"] }
        }
      }),
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/brief", schedule: "*/5 * * * *" }] }),
      "app/api/cron/brief/route.ts": 'import { buildBrief } from "@jobs/brief"; export async function GET() { return buildBrief(); }',
      "src/jobs/brief.ts": 'export async function buildBrief() { return generateText({ model: "example" }); }'
    });

    const report = await scanProject(root, [cronCheck]);
    expect(report.findings[0]).toMatchObject({
      checkId: "cost.vercel-cron-frequency",
      severity: "high"
    });
    expect(report.findings[0]?.summary).toMatch(/AI\/model work/);
    expect(report.findings[0]?.evidence.some((item) => item.path === "src/jobs/brief.ts")).toBe(true);
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

describe("frequent polling association", () => {
  it("ignores an unrelated one-second UI timer but keeps a three-second network poll", async () => {
    const root = await fixture({
      "observer.tsx": [
        'const fetchState = async () => { return fetch("/api/state"); };',
        'setInterval(() => setNowMs(Date.now()), 1000);',
        'setInterval(() => { if (document.visibilityState === "hidden") return; fetchState(); }, 3000);'
      ].join("\n")
    });

    const report = await scanProject(root, [pollingCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.summary).toMatch(/3 seconds/);
  });

  it("does not report a UI timer merely because the same file performs network work elsewhere", async () => {
    const root = await fixture({
      "timer.tsx": [
        'async function load() { return fetch("/api/data"); }',
        'setInterval(() => setClock(Date.now()), 1000);'
      ].join("\n")
    });

    const report = await scanProject(root, [pollingCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("reports direct network work inside an interval callback", async () => {
    const root = await fixture({
      "poll.ts": 'setInterval(async () => { await fetch("/api/state"); }, 5000);'
    });

    const report = await scanProject(root, [pollingCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.severity).toBe("high");
  });
});

describe("recurring paid-service and database usage", () => {
  it("surfaces daily Firecrawl scraping and database calls as a review, not confirmed waste", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/scrape", schedule: "0 9 * * *" }] }),
      "app/api/cron/scrape/route.ts": 'import { refresh } from "@/lib/refresh"; export async function GET() { return refresh(); }',
      "lib/refresh.ts": 'import Firecrawl from "@mendable/firecrawl-js"; import { db } from "./db"; export async function refresh() { const crawler = new Firecrawl({}); await crawler.scrapeUrl("https://example.org"); return db.query.items.findMany(); }'
    });
    const report = await scanProject(root, [recurringCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      checkId: "cost.recurring-provider-work",
      severity: "low",
      confidence: "medium"
    });
    expect(report.findings[0].summary).toMatch(/daily/);
    expect(report.findings[0].summary).toMatch(/cannot establish/);
  });

  it("does not speculate about an unrelated daily heartbeat", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/heartbeat", schedule: "0 9 * * *" }] }),
      "app/api/cron/heartbeat/route.ts": "export async function GET() { return Response.json({ok:true}); }"
    });
    const report = await scanProject(root, [recurringCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("finds identical scheduled endpoints without claiming proven duplicate invocations", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [
        { path: "/api/cron/refresh", schedule: "0 8 * * *" },
        { path: "/api/cron/refresh/", schedule: "0 18 * * *" }
      ] })
    });
    const report = await scanProject(root, [duplicateCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].summary).toMatch(/actual platform execution behaviour is not verified/);
  });

  it("does not flag separate scheduled endpoints as duplicates", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [
        { path: "/api/cron/one", schedule: "0 8 * * *" },
        { path: "/api/cron/two", schedule: "0 8 * * *" }
      ] })
    });
    const report = await scanProject(root, [duplicateCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("detects short database polling via a same-file helper", async () => {
    const root = await fixture({
      "poll.ts": [
        'async function refresh() { return db.select().from(table); }',
        'setInterval(refresh, 5000);'
      ].join("\n")
    });
    const report = await scanProject(root, [pollingCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].title).toMatch(/database polling/);
  });
});
