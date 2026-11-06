import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { boundedReport, resolveProjectRoot } from "./runner.mjs";

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
