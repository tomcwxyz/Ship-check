import assert from "node:assert/strict";
import test from "node:test";
import { compareReports, formatPullRequestComparison } from "./github-action-comparison.mjs";

function finding(id, title, severity = "high") {
  return { id, title, severity };
}

function gap(id, title, area = "access-control") {
  return { id, title, area };
}

function observation(id, title, kind = "inventory", area = "code-security") {
  return { id, title, kind, area };
}

function report(overrides = {}) {
  return {
    tool: { name: "ship-check", version: "test" },
    packs: ["secure-build", "production-ready"],
    ruleset: {
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      value: "f".repeat(64),
      checkCount: 2,
    },
    checks: [
      { checkId: "secure.example", checkVersion: "1" },
      { checkId: "production.example", checkVersion: "2" },
    ],
    findings: [],
    suppressedFindings: [],
    gaps: [],
    observations: [],
    project: {
      snapshot: {
        inventory: {
          fingerprint: {
            value: "a".repeat(64),
            completeness: "complete",
          },
        },
      },
    },
    ...overrides,
  };
}

test("compares active, accepted, gap and inventory-surface transitions", () => {
  const base = report({
    findings: [
      finding("persistent", "Persistent finding"),
      finding("old", "Old finding"),
      finding("accepted-next", "Will be accepted"),
    ],
    suppressedFindings: [
      { finding: finding("reactivated", "Was accepted") },
    ],
    gaps: [
      gap("gap-persistent", "Persistent unanswered control"),
      gap("gap-old", "Old unanswered control"),
    ],
    observations: [
      observation("surface-persistent", "Persistent route"),
      observation("surface-old", "Old route"),
      observation("verified-old", "Verified control", "verified-control"),
    ],
  });

  const current = report({
    findings: [
      finding("persistent", "Persistent finding"),
      finding("new", "New finding", "critical"),
      finding("reactivated", "Was accepted"),
    ],
    suppressedFindings: [
      { finding: finding("accepted-next", "Will be accepted") },
    ],
    gaps: [
      gap("gap-persistent", "Persistent unanswered control"),
      gap("gap-new", "New unanswered control"),
    ],
    observations: [
      observation("surface-persistent", "Persistent route"),
      observation("surface-new", "New route"),
      observation("verified-new", "New verified control", "verified-control"),
    ],
    project: {
      snapshot: {
        inventory: {
          fingerprint: {
            value: "b".repeat(64),
            completeness: "complete",
          },
        },
      },
    },
  });

  const comparison = compareReports(base, current);

  assert.equal(comparison.comparable, true);
  assert.equal(comparison.sourceSnapshot, "changed");
  assert.deepEqual(comparison.findings.introduced.map((item) => item.id), ["new"]);
  assert.deepEqual(comparison.findings.persistent.map((item) => item.id), ["persistent"]);
  assert.deepEqual(comparison.findings.reactivated.map((item) => item.id), ["reactivated"]);
  assert.deepEqual(comparison.findings.accepted.map((item) => item.id), ["accepted-next"]);
  assert.deepEqual(comparison.findings.noLongerActive.map((item) => item.id), ["old"]);
  assert.deepEqual(comparison.gaps.introduced.map((item) => item.id), ["gap-new"]);
  assert.deepEqual(comparison.gaps.noLongerActive.map((item) => item.id), ["gap-old"]);
  assert.deepEqual(comparison.surfaces.introduced.map((item) => item.id), ["surface-new"]);
  assert.deepEqual(comparison.surfaces.noLongerActive.map((item) => item.id), ["surface-old"]);
});

test("equal partial fingerprints remain uncertain", () => {
  const base = report({
    project: { snapshot: { inventory: { fingerprint: { value: "c".repeat(64), completeness: "partial" } } } },
  });
  const current = report({
    project: { snapshot: { inventory: { fingerprint: { value: "c".repeat(64), completeness: "partial" } } } },
  });
  assert.equal(compareReports(base, current).sourceSnapshot, "uncertain");
});

test("ruleset fingerprint drift makes scans non-comparable", () => {
  const base = report();
  const current = report({
    ruleset: {
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      value: "e".repeat(64),
      checkCount: 2,
    },
  });
  const comparison = compareReports(base, current);
  assert.equal(comparison.comparable, false);
  assert.match(comparison.reason, /same ruleset/i);
});

test("legacy reports without ruleset provenance fall back to check signatures", () => {
  const base = report();
  const current = report();
  delete base.ruleset;
  delete current.ruleset;

  assert.equal(compareReports(base, current).comparable, true);

  current.checks = current.checks.map((check) =>
    check.checkId === "secure.example"
      ? { ...check, checkVersion: "3" }
      : check
  );
  assert.equal(compareReports(base, current).comparable, false);
});

test("summary is bounded to titles and uses honest state-change language", () => {
  const comparison = compareReports(
    report({ findings: [finding("old-sensitive-id", "Finding removed from active scan")] }),
    report({ findings: [finding("new-sensitive-id", "New active concern", "critical")] }),
  );
  const rendered = formatPullRequestComparison(comparison, {
    baseRef: "main",
    baseSha: "1234567890abcdef1234567890abcdef12345678",
  });

  assert.match(rendered, /Pull request change/);
  assert.match(rendered, /1 new/);
  assert.match(rendered, /1 no longer active/);
  assert.match(rendered, /New active concern/);
  assert.match(rendered, /Finding removed from active scan/);
  assert.match(rendered, /not automatically proof/);
  assert.doesNotMatch(rendered, /new-sensitive-id|old-sensitive-id/);
  assert.match(rendered, /`main` at `12345678`/);
});
