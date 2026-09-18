import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFailureDiagnostic, createSuccessDiagnostic, formatDiagnostics } from "./diagnostics.js";

const secretUrl = "postgresql://reader:very-secret@example.neon.tech/app?sslmode=require";

const report = {
  generatedAt: "2026-09-18T17:30:00.000Z",
  tool: { version: "0.0.0-alpha.7" },
  project: {
    gitRepository: false,
    inventorySource: "filesystem",
    fileCount: 0,
    evidenceSources: [{ provider: "neon", type: "database" }],
  },
  summary: { total: 0, suppressed: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  suppressedFindings: [],
  gaps: [],
  observations: [],
  coverage: [],
  checks: [],
};

test("database diagnostics retain consent metadata but never the connection string", async () => {
  const entry = await createSuccessDiagnostic({
    report,
    sourceMode: "runtime",
    sourceValue: "https://example.com/app",
    packs: ["production-ready"],
    options: {
      databaseInspection: true,
      databasePlatform: "neon",
      databaseTableLimit: 250,
      databaseConnectionString: secretUrl,
    },
    elapsedMs: 12,
  });

  assert.equal(entry.options.databaseInspection, true);
  assert.equal(entry.options.databasePlatform, "neon");
  assert.equal(entry.options.databaseTableLimit, 250);
  assert.equal("databaseConnectionString" in entry.options, false);
  assert.doesNotMatch(JSON.stringify(entry), /very-secret|example\.neon\.tech/);
  assert.match(formatDiagnostics([entry]), /database connection URLs\/credentials/);
});

test("database URLs in failure messages are redacted", () => {
  const entry = createFailureDiagnostic({
    sourceMode: "local",
    sourceValue: "/tmp/project",
    packs: ["production-ready"],
    options: { databaseInspection: true, databasePlatform: "postgres", databaseTableLimit: 1000 },
    elapsedMs: 20,
    engineVersion: "0.0.0-alpha.7",
    error: `Database metadata inspection failed for ${secretUrl}`,
  });

  assert.match(entry.error, /redacted-database-url/);
  assert.doesNotMatch(JSON.stringify(entry), /very-secret|example\.neon\.tech/);
});

test("desktop keeps the database credential out of persistent application state", async () => {
  const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const stateBlock = app.match(/const state = \{[\s\S]*?\n\};/)?.[0] ?? "";

  assert.doesNotMatch(stateBlock, /databaseConnectionString|database.*url/i);
  assert.match(app, /const databaseConnectionString = options\.databaseInspection/);
  assert.match(app, /elements\.databaseConnectionString\.value = ""/);
  assert.match(html, /id="database-connection-string" type="password"/);
  assert.doesNotMatch(html, new RegExp(secretUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
