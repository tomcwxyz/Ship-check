import assert from "node:assert/strict";
import test from "node:test";
import { summariseReview } from "./overview.js";

function report(overrides = {}) {
  return { findings: [], gaps: [], checks: [], coverage: [
    {area: "secrets", status:"partial"}, {area:"runtime",status:"not-assessed"}
  ], ...overrides };
}

test("confirmed findings take priority without hiding uncovered areas", () => {
  const result = summariseReview(report({
    findings: [{
      checkId: "cost.frequent-network-polling", title: "Poll", summary:"Repeating", severity:"high",
      evidence: [], remediation: {why:"",fix:"Reduce frequency",verify:"Check volume",agentPrompt:""}
    }],
    gaps: [{title:"Verify webhooks",verify:"Review deployed webhook"}]
  }));
  assert.equal(result.next.target, "review-findings");
  assert.equal(result.notChecked.length, 1);
  assert.equal(result.gaps.length, 1);
});

test("check failures are unknown, not successful checks", () => {
  const result = summariseReview(report({checks: [{checkId:"runtime.test",status:"error"}]}));
  assert.equal(result.errors.length, 1);
  assert.equal(result.next.target, "review-checks");
});

test("a scan with no assessed areas never reads as clear", () => {
  const result = summariseReview(report({ coverage: [{area: "runtime", status: "not-assessed"}] }));
  assert.match(result.headline, /not enough/);
  assert.equal(result.next.target, "review-coverage");
});

test("a scan with no active findings still explains its coverage", () => {
  const result = summariseReview(report());
  assert.match(result.headline, /not enough/);
  assert.equal(result.next.target, "review-coverage");
});
