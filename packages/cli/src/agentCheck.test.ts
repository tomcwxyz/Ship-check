import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScanReport } from "@ship-check/schemas";
import { dependencyFingerprint, runDailyAgentCheck, renderDailyAgentCheck } from "./agentCheck.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function fakeReport(): ScanReport {
  return {
    generatedAt: "2026-11-06T07:00:00.000Z",
    findings: [{
      id: "production.osv-vulnerabilities:npm:example:1",
      title: "Known vulnerable dependency: example",
      summary: "CISA KEV: known exploited in the wild (CVE-2024-12345).",
      severity: "high",
      confidence: "high",
      pack: "production-ready",
      checkId: "production.osv-vulnerabilities",
      evidence: [],
      remediation: { why: "why", fix: "upgrade", verify: "test", agentPrompt: "test" }
    }],
    summary: { total: 1, suppressed: 0, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    checks: [], gaps: [], observations: [], coverage: []
  } as ScanReport;
}

describe("agent security assessment", () => {
  it("caches source-free summaries for one day, invalidates on manifest changes and respects force", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-agent-fixture-"));
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-agent-cache-"));
    roots.push(root, cache);
    const before = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cache;
    try {
      await fs.writeFile(path.join(root, "package.json"), '{"name":"before"}');
      let calls = 0;
      const scan = async () => { calls += 1; return fakeReport(); };
      const now = new Date("2026-11-06T08:00:00.000Z");
      const first = await runDailyAgentCheck(root, true, scan, { now });
      const second = await runDailyAgentCheck(root, true, scan, { now: new Date(now.getTime() + 1000) });
      expect([first.status, second.status, calls]).toEqual(["checked", "cached", 1]);
      expect(renderDailyAgentCheck(second)).toContain("[CISA KEV]");
      expect(JSON.stringify(second)).not.toContain("agentPrompt");

      await fs.writeFile(path.join(root, "package.json"), '{"name":"after"}');
      const third = await runDailyAgentCheck(root, true, scan, { now: new Date(now.getTime() + 2000) });
      expect([third.status, calls]).toEqual(["checked", 2]);
      const forced = await runDailyAgentCheck(root, true, scan, { force: true, now: new Date(now.getTime() + 3000) });
      expect([forced.status, calls]).toEqual(["checked", 3]);
    } finally {
      if (before === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = before;
    }
  });

  it("fingerprints dependency inputs without needing a Git repository", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-agent-fingerprint-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lock one");
    const first = await dependencyFingerprint(root);
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lock two");
    expect(await dependencyFingerprint(root)).not.toBe(first);
  });
});
