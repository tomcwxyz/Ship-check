import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFocusedReview, focusedReviewCopy } from "./focus.js";

const finding = {
  type: "finding",
  action: "fix",
  id: "finding-1",
  checkId: "secure.example",
  checkVersion: "2",
  severity: "high",
  title: "Example finding",
  summary: "A confirmed concern.",
  evidence: [],
  fix: "Make the narrow repair.",
  verify: "Run the relevant regression test.",
  agentPrompt: "Repair only the confirmed issue.",
};

const question = {
  type: "unverified",
  action: "verify",
  id: "gap-1",
  checkId: "production.example",
  checkVersion: "3",
  title: "Example question",
  summary: "The available evidence cannot establish this control.",
  evidence: [],
  verify: "Inspect the configured boundary.",
};

test("focused review validation preserves FIX and VERIFY semantics", () => {
  assert.equal(assertFocusedReview(finding).action, "fix");
  assert.equal(assertFocusedReview(question).action, "verify");
  assert.equal(
    assertFocusedReview({ type: "none", action: "none", summary: "Nothing active." }).type,
    "none",
  );
  assert.throws(
    () => assertFocusedReview({ type: "unverified", action: "fix", summary: "wrong" }),
    /unexpected focused review/,
  );
});

test("copy text keeps unanswered controls distinct from confirmed repairs", () => {
  const repair = focusedReviewCopy(finding);
  assert.match(repair, /Action: FIX/);
  assert.match(repair, /Repair only the confirmed issue/);
  assert.match(repair, /rerun Ship Check/);

  const verify = focusedReviewCopy(question);
  assert.match(verify, /Action: VERIFY/);
  assert.match(verify, /not a confirmed defect/);
  assert.doesNotMatch(verify, /Action: FIX/);
});
