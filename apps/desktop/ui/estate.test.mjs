import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertEstateReport, estateProjectBuckets, estateProjectCanFocus,
  estateProjectCategory, estateSummary,
} from "./estate.js";

function scan(overrides = {}) {
  return {
    project: {}, findings: [], gaps: [], checks: [],
    coverage: [{ area: "cost", status: "assessed" }], ...overrides,
  };
}

function estate(projects) {
  return {
    schemaVersion: "0.1",
    type: "ship-check-estate-report",
    tool: { name: "ship-check", version: "test" },
    root: "/tmp/code",
    projectCount: projects.length,
    scannedCount: projects.filter(item => item.status === "scanned").length,
    failedCount: projects.filter(item => item.status === "failed").length,
    summary: { findings: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0,
      unverified: 0, checkErrors: 0, scannerUnavailable: 0 },
    projects, generatedAt: "2026-10-09T00:00:00.000Z",
  };
}

test("estate report validation requires the canonical aggregate contract", () => {
  assert.equal(assertEstateReport(estate([])).type, "ship-check-estate-report");
  assert.throws(() => assertEstateReport({ schemaVersion: "0.1" }), /unexpected estate report/);
});

test("estate dashboard distinguishes findings, unanswered questions, errors, gaps and quiet scans", () => {
  const result = estateProjectBuckets(estate([
    { relativePath: "failed", status: "failed", error: "boom" },
    { relativePath: "finding", status: "scanned", report: scan({ findings: [{ severity: "high" }] }) },
    { relativePath: "question", status: "scanned", report: scan({ gaps: [{ id: "q" }] }) },
    { relativePath: "check-error", status: "scanned", report: scan({ checks: [{ status: "error" }] }) },
    { relativePath: "partial", status: "scanned", report: scan({ coverage: [{area: "cost",status: "partial"}] }) },
    { relativePath: "not-assessed", status: "scanned", report: scan({ coverage: [{area: "cost",status: "not-assessed"}] }) },
    { relativePath: "unknown", status: "scanned", report: scan({ coverage: [] }) },
    { relativePath: "quiet", status: "scanned", report: scan() },
  ]));
  assert.deepEqual(result.failed.map(p => p.relativePath), ["failed"]);
  assert.deepEqual(result.attention.map(p => p.relativePath), ["finding"]);
  assert.deepEqual(result.verify.map(p => p.relativePath), ["check-error", "question"]);
  assert.deepEqual(result.limited.map(p => p.relativePath), ["not-assessed", "unknown"]);
  assert.deepEqual(result.quiet.map(p => p.relativePath), ["partial", "quiet"]);
});

test("report of a project with a finding and incomplete checks is still a findings project", () => {
  const project = { relativePath: "mixed", status: "scanned", report: scan({
    findings: [{severity:"high"}], gaps:[{id:"something"}], checks:[{status:"error"}],
  }) };
  assert.equal(estateProjectCategory(project), "attention");
});

test("estate prioritises more serious findings without pretending to rank overall safety", () => {
  const buckets = estateProjectBuckets(estate([
    {relativePath: "low",status:"scanned", report:scan({ findings:[{severity:"low"}] })},
    {relativePath: "high",status:"scanned",report:scan({ findings:[{severity:"critical"}] })},
  ]));
  assert.deepEqual(buckets.attention.map(p => p.relativePath), ["high", "low"]);
});

test("estate summary counts projects with unassessed areas even if findings exist", () => {
  const summary = estateSummary(estate([
    {relativePath:"a",status:"scanned",report:scan({findings:[{severity:"high"}],coverage:[{area:"cost",status:"not-assessed"}]})},
    {relativePath:"b",status:"scanned",report:scan()},
    {relativePath:"c",status:"failed",error:"boom"}
  ]));
  assert.equal(summary.withUnassessedAreas, 2);
  assert.equal(summary.findings, 1);
  assert.equal(summary.buckets.attention.length, 1);
});

test("focused review is only available for a finding or question", () => {
  assert.equal(estateProjectCanFocus({ status: "scanned", report: scan({findings:[{}]}) }), true);
  assert.equal(estateProjectCanFocus({ status: "scanned", report: scan({gaps:[{}]}) }), true);
  assert.equal(estateProjectCanFocus({ status: "scanned", report: scan({checks:[{status:"error"}]}) }), false);
  assert.equal(estateProjectCanFocus({ status: "failed", error: "boom" }), false);
});

test("partially assessed but quiet projects are not buried as no-evidence scans", () => {
  const project = {relativePath:"quiet-partial",status:"scanned",report:scan({
    coverage:[{area:"secrets",status:"partial"},{area:"runtime",status:"not-assessed"}]
  })};
  assert.equal(estateProjectCategory(project),"quiet");
  assert.equal(estateSummary(estate([project])).withUnassessedAreas,1);
});
