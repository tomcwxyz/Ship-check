import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDiagnostic,
  createFailureDiagnostic,
  createSuccessDiagnostic,
  formatDiagnostics,
  formatReceipt,
  readDiagnostics,
  safeSourceLabel,
} from "./diagnostics.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const report = {
  generatedAt: "2026-09-04T19:45:00.000Z",
  tool: { version: "0.0.0-alpha.6" },
  project: { gitRepository: true, inventorySource: "git-tracked", fileCount: 94 },
  summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
  gaps: [
    {
      id: "production.next-security-headers:next.config.ts",
      checkId: "production.next-security-headers",
      pack: "production-ready",
      area: "configuration",
      title: "Security headers are not verified",
      summary: "Example",
      evidence: [{ kind: "configuration", path: "next.config.ts", detail: "Example" }],
      verify: "Inspect deployed headers",
    },
  ],
  coverage: [
    { area: "secrets", status: "assessed", checkIds: ["secure.secret-pattern"], detail: "Assessed" },
    { area: "runtime", status: "not-assessed", checkIds: [], detail: "Not assessed" },
  ],
  checks: [
    { checkId: "secure.secret-pattern", pack: "secure-build", status: "findings", findingCount: 1, gapCount: 0, durationMs: 4 },
    { checkId: "production.next-security-headers", pack: "production-ready", status: "unverified", findingCount: 0, gapCount: 1, durationMs: 2 },
    { checkId: "cost.frequent-network-polling", pack: "cost-aware", status: "passed", findingCount: 0, gapCount: 0, durationMs: 1 },
  ],
};

test("local source labels do not retain the full machine path", () => {
  assert.equal(safeSourceLabel("local", "C:\\Users\\tom\\signals"), "signals");
  assert.equal(safeSourceLabel("local", "/home/tom/signals"), "signals");
});

test("successful diagnostics keep scan metadata, network consent and coverage but not findings or evidence", () => {
  const entry = createSuccessDiagnostic({
    report,
    sourceMode: "local",
    sourceValue: "C:\\Users\\tom\\signals",
    gitRef: "",
    packs: ["secure-build", "production-ready", "cost-aware"],
    options: { networkedDependencyScan: true },
    elapsedMs: 123.6,
  });

  assert.equal(entry.source.label, "signals");
  assert.equal(entry.fileCount, 94);
  assert.equal(entry.inventorySource, "git-tracked");
  assert.equal(entry.elapsedMs, 124);
  assert.equal(entry.options.networkedDependencyScan, true);
  assert.equal(entry.unverifiedCount, 1);
  assert.equal(entry.coverage.length, 2);
  assert.equal(entry.checks[1].gapCount, 1);
  assert.equal("findings" in entry, false);
  assert.equal("evidence" in entry, false);
  assert.match(formatReceipt(entry), /94 files · 3 checks · git-tracked/);
  assert.match(formatReceipt(entry), /dependency network scan: on/);
  assert.match(formatReceipt(entry), /1 unverified/);
  assert.match(formatReceipt(entry), /not-assessed\s+runtime/);
});

test("network consent defaults off in diagnostic metadata", () => {
  const entry = createSuccessDiagnostic({
    report,
    sourceMode: "local",
    sourceValue: "/home/tom/signals",
    gitRef: "",
    packs: ["secure-build"],
    elapsedMs: 10,
  });
  assert.equal(entry.options.networkedDependencyScan, false);
  assert.match(formatReceipt(entry), /dependency network scan: off/);
});

test("failure diagnostics redact common secret shapes", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
  const entry = createFailureDiagnostic({
    sourceMode: "github",
    sourceValue: "https://token@github.com/tomcwxyz/private-repo",
    gitRef: "main",
    packs: ["secure-build"],
    options: { networkedDependencyScan: false },
    elapsedMs: 50,
    engineVersion: "0.0.0-alpha.6",
    error: `clone failed with ${secret}`,
  });

  assert.equal(entry.source.label, "tomcwxyz/private-repo");
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(secret));
  assert.match(entry.error, /redacted-openai-key/);
});

test("diagnostic history is capped to the newest 100 entries", () => {
  const storage = memoryStorage();
  for (let index = 0; index < 105; index += 1) {
    appendDiagnostic(storage, { schemaVersion: "1", event: "scan-completed", timestamp: String(index) });
  }
  const entries = readDiagnostics(storage);
  assert.equal(entries.length, 100);
  assert.equal(entries[0].timestamp, "5");
  assert.equal(entries.at(-1).timestamp, "104");
  assert.match(formatDiagnostics(entries), /source contents, evidence excerpts or matched secret values/);
});
