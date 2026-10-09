import { test } from "node:test";
import assert from "node:assert/strict";
import {
  opaqueKey, projectKey, findingKey, checkKey, readReviews, saveReview,
  clearReview, reviewsForProject, reconcileReviews, updateReviewsFromScan,
} from "./finding-reviews.js";

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
}

const finding = { checkId: "cost.frequent-network-polling", id: "cost.frequent-network-polling:src/poller.ts:4" };

async function ids(version = "2") {
  return {
    projectKey: await projectKey("estate", "C:\\Users\\Dev\\projects", "my-app"),
    findingKey: await findingKey(finding, version),
    checkKey: await checkKey(finding.checkId, version),
    ruleId: finding.checkId,
  };
}

test("review keys are opaque, project-scoped and bound to rule version", async () => {
  const a = await ids();
  assert.match(a.projectKey, /^[a-f0-9]{64}$/);
  assert.notEqual(a.projectKey, await projectKey("estate", "C:\\Users\\Dev\\projects", "other-app"));
  assert.equal(a.projectKey, await projectKey("local", "C:\\Users\\Dev\\projects\\my-app"));
  assert.notEqual(a.findingKey, await findingKey(finding, "3"));
  assert.notEqual(a.checkKey, await checkKey(finding.checkId, "3"));
  assert.equal(await opaqueKey("same"), await opaqueKey("same"));
});

test("a review survives a new scan while raw file names and evidence are not persisted", async () => {
  const store = storage(), id = await ids();
  saveReview(store, { ...id, decision: "fixed" }, "2026-10-09T08:00:00Z");
  assert.equal(readReviews(store).length, 1);
  assert.equal(reviewsForProject(store, id.projectKey)[0].decision, "fixed");
  assert.equal(store.getItem("ship-check.finding-reviews.v1").includes("src/poller.ts"), false);
  const report = {
    generatedAt: "2026-10-10T08:00:00Z",
    findings: [finding],
    checks: [{ checkId: finding.checkId, checkVersion: "2", status: "findings" }]
  };
  await updateReviewsFromScan(store, id.projectKey, report);
  assert.equal(readReviews(store)[0].verification, "still-found");
});

test("a resolved code concern only becomes not detected when its exact check ran", async () => {
  const id = await ids();
  const saved = { ...id, decision: "fixed", verification: "pending", updatedAt: "2026-10-09" };
  const allowed = [{ key: id.checkKey, status: "passed" }];
  assert.equal(reconcileReviews([saved], id.projectKey, allowed, [])[0].verification, "not-detected");
  assert.equal(reconcileReviews([saved], id.projectKey, [{...allowed[0],status:"error"}], [])[0].verification, "not-rechecked");
  assert.equal(reconcileReviews([saved], id.projectKey, [{...allowed[0],status:"not-assessed"}], [])[0].verification, "not-rechecked");
  assert.equal(reconcileReviews([saved], id.projectKey, [{...allowed[0],status:"unverified"}], [])[0].verification, "not-rechecked");
  assert.equal(reconcileReviews([saved], id.projectKey, [], [])[0].verification, "not-rechecked");
  assert.equal(reconcileReviews([saved], id.projectKey, allowed, [], [id.findingKey])[0].verification, "still-found");
  assert.equal(reconcileReviews([saved], id.projectKey, allowed, [id.findingKey])[0].verification, "still-found");
});

test("accepting a risk requires a rationale and never suppresses the finding", async () => {
  const store = storage(), id = await ids();
  assert.throws(() => saveReview(store,{...id,decision:"accepted",note:"yes"}), /at least 10/);
  saveReview(store, {...id,decision:"accepted",note:"The retry pattern is intentionally monitored."});
  assert.equal(readReviews(store)[0].note, "The retry pattern is intentionally monitored.");
  assert.equal(readReviews(store)[0].decision, "accepted");
  assert.equal(clearReview(store, id.projectKey, id.findingKey), true);
  assert.equal(readReviews(store).length, 0);
});

test("malformed local review records are discarded safely", async () => {
  const store = storage();
  store.setItem("ship-check.finding-reviews.v1", "{unreadable");
  assert.deepEqual(readReviews(store), []);
  store.setItem("ship-check.finding-reviews.v1", JSON.stringify({schemaVersion:1,entries:[{
    projectKey:"local/source",findingKey:"not-a-hash",checkKey:"",decision:"fixed",updatedAt:"today"
  }]}));
  assert.deepEqual(readReviews(store), []);
});
