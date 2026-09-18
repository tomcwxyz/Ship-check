import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDiagnostic,
  compareWithPreviousDiagnostics,
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

const suppressedRationale = "Accepted temporarily because this exact scheduler is measured and deliberately lightweight.";
const report = {
  generatedAt: "2026-09-04T19:45:00.000Z",
  tool: { version: "0.0.0-alpha.7" },
  project: {
    gitRepository: true,
    inventorySource: "git-tracked",
    fileCount: 94,
    snapshot: {
      inventory: {
        fingerprint: {
          algorithm: "sha256",
          scope: "source-inventory-v1",
          value: "a".repeat(64),
          completeness: "complete",
          entryCount: 94,
          hashedEntryCount: 94,
          skippedEntryCount: 0,
        },
      },
    },
  },
  summary: { total: 1, suppressed: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 },
  findings: [
    { id: "secure.secret-pattern:src/private.ts:2:OpenAI-style API key" },
  ],
  suppressedFindings: [{
    finding: {
      id: "cost.vercel-cron-frequency:0:/api/private",
      checkId: "cost.vercel-cron-frequency",
      pack: "cost-aware",
      title: "Frequent cron",
      summary: "Private suppressed detail",
      severity: "medium",
      confidence: "high",
      evidence: [{ kind: "configuration", path: "vercel.json", detail: "Private suppressed evidence" }],
      remediation: { why: "why", fix: "fix", verify: "verify", agentPrompt: "prompt" },
    },
    checkVersion: "2",
    rationale: suppressedRationale,
    configPath: ".ship-check.json",
  }],
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
  observations: [
    {
      id: "production.server-surface-inventory:api-routes",
      checkId: "production.server-surface-inventory",
      pack: "production-ready",
      area: "access-control",
      kind: "inventory",
      title: "Server request surfaces discovered",
      summary: "2 API routes found",
      evidence: [
        { kind: "file-presence", path: "app/api/private/route.ts", detail: "Repository-visible request surface." },
      ],
    },
  ],
  coverage: [
    { area: "secrets", status: "assessed", checkIds: ["secure.secret-pattern"], detail: "Assessed" },
    { area: "runtime", status: "not-assessed", checkIds: [], detail: "Not assessed" },
  ],
  checks: [
    { checkId: "secure.secret-pattern", checkVersion: "1", pack: "secure-build", status: "findings", findingCount: 1, suppressedCount: 0, gapCount: 0, observationCount: 0, durationMs: 4 },
    { checkId: "production.next-security-headers", checkVersion: "1", pack: "production-ready", status: "unverified", findingCount: 0, suppressedCount: 0, gapCount: 1, observationCount: 0, durationMs: 2 },
    { checkId: "production.server-surface-inventory", checkVersion: "2", pack: "production-ready", status: "passed", findingCount: 0, suppressedCount: 0, gapCount: 0, observationCount: 1, durationMs: 2 },
    { checkId: "cost.vercel-cron-frequency", checkVersion: "2", pack: "cost-aware", status: "suppressed", findingCount: 0, suppressedCount: 1, gapCount: 0, observationCount: 0, durationMs: 1 },
  ],
};

test("local and archive source labels do not retain the full machine path", () => {
  assert.equal(safeSourceLabel("local", "C:\\Users\\tom\\signals"), "signals");
  assert.equal(safeSourceLabel("local", "/home/tom/signals"), "signals");
  assert.equal(safeSourceLabel("archive", "C:\\Users\\tom\\lovable-export.zip"), "lovable-export.zip");
});

test("runtime source labels retain only the host, not path or query strings", () => {
  assert.equal(safeSourceLabel("runtime", "https://example.com/private?token=secret"), "example.com");
  assert.equal(safeSourceLabel("runtime", "https://example.com:8443/app"), "example.com:8443");
});

