import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectContext, scanProject, type CheckDefinition } from "./index.js";

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

  it("uses a filesystem inventory for a non-Git project", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, ".env.local"), "LOCAL_ONLY=yes\n");

    const context = await createProjectContext(root);

    expect(context.gitRepository).toBe(false);
    expect(context.inventorySource).toBe("filesystem");
    expect(context.files).toContain("package.json");
    expect(context.files).toContain(".env.local");
    expect(context.isTracked(".env.local")).toBeNull();
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

  it("does not read binary files as source text", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "binary.dat"), Buffer.from([65, 0, 66, 67]));

    const context = await createProjectContext(root);

    expect(await context.readText("binary.dat")).toBeNull();
  });

  it("does not allow reads outside the scanned inventory", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "inside.txt"), "inside\n");

    const context = await createProjectContext(root);

    expect(await context.readText("../outside.txt")).toBeNull();
    expect(await context.readText("inside.txt")).toBe("inside\n");
  });
});

describe("scan execution", () => {
  it("records inventory provenance in the report", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');

    const report = await scanProject(root, []);

    expect(report.project.inventorySource).toBe("filesystem");
    expect(report.project.fileCount).toBe(1);
  });

  it("captures a check error and continues running later checks", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');

    const exploding: CheckDefinition = {
      id: "test.explodes",
      pack: "secure-build",
      title: "Explodes",
      description: "Test check",
      async run() {
        throw new Error("deliberate test failure");
      },
    };
    const healthy: CheckDefinition = {
      id: "test.healthy",
      pack: "secure-build",
      title: "Healthy",
      description: "Test check",
      async run() {
        return [];
      },
    };

    const report = await scanProject(root, [exploding, healthy]);

    expect(report.checks).toHaveLength(2);
    expect(report.checks[0]).toMatchObject({
      checkId: "test.explodes",
      status: "error",
      findingCount: 0,
      error: "deliberate test failure",
    });
    expect(report.checks[1]).toMatchObject({ checkId: "test.healthy", status: "passed" });
    expect(report.summary.total).toBe(0);
  });
});
