import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectContext, scanProject } from "./index.js";

const temporaryRoots: string[] = [];

async function temporaryProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-project-source-test-"));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project evidence provenance", () => {
  it("records an ordinary local folder as local source evidence", async () => {
    const root = await temporaryProject();

    const context = await createProjectContext(root);

    expect(context.source).toMatchObject({
      type: "source",
      provider: "local",
      label: root,
      acquisition: "local",
      executionLocation: "user-device",
      capabilities: ["source-files"],
      ephemeral: false
    });
    expect(context.snapshot.inventory).toMatchObject({ source: "filesystem", fileCount: 1 });
  });

  it("records an uploaded hosted-builder export without changing the checking engine", async () => {
    const root = await temporaryProject();

    const report = await scanProject(root, [], "0.0.0-test", {
      id: "upload:lovable-export-123",
      type: "source",
      provider: "upload",
      label: "lovable-project.zip",
      acquisition: "uploaded-snapshot",
      executionLocation: "ship-check-managed",
      capabilities: ["source-files", "dependency-manifests"],
      ephemeral: true
    });

    expect(report.project.path).toBe("lovable-project.zip");
    expect(report.project.snapshot?.source).toMatchObject({
      provider: "upload",
      acquisition: "uploaded-snapshot",
      executionLocation: "ship-check-managed",
      ephemeral: true
    });
    expect(report.project.snapshot?.inventory).toMatchObject({
      source: "filesystem",
      fileCount: 1
    });
  });
});
