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
  tool: { version: "0.0.0-alpha.4" },
  project: { gitRepository: true, inventorySource: "git-tracked", fileCount: 94 },
  summary: { total: 2, critical: 0, high: 1, medium: 0, low: 1, info: 0 },
  checks: [
    { checkId: "secure.tracked-env-file", pack: "secure-build", status: "findings", findingCount: 1, durationMs: 4 },
    { checkId: "production.next-security-headers", pack: "production-ready", status: "findings", findingCount: 1, durationMs: 2 },
    { checkId: "cost.frequent-network-polling", pack: "cost-aware", status: "passed", findingCount: 0, durationMs: 1 },
  ],
};

test("local source labels do not retain the full machine path", () => {
  assert.equal(safeSourceLabel("local", "C:\\Users\\tom\\signals"), "signals");
  assert.equal(safeSourceLabel("local", "/home/tom/signals"), "signals");
});

test("successful diagnostics keep scan metadata but not findings or evidence", () => {
  const entry = createSuccessDiagnostic({
    report,
    sourceMode: "local",
    sourceValue: "C:\\Users\\tom\\signals",
    gitRef: "",
    packs: ["secure-build", "production-ready", "cost-aware"],
    elapsedMs: 123.6,
  });

  assert.equal(entry.source.label, "signals");
  assert.equal(entry.fileCount, 94);
  assert.equal(entry.inventorySource, "git-tracked");
  assert.equal(entry.elapsedMs, 124);
  assert.equal(entry.checks.length, 3);
  assert.equal("findings" in entry, false);
  assert.equal("evidence" in entry, false);
  assert.match(formatReceipt(entry), /94 files · 3 checks · git-tracked/);
});

test("failure diagnostics redact common secret shapes", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
  const entry = createFailureDiagnostic({
    sourceMode: "github",
    sourceValue: "https://token@github.com/tomcwxyz/private-repo",
    gitRef: "main",
    packs: ["secure-build"],
    elapsedMs: 50,
    engineVersion: "0.0.0-alpha.4",
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
