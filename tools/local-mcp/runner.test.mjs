import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { boundedReport, boundedTechnologies, resolveProjectRoot, parsePublicWebsiteUrl, requireCloudMonitoringConsent, scanWebsite, websiteScannerConfiguration, parsePublicGitHubRepo } from "./runner.mjs";

describe("local MCP security boundaries", () => {
  it("rejects traversal and absolute paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ship-check-mcp-"));
    try {
      await mkdir(path.join(root, "child"));
      assert.equal(await resolveProjectRoot(root, "child"), path.join(root, "child"));
      await assert.rejects(resolveProjectRoot(root, ".."), /inside/);
      await assert.rejects(resolveProjectRoot(root, "/tmp"), /relative/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never returns raw evidence or credentials in tool summaries", () => {
    const report = {
      generatedAt: "2026-11-06T00:00:00Z",
      summary: { total: 1 },
      findings: [{
        id: "test", title: "Check an access key", severity: "high",
        summary: "Potential leaked credential", evidence: [{ detail: "SECRET_NOT_FOR_AGENT" }],
        remediation: { fix: "Rotate the key.", agentPrompt: "SECRET_NOT_FOR_AGENT" }
      }],
      gaps: [], checks: [], coverage: []
    };
    const result = JSON.stringify(boundedReport(report));
    assert.doesNotMatch(result, /SECRET_NOT_FOR_AGENT/);
    assert.match(result, /Rotate the key/);
  });
});

describe("MCP scanner discovery and consent",()=>{
  it("reports missing scanner handoff as unknown, never as no dependencies",()=>{
    assert.equal(boundedTechnologies({}).available,false);
  });
  it("reports model and site hints but not raw paths or report evidence",()=>{
    const report={
      tool:{name:"ship-check",version:"0.0.0-alpha.14"},
      generatedAt:"2026-11-18T12:00:00Z",
      project:{snapshot:{inventory:{fingerprint:{completeness:"complete"}}}},
      summary:{total:0},findings:[],gaps:[],checks:[],coverage:[],
      monitoringHandoff:{inventory:{
        schemaVersion:"ship-check-technology-inventory/0.1",sourceInventory:"complete",
        components:[{kind:"ai-model",id:"gpt-5",evidence:"source-declared",path:"private/key.txt",content:"SECRET_NOT_FOR_AGENT"}],
        siteHints:[{cms:"drupal",confidence:"possible"}]
      }}
    };
    const result=boundedReport(report);
    assert.equal(result.scannerVersion,"0.0.0-alpha.14");
    assert.equal(result.snapshot.completeness,"complete");
    assert.deepEqual(result.technologies.components,[{kind:"ai-model",id:"gpt-5",evidence:"source-declared"}]);
    assert.deepEqual(result.technologies.siteHints,[{cms:"drupal",confidence:"possible",evidence:"public-website-hint"}]);
    assert.doesNotMatch(JSON.stringify(result),/SECRET_NOT_FOR_AGENT|private\/key/);
  });
  it("rejects unsafe website targets before any network request",()=>{
    for(const url of ["http://wordpress.org","https://127.0.0.1/","https://[::1]/",
      "https://wordpress.org:8443","https://user:password@wordpress.org/",
      "https://localhost","https://example.internal","ftp://wordpress.org/"]) {
      assert.throws(()=>parsePublicWebsiteUrl(url),undefined,url);
    }
    assert.equal(parsePublicWebsiteUrl("https://wordpress.org/about/").hostname,"wordpress.org");
  });
  it("accepts only public GitHub owner/repository shorthand",()=>{
    assert.equal(parsePublicGitHubRepo("tomcwxyz/Ship-check"),"tomcwxyz/Ship-check");
    for(const input of ["https://github.com/owner/repo","../../etc/passwd","owner/repo/path",
      "owner;rm -rf/repo","owner/.","owner/..","ssh://github.com/owner/repo"]) {
      assert.throws(()=>parsePublicGitHubRepo(input),undefined,input);
    }
  });
  it("Cloud write requires both administrator configuration and per-call consent",()=>{
    const beforeToken=process.env.SHIP_CHECK_CLOUD_TOKEN;
    const beforeAllow=process.env.SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE;
    try {
      delete process.env.SHIP_CHECK_CLOUD_TOKEN;
      delete process.env.SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE;
      assert.equal(requireCloudMonitoringConsent(false),false);
      assert.throws(()=>requireCloudMonitoringConsent(true),/SH IPCHECK|SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE/);
      process.env.SHIP_CHECK_CLOUD_TOKEN="shipcheck_test";
      process.env.SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE="1";
      assert.equal(requireCloudMonitoringConsent(true),true);
    } finally {
      if(beforeToken===undefined)delete process.env.SHIP_CHECK_CLOUD_TOKEN;else process.env.SHIP_CHECK_CLOUD_TOKEN=beforeToken;
      if(beforeAllow===undefined)delete process.env.SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE;else process.env.SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE=beforeAllow;
    }
  });
  it("always executes website scans through Node with the guarded preloader",async()=>{
    const tmp=await mkdtemp(path.join(os.tmpdir(),"ship-check-website-mcp-"));
    try{
      const entry=path.join(tmp,"scanner.mjs");
      await writeFile(entry,'console.log(JSON.stringify({tool:{version:"0.0.0-alpha.14"},summary:{total:0},findings:[],checks:[],gaps:[],coverage:[],monitoringHandoff:{inventory:{schemaVersion:"ship-check-technology-inventory/0.1",sourceInventory:"not-assessed",components:[],siteHints:[{cms:"wordpress",confidence:"likely"}]}}}));');
      const cfg=await websiteScannerConfiguration(parsePublicWebsiteUrl("https://wordpress.org/"),{entry});
      assert.equal(cfg.bin,process.execPath);
      assert.equal(cfg.prefixArgs[0],"--require");
      assert.ok(cfg.prefixArgs[1].includes("public-site-fetch-guard.cjs"));
      assert.equal(cfg.env.NODE_OPTIONS,"");
      assert.equal(cfg.env.SHIP_CHECK_SAFE_SITE_HOST,"wordpress.org");
      const result=await scanWebsite("https://wordpress.org/",tmp,{entry});
      assert.deepEqual(result.technologies.siteHints,[{cms:"wordpress",confidence:"likely",evidence:"public-website-hint"}]);
      assert.equal(result.cloudMonitoring,"not-requested");
    } finally {await rm(tmp,{recursive:true,force:true});}
  });
});
