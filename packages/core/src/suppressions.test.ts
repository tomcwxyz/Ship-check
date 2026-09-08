import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject, type CheckDefinition } from "./index.js";

const temporaryRoots: string[] = [];

async function fixture(config?: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-suppressions-"));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  if (config !== undefined) {
    await fs.writeFile(
      path.join(root, ".ship-check.json"),
      typeof config === "string" ? config : JSON.stringify(config, null, 2)
    );
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function exampleCheck(version = "2" as const): CheckDefinition {
  return {
    id: "secure.example",
    version,
    pack: "secure-build",
    title: "Example",
    description: "Example deterministic concern",
    async run() {
      return [{
        id: "secure.example:app.ts:1",
        checkId: "secure.example",
        pack: "secure-build",
        title: "Example concern",
        summary: "Example repository evidence supports a concern.",
        severity: "high",
        confidence: "high",
        evidence: [{ kind: "file-match", path: "app.ts", line: 1, detail: "Example evidence." }],
        remediation: {
          why: "This is a test concern.",
          fix: "Fix the test concern.",
          verify: "Rerun the check.",
          agentPrompt: "Repair the test concern."
        }
      }];
    }
  };
}

describe("check provenance and suppressions", () => {
  it("records an explicit check version even when there are no suppressions", async () => {
    const root = await fixture();
    const report = await scanProject(root, [exampleCheck()]);

    expect(report.checks[0]).toMatchObject({
      checkId: "secure.example",
      checkVersion: "2",
      status: "findings",
      findingCount: 1,
      suppressedCount: 0
    });
  });

  it("moves an exact version-matched finding into visible suppressed evidence", async () => {
    const root = await fixture({
      schemaVersion: "0.1",
      suppressions: [{
        findingId: "secure.example:app.ts:1",
        checkVersion: "2",
        rationale: "This exact risk is accepted temporarily while the replacement boundary is shipped."
      }]
    });
    const report = await scanProject(root, [exampleCheck()]);

    expect(report.findings).toEqual([]);
    expect(report.summary).toMatchObject({ total: 0, suppressed: 1 });
    expect(report.checks[0]).toMatchObject({
      checkVersion: "2",
      status: "suppressed",
      findingCount: 0,
      suppressedCount: 1
    });
    expect(report.suppressedFindings[0]).toMatchObject({
      checkVersion: "2",
      rationale: "This exact risk is accepted temporarily while the replacement boundary is shipped.",
      configPath: ".ship-check.json",
      finding: { id: "secure.example:app.ts:1", severity: "high" }
    });
  });

  it("does not apply a suppression after the check version changes", async () => {
    const root = await fixture({
      schemaVersion: "0.1",
      suppressions: [{
        findingId: "secure.example:app.ts:1",
        checkVersion: "1",
        rationale: "This was accepted against the old rule semantics and must be reviewed after changes."
      }]
    });
    const report = await scanProject(root, [exampleCheck()]);

    expect(report.findings).toHaveLength(1);
    expect(report.suppressedFindings).toEqual([]);
    expect(report.checks[0]).toMatchObject({ status: "findings", checkVersion: "2" });
  });

  it("fails closed on malformed suppression configuration", async () => {
    const invalidJson = await fixture("{ nope");
    await expect(scanProject(invalidJson, [exampleCheck()])).rejects.toThrow("Invalid .ship-check.json");

    const tokenRationale = await fixture({
      schemaVersion: "0.1",
      suppressions: [{
        findingId: "secure.example:app.ts:1",
        checkVersion: "2",
        rationale: "accepted"
      }]
    });
    await expect(scanProject(tokenRationale, [exampleCheck()])).rejects.toThrow("Invalid .ship-check.json");
  });
});