test("successful diagnostics keep scan consent, counts and rule versions but not suppressed or observed details", async () => {
  const entry = await createSuccessDiagnostic({
    report,
    sourceMode: "local",
    sourceValue: "C:\\Users\\tom\\signals",
    gitRef: "",
    packs: ["secure-build", "production-ready", "cost-aware"],
    options: { localSemgrepScan: true, networkedDependencyScan: true, deploymentUrl: "https://example.com/private?token=secret" },
    elapsedMs: 123.6,
  });

  assert.equal(entry.source.label, "signals");
  assert.match(entry.source.identity, /^[a-f0-9]{64}$/);
  assert.equal(entry.source.fingerprint.value, "a".repeat(64));
  assert.equal(entry.source.fingerprint.completeness, "complete");
  assert.equal(entry.findingIdentities.length, 1);
  assert.equal(entry.gapIdentities.length, 1);
  assert.match(entry.findingIdentities[0], /^[a-f0-9]{64}$/);
  assert.match(entry.gapIdentities[0], /^[a-f0-9]{64}$/);
  assert.equal(entry.fileCount, 94);
  assert.equal(entry.inventorySource, "git-tracked");
  assert.equal(entry.elapsedMs, 124);
  assert.equal(entry.options.localSemgrepScan, true);
  assert.equal(entry.options.networkedDependencyScan, true);
  assert.equal(entry.options.deploymentEvidence, true);
  assert.equal(entry.suppressedCount, 1);
  assert.equal(entry.unverifiedCount, 1);
  assert.equal(entry.resolvedCount, 0);
  assert.equal(entry.notAssessedCount, 0);
  assert.equal(entry.observedCount, 1);
  assert.equal(entry.coverage.length, 2);
  assert.equal(entry.checks[1].gapCount, 1);
  assert.equal(entry.checks[1].resolvedGapCount, 0);
  assert.equal(entry.checks[2].observationCount, 1);
  assert.equal(entry.checks[2].checkVersion, "2");
  assert.equal(entry.checks[3].checkVersion, "2");
  assert.equal(entry.checks[3].suppressedCount, 1);
  assert.equal("findings" in entry, false);
  assert.equal("suppressedFindings" in entry, false);
  assert.equal("observations" in entry, false);
  assert.equal("evidence" in entry, false);
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(suppressedRationale));
  assert.doesNotMatch(JSON.stringify(entry), /Private suppressed detail/);
  assert.doesNotMatch(JSON.stringify(entry), /app\/api\/private\/route\.ts/);
  assert.doesNotMatch(JSON.stringify(entry), /Server request surfaces discovered/);
  assert.doesNotMatch(JSON.stringify(entry), /token=secret/);
  assert.doesNotMatch(JSON.stringify(entry), /C:\\Users\\tom\\signals/);
  assert.doesNotMatch(JSON.stringify(entry), /secure\.secret-pattern:src\/private\.ts/);
  assert.doesNotMatch(JSON.stringify(entry), /production\.next-security-headers:next\.config\.ts/);
  assert.match(formatReceipt(entry), /94 files · 4 checks · git-tracked/);
  assert.match(formatReceipt(entry), /live deployment evidence: on/);
  assert.match(formatReceipt(entry), /local Semgrep scan: on/);
  assert.match(formatReceipt(entry), /dependency network scan: on/);
  assert.match(formatReceipt(entry), /1 suppressed findings/);
  assert.match(formatReceipt(entry), /cost\.vercel-cron-frequency@2/);
  assert.match(formatReceipt(entry), /1 unverified · 0 resolved by other evidence · 0 resolved questions · 0 not assessed · 1 observed/);
  assert.match(formatReceipt(entry), /not-assessed\s+runtime/);
});

test("resolved question diagnostics keep counts but not resolved-gap details", async () => {
  const privateResolutionSummary = "Private resolution detail that must not be stored.";
  const resolvedReport = {
    ...report,
    gaps: [],
    resolvedGaps: [{
      gap: {
        ...report.gaps[0],
        summary: "Private source question detail.",
        verify: "Private checking instructions.",
      },
      resolvedByObservationIds: ["runtime.response-security-headers:verified"],
      resolvedByCheckIds: ["runtime.response-security-headers"],
      summary: privateResolutionSummary,
    }],
    checks: report.checks.map((check) => check.checkId === "production.next-security-headers"
      ? { ...check, status: "resolved", gapCount: 0, resolvedGapCount: 1 }
      : check),
  };

  const entry = await createSuccessDiagnostic({
    report: resolvedReport,
    sourceMode: "local",
    sourceValue: "/home/tom/signals",
    packs: ["production-ready"],
    options: { deploymentUrl: "https://example.com" },
    elapsedMs: 40,
  });

  assert.equal(entry.resolvedCount, 1);
  assert.equal(entry.unverifiedCount, 0);
  assert.equal(entry.checks.find((check) => check.checkId === "production.next-security-headers").resolvedGapCount, 1);
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(privateResolutionSummary));
  assert.doesNotMatch(JSON.stringify(entry), /Private source question detail/);
  assert.doesNotMatch(JSON.stringify(entry), /Private checking instructions/);
  assert.match(formatReceipt(entry), /1 resolved by other evidence · 1 resolved questions/);
  assert.match(formatReceipt(entry), /production\.next-security-headers@1 · 0 findings · 0 suppressed · 0 gaps · 1 resolved gaps/);
});

test("deep and deployment scan consent defaults off in diagnostic metadata", async () => {
  const entry = await createSuccessDiagnostic({
    report,
    sourceMode: "local",
    sourceValue: "/home/tom/signals",
    gitRef: "",
    packs: ["secure-build"],
    elapsedMs: 10,
  });
  assert.equal(entry.options.localSemgrepScan, false);
  assert.equal(entry.options.networkedDependencyScan, false);
  assert.equal(entry.options.deploymentEvidence, false);
  assert.match(formatReceipt(entry), /live deployment evidence: off/);
  assert.match(formatReceipt(entry), /local Semgrep scan: off/);
  assert.match(formatReceipt(entry), /dependency network scan: off/);
});

