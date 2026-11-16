import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudSyncPlan } from "./github-action-cloud-sync.mjs";
const valid={
  workspace:"/home/runner/work/sample/sample",actionPath:"/home/runner/work/_actions/ship-check",
  eventName:"schedule",metadataPath:".ship-check/metadata.json",cloudUrl:"https://cloud.example/",
  cloudToken:"shipcheck_"+"A".repeat(43),retention:"90-days"
};
test("technology sync is off unless explicitly enabled",()=>{
  const plan=cloudSyncPlan(valid);
  assert.equal(plan.technologySync,false);
  assert.equal(plan.report,undefined);
});
test("technology sync requires a bounded workspace-relative report path",()=>{
  const plan=cloudSyncPlan({...valid,technologySync:true,reportPath:".ship-check/report.json"});
  assert.ok(plan.report.endsWith("/sample/.ship-check/report.json"));
  assert.equal(plan.technologySync,true);
  for(const reportPath of ["../secret.json","/etc/passwd",".","a/../../../secret.json"]) {
    assert.throws(()=>cloudSyncPlan({...valid,technologySync:true,reportPath}),/report|path/i);
  }
});
test("technology sync does not allow PR events",()=>{
  assert.throws(()=>cloudSyncPlan({...valid,technologySync:true,reportPath:"report.json",eventName:"pull_request"}),/only allowed/);
});
