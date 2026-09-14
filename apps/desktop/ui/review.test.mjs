import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewFinding, reviewSummary } from './review.js';

test('repair instructions preserve location, uncertainty and acceptance test', () => {
  const item = {id:'test:1',checkId:'secure.secret-pattern',title:'Possible key',summary:'Unconfirmed',evidence:[{path:'src/client.js',line:4,detail:'Value redacted'}],remediation:{why:'Risk',fix:'Identify type',verify:'Check permissions',agentPrompt:'Do not reveal the key'}};
  const review = reviewFinding(item);
  assert.match(review.repairInstructions, /src\/client.js:4/);
  assert.match(review.repairInstructions, /Check permissions/);
  assert.match(review.repairInstructions, /Unconfirmed/);
  assert.match(review.next, /public keys/);
});
test('an empty report is not described as safe and disabled checks remain visible', () => {
  const summary = reviewSummary({summary:{total:0},gaps:[],checks:[{checkId:'next',status:'not-applicable'}]});
  assert.match(summary.title, /0 potential issues/);
  assert.match(summary.detail, /do not establish/);
  assert.match(summary.optional, /vulnerabilities were not checked/);
});
test('execution failures take priority over reassuring issue counts', () => {
  assert.match(reviewSummary({summary:{total:0},checks:[{status:'error'}]}).title, /could not finish/);
});
