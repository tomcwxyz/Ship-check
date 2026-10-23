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

test("a partly assessed scan can report no findings in areas checked", () => {
  const result = summariseReview(report());
  assert.match(result.headline, /No findings in the areas checked/);
  assert.equal(result.next.target, "review-coverage");
});

test("missing coverage records do not claim that checks completed", () => {
  const result = summariseReview(report({coverage: []}));
  assert.match(result.headline, /not enough/);
  assert.equal(result.completed.length, 0);
});

test("verified controls are visible as positives, unrelated observations remain context", () => {
  const result = summariseReview(report({
    observations: [
      { kind:"verified-control", title:"Webhook signature checked", evidence:[{kind:"configuration",detail:"Valid signature verifier"}] },
      { kind:"inventory", title:"Webhook route seen", evidence:[{kind:"configuration",detail:"Route found"}] },
      { kind:"verified-control", title:"Missing evidence", evidence:[] }
    ],
    checks: [{ checkId:"header.test", status:"passed" }]
  }));
  assert.equal(result.verified.length, 1);
  assert.equal(result.verified[0].title, "Webhook signature checked");
  assert.equal(result.noted.length, 2);
  assert.match(result.headline, /No findings/);
});

test("a passed check alone never becomes a claimed verified protection", () => {
  const result = summariseReview(report({
    checks:[{ checkId:"secure.secret-pattern", status:"passed" }],
    observations:[{ kind:"inventory", title:"Some source files found", evidence:[{detail:"Source"}] }]
  }));
  assert.equal(result.verified.length, 0);
  assert.equal(result.noted.length, 1);
  assert.equal(result.completed.length, 0);
});

test("verified observations do not mask findings or incomplete evidence", () => {
  const result = summariseReview(report({
    findings: [{title:"Missing signature",severity:"high",remediation:{why:"",fix:"Check",verify:"Verify",agentPrompt:""},evidence:[]}],
    observations:[{kind:"verified-control",title:"Separate verified control",evidence:[{detail:"Observed"}]}],
    gaps:[{title:"Unverified database",verify:"Check"}]
  }));
  assert.equal(result.next.target,"review-findings");
  assert.equal(result.verified.length,1);
  assert.equal(result.gaps.length,1);
});
