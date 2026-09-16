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

test('secret findings in test or example material explain the uncertainty without dismissing the match', () => {
  const item = {id:'secret:test',checkId:'secure.secret-pattern',title:'Possible key',summary:'Gitleaks match',evidence:[{path:'src/lib/auth/config.test.ts',line:22,detail:'Secret value redacted'}],remediation:{why:'Risk',fix:'Rotate it',verify:'Rerun',agentPrompt:'Do not reveal the key'}};
  const review = reviewFinding(item);
  assert.match(review.title, /test or example material/);
  assert.match(review.summary, /may be deliberately synthetic/);
  assert.match(review.why, /real keys/);
  assert.match(review.next, /confirm the value is deliberately synthetic/);
  assert.match(review.repairInstructions, /config\.test\.ts:22/);
});

test('workflow findings keep their specific plain-language title and summary', () => {
  const item = {id:'workflow:1',checkId:'production.github-actions-supply-chain',title:'Workflow grants broad write access',summary:'release.yml declares permissions: write-all.',evidence:[],remediation:{why:'Technical why',fix:'Technical fix',verify:'Run it',agentPrompt:'Repair it'}};
  const review = reviewFinding(item);
  assert.equal(review.title, 'Workflow grants broad write access');
  assert.match(review.summary, /write-all/);
  assert.match(review.why, /Build and release workflows/);
  assert.match(review.next, /specific workflow boundary/);
});

test('an empty report is not described as safe and disabled checks remain visible', () => {
  const summary = reviewSummary({summary:{total:0},gaps:[],checks:[{checkId:'next',status:'not-applicable'}]});
  assert.match(summary.title, /No confirmed issues/);
  assert.match(summary.detail, /does not prove/);
  assert.match(summary.optional, /vulnerabilities were not checked/);
});

test('unverified questions remain prominent when there are no findings', () => {
  const summary = reviewSummary({summary:{total:0},gaps:[{id:'question'}],checks:[]});
  assert.match(summary.title, /1 question still needs checking/);
});

test('execution failures take priority over reassuring issue counts', () => {
  assert.match(reviewSummary({summary:{total:0},checks:[{status:'error'}]}).title, /could not finish/);
});
