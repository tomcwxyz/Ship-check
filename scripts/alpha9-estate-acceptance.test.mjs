import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateEstate } from "./alpha9-estate-acceptance.mjs";

function report({ findings = [], gaps = [], checks = [] } = {}) {
  return {
    project: {},
    findings,
    gaps,
    checks,
    coverage: [],
  };
}

function estate(projects) {
  return {
    projectCount: projects.length,
    scannedCount: projects.filter((project) => project.status === "scanned").length,
    failedCount: projects.filter((project) => project.status === "failed").length,
    summary: { scannerUnavailable: 0 },
    projects,
  };
}

function focusSelector(scan) {
  if (scan.findings.length > 0) {
    return { type: "finding", action: "fix", id: "f", title: "Fix me" };
  }
  if (scan.gaps.length > 0) {
    return { type: "unverified", action: "verify", id: "g", title: "Check me" };
  }
  return { type: "none", action: "none", summary: "Nothing active." };
}

test("estate acceptance keeps ordering neutral and validates focused handoff", () => {
  const input = estate([
    {
      relativePath: "z-project",
      status: "scanned",
      report: report({ findings: [{ id: "f", checkId: "secure.x", title: "X", evidence: [] }] }),
    },
    {
      relativePath: "a-project",
      status: "scanned",
      report: report({ gaps: [{ id: "g", checkId: "production.x", title: "G" }] }),
    },
  ]);
  const markdown = [
    "# Ship Check estate review",
    "",
    "## Projects needing attention",
    "",
    "### a-project",
    "",
    "### z-project",
  ].join("\n");

  const result = evaluateEstate(input, markdown, focusSelector);
  assert.equal(result.checks.every((check) => check.status === "pass"), true);
  assert.deepEqual(
    result.focusSummaries.map((item) => [item.project, item.action]),
    [["z-project", "fix"], ["a-project", "verify"]],
  );
});

test("estate acceptance catches hidden score fields and ignored-directory roots", () => {
  const input = estate([
    {
      relativePath: "node_modules/noise",
      status: "scanned",
      report: report(),
      attentionScore: 99,
    },
  ]);
  const result = evaluateEstate(input, "# Ship Check estate review\n\n## Projects needing attention\n", focusSelector);
  const byId = new Map(result.checks.map((check) => [check.id, check]));
  assert.equal(byId.get("ignored-directories")?.status, "fail");
  assert.equal(byId.get("no-score-contract")?.status, "fail");
});


test("check-error-only projects are reviewed but do not become FIX or VERIFY work", () => {
  const input = estate([
    {
      relativePath: "check-error-project",
      status: "scanned",
      report: report({ checks: [{ status: "error" }] }),
    },
  ]);
  const markdown = [
    "# Ship Check estate review",
    "",
    "## Projects needing attention",
    "",
    "### check-error-project",
  ].join("\n");

  const result = evaluateEstate(input, markdown, focusSelector);
  assert.equal(result.checks.find((check) => check.id === "neutral-order")?.status, "pass");
  assert.deepEqual(result.focusSummaries, []);
});