test("comparable scans report new, persistent and resolved findings and gaps without raw IDs", async () => {
  const baselineReport = {
    ...report,
    findings: [
      { id: "secure.secret-pattern:src/persistent.ts:2:key" },
      { id: "secure.wildcard-cors:src/resolved.ts" },
    ],
    gaps: [
      { id: "production.next-security-headers:next.config.ts" },
      { id: "secure.webhook-signature-verification:app/api/old/route.ts" },
    ],
  };
  const currentReport = {
    ...report,
    project: {
      ...report.project,
      snapshot: {
        inventory: {
          fingerprint: {
            ...report.project.snapshot.inventory.fingerprint,
            value: "b".repeat(64),
          },
        },
      },
    },
    findings: [
      { id: "secure.secret-pattern:src/persistent.ts:2:key" },
      { id: "secure.paid-endpoint-abuse-control:app/api/new/route.ts" },
    ],
    gaps: [
      { id: "production.next-security-headers:next.config.ts" },
      { id: "secure.vercel-cron-auth:app/api/cron/route.ts" },
    ],
  };

  const baseline = await createSuccessDiagnostic({
    report: baselineReport,
    sourceMode: "local",
    sourceValue: "/home/tom/project",
    packs: ["secure-build", "production-ready", "cost-aware"],
    elapsedMs: 10,
  });
  const current = await createSuccessDiagnostic({
    report: currentReport,
    sourceMode: "local",
    sourceValue: "/home/tom/project",
    packs: ["secure-build", "production-ready", "cost-aware"],
    elapsedMs: 12,
  });

  const comparison = compareWithPreviousDiagnostics([baseline], current);

  assert.deepEqual(comparison.findings, { introduced: 1, persistent: 1, resolved: 1 });
  assert.deepEqual(comparison.gaps, { introduced: 1, persistent: 1, resolved: 1 });
  assert.equal(comparison.snapshot, "changed");
  assert.equal(comparison.baselineTimestamp, baseline.timestamp);
  assert.doesNotMatch(JSON.stringify(comparison), /persistent\.ts|resolved\.ts|new\/route|next\.config/);
});

test("equal partial source fingerprints stay uncertain rather than claiming identical snapshots", async () => {
  const partialReport = {
    ...report,
    project: {
      ...report.project,
      snapshot: {
        inventory: {
          fingerprint: {
            ...report.project.snapshot.inventory.fingerprint,
            completeness: "partial",
            hashedEntryCount: 93,
            skippedEntryCount: 1,
          },
        },
      },
    },
  };
  const baseline = await createSuccessDiagnostic({
    report: partialReport,
    sourceMode: "archive",
    sourceValue: "/tmp/project.zip",
    packs: ["production-ready"],
    elapsedMs: 5,
  });
  const current = await createSuccessDiagnostic({
    report: partialReport,
    sourceMode: "archive",
    sourceValue: "/tmp/project.zip",
    packs: ["production-ready"],
    elapsedMs: 6,
  });

  const comparison = compareWithPreviousDiagnostics([baseline], current);
  assert.equal(comparison.snapshot, "uncertain");
});

test("failure diagnostics redact common secret shapes", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
  const entry = createFailureDiagnostic({
    sourceMode: "github",
    sourceValue: "https://token@github.com/tomcwxyz/private-repo",
    gitRef: "main",
    packs: ["secure-build"],
    options: { localSemgrepScan: true, networkedDependencyScan: false },
    elapsedMs: 50,
    engineVersion: "0.0.0-alpha.7",
    error: `clone failed with ${secret}`,
  });

  assert.equal(entry.source.label, "tomcwxyz/private-repo");
  assert.equal(entry.options.localSemgrepScan, true);
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
  assert.match(formatDiagnostics(entries), /suppression rationales\/finding details/);
  assert.match(formatDiagnostics(entries), /resolved-question details/);
  assert.match(formatDiagnostics(entries), /observation paths\/details/);
  assert.match(formatDiagnostics(entries), /source contents/);
  assert.match(formatDiagnostics(entries), /deployment URL paths\/query strings/);
  assert.match(formatDiagnostics(entries), /raw finding\/gap IDs/);
  assert.match(formatDiagnostics(entries), /SHA-256 digests/);
});

test('diagnostics retain resolved commit and scanner version without finding details', async () => {
  const entry = await createSuccessDiagnostic({ report: {...report, project:{...report.project,commit:'a'.repeat(40)},checks:[{checkId:'secure.secret-pattern',scannerVersion:'8.30.1',status:'passed',findingCount:0,durationMs:1}]}, sourceMode:'github',sourceValue:'owner/repo',packs:[],elapsedMs:1 });
  assert.equal(entry.source.commit, 'a'.repeat(40));
  assert.equal(entry.checks[0].scannerVersion, '8.30.1');
  assert.equal(entry.findings, undefined);
});
