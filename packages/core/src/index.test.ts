import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectContext, scanProject } from "./index.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-core-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project inventory", () => {
  it("falls back to the filesystem when a git repository reports zero tracked files", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await execFileAsync("git", ["init", root]);

    const context = await createProjectContext(root);

    expect(context.gitRepository).toBe(true);
    expect(context.files).toContain("package.json");
    expect(context.files.length).toBeGreaterThan(0);
  });

  it("stops rather than returning a false clean report for an empty directory", async () => {
    const root = await temporaryDirectory();

    await expect(scanProject(root, [])).rejects.toThrow("found no inspectable files");
  });
});
