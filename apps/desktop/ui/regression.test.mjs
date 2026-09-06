import assert from "node:assert/strict";
import test from "node:test";
import { compareFindingFingerprints, createFindingFingerprintSummary, findPreviousComparableScan, fingerprintFinding } from "./regression.js";

const finding = (overrides = {}) => ({ checkId: "secure.tracked-env-file", title: "Sensitive environment file is tracked", severity: "high", evidence: [{ path: ".env", line: 1 }], ...overrides });

test("fingerprints ignore evidence line changes but distinguish paths", () => {
  assert.equal(fingerprintFinding(finding()), fingerprintFinding(finding({ evidence: [{ path: ".env", line: 22 }] })));
  assert.notEqual(fingerprintFinding(finding()), fingerprintFinding(finding({ evidence: [{ path: "apps/web/.env", line: 1 }] })));
});

test("fingerprint summary keeps only opaque identity metadata", () => {
  const summary = createFindingFingerprintSummary({ findings: [finding(), finding({ evidence: [{ path: ".env", line: 8 }] })] });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].count, 2);
  assert.match(summary[0].fingerprint, /^f1:[0-9a-f]{8}$/);
  assert.equal(JSON.stringify(summary).includes(".env"), false);
});

test("comparable scan selection respects source, ref and pack set", () => {
  const current = { event: "scan-completed", source: { kind: "github", label: "tom/repo", ref: "main" }, packs: ["secure-build", "cost-aware"] };
  const entries = [
    { ...current, timestamp: "old" },
    { ...current, source: { ...current.source, ref: "dev" }, timestamp: "wrong-ref" },
  ];
  assert.equal(findPreviousComparableScan(entries, current)?.timestamp, "old");
});

test("delta reports new resolved and unchanged counts", () => {
  const previous = { timestamp: "before", summary: { total: 3 }, findingFingerprints: [{ fingerprint: "a", count: 2 }, { fingerprint: "b", count: 1 }] };
  const current = { summary: { total: 3 }, findingFingerprints: [{ fingerprint: "a", count: 1 }, { fingerprint: "c", count: 2 }] };
  assert.deepEqual(compareFindingFingerprints(current, previous), { status: "previous-scan", baselineTimestamp: "before", newCount: 2, resolvedCount: 2, unchangedCount: 1 });
});
