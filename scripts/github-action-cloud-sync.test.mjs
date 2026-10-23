import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudSyncPlan } from "./github-action-cloud-sync.mjs";

const valid = {
  workspace: "/home/runner/work/example/example",
  actionPath: "/home/runner/work/_actions/ship-check",
  eventName: "schedule",
  metadataPath: ".ship-check/metadata.json",
  cloudUrl: "https://ship-check.example/",
  cloudToken: "shipcheck_" + "A".repeat(43),
  retention: "90-days"
};
test("scheduled CI is allowed to explicitly sync metadata only", () => {
  const result = cloudSyncPlan(valid);
  assert.equal(result.metadata, "/home/runner/work/example/example/.ship-check/metadata.json");
  assert.ok(result.args.includes("connect"));
  assert.equal(result.args.at(-1), "90-days");
  assert.ok(!result.args.join(" ").includes(valid.cloudToken));
  assert.equal(result.env.SHIP_CHECK_CLOUD_TOKEN, valid.cloudToken);
});
test("PRs, untrusted event classes and absent credentials fail closed", () => {
  for (const eventName of ["pull_request", "pull_request_target", "workflow_run", "issue_comment"]) {
    assert.throws(() => cloudSyncPlan({ ...valid, eventName }), /only allowed/);
  }
  assert.throws(() => cloudSyncPlan({ ...valid, cloudToken: "" }), /token/);
});
test("Cloud target must be a plain HTTPS origin", () => {
  for (const cloudUrl of ["http://remote.test", "https://user:pass@remote.test", "https://remote.test/evil", "https://remote.test/?token=123", "file:///etc/passwd"]) {
    assert.throws(() => cloudSyncPlan({ ...valid, cloudUrl }), /Cloud URL/);
  }
  assert.equal(cloudSyncPlan({ ...valid, cloudUrl: "http://localhost:3000" }).env.SHIP_CHECK_CLOUD_URL, "http://localhost:3000");
});
test("metadata paths cannot escape the checkout, and retention requires known policy", () => {
  for (const metadataPath of ["../outside.json", "/tmp/outside.json", ".", "sub/../../../outside.json"]) {
    assert.throws(() => cloudSyncPlan({ ...valid, metadataPath }), /path/i);
  }
  assert.throws(() => cloudSyncPlan({ ...valid, retention: "forever" }), /retention/);
});
