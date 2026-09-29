import { test } from "node:test";
import assert from "node:assert/strict";
import { assertEstateReport, estateProjectBuckets } from "./estate.js";

function scan(overrides = {}) {
  return { project: {}, findings: [], gaps: [], checks: [], ...overrides };
}

function estate(projects) {
  return {
    schemaVersion: "0.1",
    type: "ship-check-estate-report",
    tool: { name: "ship-check", version: "test" },
    root: "/tmp/code",
    projectCount: projects.length,
    scannedCount: projects.filter((item) => item.status === "scanned").length,
    failedCount: projects.filter((item) => item.status === "failed").length,
    summary: { findings: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, unverified: 0, checkErrors: 0, scannerUnavailable: 0 },
    projects,
    generatedAt: "2026-09-29T00:00:00.000Z",
  };
}

test("estate report validation requires the canonical aggregate contract", () => {
  assert.equal(assertEstateReport(estate([])).type, "ship-check-estate-report");
  assert.throws(() => assertEstateReport({ schemaVersion: "0.1" }), /unexpected estate report/);
});

test("estate buckets keep failures, attention and quiet scans distinct", () => {
  const result = estateProjectBuckets(
    estate([
      { relativePath: "failed", status: "failed", error: "boom" },
      { relativePath: "finding", status: "scanned", report: scan({ findings: [{ severity: "high" }] }) },
      { relativePath: "question", status: "scanned", report: scan({ gaps: [{ id: "q" }] }) },
      { relativePath: "check-error", status: "scanned", report: scan({ checks: [{ status: "error" }] }) },
      { relativePath: "quiet", status: "scanned", report: scan() },
    ]),
  );
  assert.deepEqual(result.failed.map((item) => item.relativePath), ["failed"]);
  assert.deepEqual(result.attention.map((item) => item.relativePath), ["finding", "question", "check-error"]);
  assert.deepEqual(result.quiet.map((item) => item.relativePath), ["quiet"]);
});
