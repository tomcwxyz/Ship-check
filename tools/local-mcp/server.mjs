import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { boundedReport, invokeShipCheck, resolveProjectRoot } from "./runner.mjs";

const root = process.env.SHIP_CHECK_PROJECT_ROOT || process.cwd();

serveStdio(() => {
  const server = new McpServer({ name: "ship-check-local", version: "0.0.0-alpha.1" });

  server.registerTool("ship_check_daily", {
    description: "Run or reuse a once-a-day local Ship Check security assessment. Optional network access sends dependency metadata to OSV and CVE IDs to CISA/FIRST.",
    inputSchema: z.object({
      project: z.string().max(512).default("."),
      networked: z.boolean().default(false),
      force: z.boolean().default(false)
    })
  }, async ({ project, networked, force }) => {
    try {
      const cwd = await resolveProjectRoot(root, project);
      const text = await invokeShipCheck(["agent-check", ".", ...(networked ? ["--networked-dependency-scan"] : []), ...(force ? ["--force"] : [])], cwd);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Security check failed." }] };
    }
  });

  server.registerTool("ship_check_project", {
    description: "Run the canonical Ship Check engine and return bounded findings, questions and coverage (not source code or raw scanner evidence). Dependency network lookups require explicit opt-in.",
    inputSchema: z.object({
      project: z.string().max(512).default("."),
      networked: z.boolean().default(false)
    })
  }, async ({ project, networked }) => {
    try {
      const cwd = await resolveProjectRoot(root, project);
      const output = await invokeShipCheck(["scan", ".", "--format", "json",
        ...(networked ? ["--networked-dependency-scan"] : [])], cwd);
      const summary = boundedReport(JSON.parse(output));
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Project check failed." }] };
    }
  });

  return server;
});
