import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  boundedReport, boundedTechnologies, invokeShipCheck,
  requireCloudMonitoringConsent, resolveProjectRoot, scanWebsite, scannerVersion
} from "./runner.mjs";

const root = process.env.SHIP_CHECK_PROJECT_ROOT || process.cwd();
const adapterVersion = JSON.parse(readFileSync(new URL("./package.json",import.meta.url),"utf8")).version;

function reply(value) {
  return {content:[{type:"text",text:typeof value==="string"?value:JSON.stringify(value)}]};
}
function rejected(error) {
  return {isError:true,content:[{type:"text",text:error instanceof Error?error.message:"Ship Check could not complete the request."}]};
}

serveStdio(() => {
  const server = new McpServer({ name: "ship-check-local", version: adapterVersion });

  server.registerTool("ship_check_version", {
    description:"Report the installed canonical scanner version, package version if configured, and any mismatch. Never claims the package was automatically updated.",
    inputSchema:z.object({})
  }, async () => {
    try {return reply({adapterVersion,...await scannerVersion(root)});}
    catch(error){return rejected(error);}
  });

  server.registerTool("ship_check_daily", {
    description:"Run or reuse a once-a-day local Ship Check security assessment. Optional network access sends dependency metadata to OSV and CVE IDs to CISA/FIRST.",
    inputSchema:z.object({
      project:z.string().max(512).default("."),
      networked:z.boolean().default(false),
      force:z.boolean().default(false)
    })
  }, async ({project,networked,force}) => {
    try {
      const cwd=await resolveProjectRoot(root,project);
      const result=await invokeShipCheck(["agent-check",".",...(networked?["--networked-dependency-scan"]:[]),...(force?["--force"]:[])],cwd);
      return reply(result);
    } catch(error){return rejected(error);}
  });

  server.registerTool("ship_check_project", {
    description:"Scan a local project with the canonical scanner. Returns bounded findings, gaps, coverage, detected AI/CMS technologies, and scanner version; never raw source evidence. Cloud upload requires explicit per-call opt-in AND local owner configuration.",
    inputSchema:z.object({
      project:z.string().max(512).default("."),
      networked:z.boolean().default(false),
      monitor:z.boolean().default(false)
    })
  }, async ({project,networked,monitor}) => {
    try {
      requireCloudMonitoringConsent(monitor);
      const cwd=await resolveProjectRoot(root,project);
      const result=await invokeShipCheck(["scan",".","--format","json",
        ...(networked?["--networked-dependency-scan"]:[]),
        ...(monitor?["--monitor"]:[])],cwd);
      return reply({...boundedReport(JSON.parse(result)),cloudMonitoring:monitor?"enabled":"not-requested"});
    } catch(error){return rejected(error);}
  });

  server.registerTool("ship_check_technologies", {
    description:"Discover source-declared AI models and CMS components from a local project without uploading anything. A missing or incomplete scan is reported as unknown, not empty. No live-site plugin verification.",
    inputSchema:z.object({project:z.string().max(512).default(".")})
  },async ({project})=>{
    try {
      const cwd=await resolveProjectRoot(root,project);
      const output=await invokeShipCheck(["scan",".","--format","json"],cwd);
      const report=JSON.parse(output);
      return reply({scannerVersion:report.tool?.version??null,
        technologies:boundedTechnologies(report)});
    }catch(error){return rejected(error);}
  });

  server.registerTool("ship_check_website", {
    description:"Scan ordinary public HTTPS website evidence with the canonical scanner and a socket-level private-IP/DNS-rebinding guard. Requires explicit permission for the external request. Shows possible WordPress/Drupal fingerprints, not private installed plugins. Optional Cloud monitoring also requires separately configured owner consent.",
    inputSchema:z.object({
      url:z.string().max(1700),
      confirmExternalRequest:z.literal(true),
      monitor:z.boolean().default(false)
    })
  },async ({url,monitor})=>{
    try {
      const cwd=await resolveProjectRoot(root,".");
      return reply(await scanWebsite(url,cwd,{monitor}));
    }catch(error){return rejected(error);}
  });

  return server;
});
