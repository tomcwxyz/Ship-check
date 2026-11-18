import { test } from "node:test";
import assert from "node:assert/strict";
import { scanEgressPolicy } from "./egress.mjs";

test("GitHub scans reach only npm registry and GitHub", () => {
  const policy = scanEgressPolicy({ kind: "github", target: "https://github.com/octocat/Hello-World" });
  assert.deepEqual(policy.allow, ["registry.npmjs.org", "github.com"]);
  assert.ok(policy.subnets.deny.includes("169.254.0.0/16"));
  assert.ok(policy.subnets.deny.every(value => !value.includes(":")), "Sandbox CIDRs must be IPv4-only");
  assert.ok(!policy.allow.includes("*"));
});
test("Public website scans permit only the selected HTTPS hostname, never broad egress", () => {
  const policy = scanEgressPolicy({kind:"site",target:"https://example.org/"});
  assert.deepEqual(policy.allow,["registry.npmjs.org","example.org","www.example.org"]);
  assert.ok(!policy.allow.includes("*"));
  assert.ok(policy.subnets.deny.includes("169.254.0.0/16"));
});

test("Opted-in GitHub security intelligence uses only fixed advisory hosts", () => {
  const policy = scanEgressPolicy({ kind: "github", target: "https://github.com/octocat/Hello-World" }, true);
  assert.deepEqual(policy.allow, [
    "registry.npmjs.org", "github.com", "api.osv.dev", "nodejs.org", "raw.githubusercontent.com"
  ]);
  assert.ok(!policy.allow.includes("*"));
  assert.ok(policy.subnets.deny.includes("127.0.0.0/8"));
});
