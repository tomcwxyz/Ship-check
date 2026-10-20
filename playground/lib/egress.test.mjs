import { test } from "node:test";
import assert from "node:assert/strict";
import { scanEgressPolicy } from "./egress.mjs";

test("GitHub scans reach only npm registry and GitHub", () => {
  const policy = scanEgressPolicy({ kind: "github", target: "https://github.com/octocat/Hello-World" });
  assert.deepEqual(policy.allow, ["registry.npmjs.org", "github.com"]);
  assert.ok(policy.subnets.deny.includes("169.254.0.0/16"));
  assert.ok(policy.subnets.deny.includes("fc00::/7"));
  assert.ok(!policy.allow.includes("*"));
});
test("Site scans cannot reach arbitrary redirect destinations", () => {
  const policy = scanEgressPolicy({ kind: "site", target: "https://example.org/" });
  assert.deepEqual(policy.allow, ["registry.npmjs.org", "example.org", "www.example.org"]);
  assert.ok(!policy.allow.includes("github.com"));
});
