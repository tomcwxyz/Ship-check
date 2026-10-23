import test from "node:test";
import assert from "node:assert/strict";
import { initCloudConnection } from "./cloud-connection.js";

function element(value = "") {
  const handlers = new Map();
  return {
    value, textContent:"", dataset:{}, disabled:false, hidden:false, href:"",
    addEventListener(name,handler){handlers.set(name,handler)},
    async fire(name){const callback=handlers.get(name);assert.ok(callback,name);return callback()},
  };
}
function setup() {
  const selectors = {
    "#cloud-status":element(), "#cloud-token":element(),
    "#cloud-connect":element(), "#cloud-forget":element(),
    "#cloud-send":element(), "#cloud-project-name":element("My project"),
    "#cloud-receipt":element(), "#cloud-history-link":element()
  };
  const root={querySelector:s=>selectors[s]??null};
  const calls=[];
  const bridge={
    async cloudConnectionStatus(){return {saved:false,message:"Not connected"}},
    async cloudConnectToken(token){calls.push(["connect",token]);return {saved:true,message:"Token saved"}},
    async cloudForgetToken(){calls.push(["forget"]);return {saved:false,message:"Forgotten"}},
    async cloudPublishSummary(report,name){calls.push(["publish",report,name]);return {
      status:"stored",ingestedAt:"2026-10-23T10:00:00.000Z",
      timelineUrl:"https://cloud-check.good-ship.co.uk/dashboard/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    }}
  };
  const controller=initCloudConnection(bridge,{querySelector:s=>s==="#cloud-connection"?root:null});
  return {selectors,calls,bridge,controller};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("local-first: never enables upload without both a completed scan and a saved token",async()=>{
  const {selectors,controller}=setup();
  await tick();
  assert.equal(selectors["#cloud-send"].disabled,true);
  controller.onScanCompleted({tool:{name:"ship-check"}},"good-project");
  assert.equal(selectors["#cloud-send"].disabled,true);
  assert.equal(selectors["#cloud-project-name"].value,"good-project");
});

test("never retains submitted token in DOM, and upload requires a separate explicit click",async()=>{
  const {selectors,calls,controller}=setup();
  await tick();
  selectors["#cloud-token"].value="shipcheck_"+"A".repeat(43);
  await selectors["#cloud-connect"].fire("click");
  assert.equal(selectors["#cloud-token"].value,"");
  assert.equal(calls.length,1);
  controller.onScanCompleted({tool:{name:"ship-check"},schemaVersion:"0.1"},"example");
  assert.equal(selectors["#cloud-send"].disabled,false);
  assert.equal(calls.length,1,"saving a token never sends a scan");
  await selectors["#cloud-send"].fire("click");
  assert.equal(calls.length,2);
  assert.equal(calls[1][0],"publish");
  assert.match(selectors["#cloud-receipt"].textContent,/summary received/i);
  assert.match(selectors["#cloud-history-link"].href,/^https:\/\/cloud-check\.good-ship\.co\.uk\/dashboard\/projects\//);
});

test("reset discards the current report and forbids accidental stale project sync",async()=>{
  const {selectors,calls,controller}=setup();
  await tick();
  selectors["#cloud-token"].value="shipcheck_"+"A".repeat(43);
  await selectors["#cloud-connect"].fire("click");
  controller.onScanCompleted({tool:{name:"ship-check"}},"first");
  controller.resetScan();
  assert.equal(selectors["#cloud-send"].disabled,true);
  await selectors["#cloud-send"].fire("click");
  assert.equal(calls.filter(x=>x[0]==="publish").length,0);
});

test("forgetting local token disables upload and reminds people about Cloud revocation",async()=>{
  const {selectors,calls,controller}=setup();
  await tick();
  selectors["#cloud-token"].value="shipcheck_"+"A".repeat(43);
  await selectors["#cloud-connect"].fire("click");
  controller.onScanCompleted({tool:{name:"ship-check"}},"example");
  await selectors["#cloud-forget"].fire("click");
  assert.equal(selectors["#cloud-send"].disabled,true);
  assert.equal(selectors["#cloud-forget"].hidden,true);
  assert.equal(calls.filter(x=>x[0]==="forget").length,1);
});
