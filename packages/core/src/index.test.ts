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

async function initGit(root: string): Promise<void> {
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "ship-check@example.invalid"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Ship Check Test"]);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("project inventory", () => {
  it("uses Git's tracked inventory and excludes ignored local environment files", async () => {
    const root = await temporaryDirectory();
    await initGit(root);
    await fs.writeFile(path.join(root, ".gitignore"), ".env*.local\n");
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, ".env.local"), "SECRET=local-only\n");
    await execFileAsync("git", ["-C", root, "add", ".gitignore", "package.json"]);

    const context = await createProjectContext(root);

    expect(context.gitRepository).toBe(true);
    expect(context.inventorySource).toBe("git-tracked");
    expect(context.files).toEqual([".gitignore", "package.json"]);
    expect(context.isTracked("package.json")).toBe(true);
    expect(context.isTracked(".env.local")).toBe(false);
  });

  it("stops rather than treating untracked local files as repository evidence", async () => {
    const root = await temporaryDirectory();
    await initGit(root);
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');

    await expect(createProjectContext(root)).rejects.toThrow("Git reported no tracked files");
  });

  it("stops rather than returning a false clean report for an empty directory", async () => {
    const root = await temporaryDirectory();

    await expect(scanProject(root, [])).rejects.toThrow("found no inspectable files");
  });
});
