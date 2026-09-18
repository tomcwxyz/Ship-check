import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectContext, scanProject, type CheckDefinition } from "./index.js";

const execFileAsync = promisify(execFile);
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


  it("produces a stable complete fingerprint and changes it when source content changes", async () => {
    const root = await temporaryProject();

    const first = await createProjectContext(root);
    const second = await createProjectContext(root);

    expect(first.snapshot.inventory.fingerprint).toMatchObject({
      algorithm: "sha256",
      scope: "source-inventory-v1",
      completeness: "complete",
      entryCount: 1,
      hashedEntryCount: 1,
      skippedEntryCount: 0
    });
    expect(second.snapshot.inventory.fingerprint?.value).toBe(first.snapshot.inventory.fingerprint?.value);

    await fs.writeFile(path.join(root, "package.json"), '{"name":"changed"}\n');
    const changed = await createProjectContext(root);

    expect(changed.snapshot.inventory.fingerprint?.value).not.toBe(first.snapshot.inventory.fingerprint?.value);
  });

  it("marks the fingerprint partial when an inventory entry exceeds the hashing bound", async () => {
    const root = await temporaryProject();
    const largePath = path.join(root, "large.bin");
    await fs.writeFile(largePath, "");
    await fs.truncate(largePath, 16 * 1024 * 1024 + 1);

    const context = await createProjectContext(root);

    expect(context.snapshot.inventory.fingerprint).toMatchObject({
      completeness: "partial",
      entryCount: 2,
      hashedEntryCount: 1,
      skippedEntryCount: 1
    });
  });

  it("does not follow a tracked symlink when checks request file text", async () => {
    if (process.platform === "win32") return;

    const root = await temporaryProject();
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-outside-source-test-"));
    temporaryRoots.push(outsideRoot);
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await fs.writeFile(outsideFile, "should-not-be-read\n");
    await fs.symlink(outsideFile, path.join(root, "linked-secret.txt"));

    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "add", "package.json", "linked-secret.txt"]);

    const context = await createProjectContext(root);

    expect(context.files).toContain("linked-secret.txt");
    expect(await context.readText("linked-secret.txt")).toBeNull();
    expect(context.snapshot.inventory.fingerprint).toMatchObject({
      completeness: "complete",
      entryCount: 2,
      hashedEntryCount: 2,
      skippedEntryCount: 0
    });
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

  it("marks a source check not assessed when only runtime evidence is available", async () => {
    const root = await temporaryProject();
    let executed = false;
    const sourceOnlyCheck: CheckDefinition = {
      id: "test.source-only",
      pack: "secure-build",
      title: "Source-only test",
      description: "Requires source evidence by default.",
      coverage: [{ area: "code-security", status: "assessed" }],
      async run() {
        executed = true;
        return [];
      }
    };

    const report = await scanProject(root, [sourceOnlyCheck], "0.0.0-test", {
      id: "url:https://example.test",
      type: "deployment",
      provider: "url",
      label: "https://example.test",
      acquisition: "runtime-probe",
      executionLocation: "ship-check-managed",
      capabilities: ["runtime-http"],
      ephemeral: true
    });

    expect(executed).toBe(false);
    expect(report.checks[0]).toMatchObject({
      status: "not-assessed",
      missingEvidence: ["source-files"],
      findingCount: 0
    });
    expect(report.coverage.find((entry) => entry.area === "code-security")?.status).toBe("not-assessed");
  });
});
