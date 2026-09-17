import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
import * as yazl from "yazl";
import { prepareArchiveSource } from "./archiveSource.js";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-archive-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeZip(
  archivePath: string,
  entries: Array<{ path: string; contents: string }>
): Promise<void> {
  const zip = new yazl.ZipFile();
  const writing = pipeline(zip.outputStream, createWriteStream(archivePath));
  for (const entry of entries) {
    zip.addBuffer(Buffer.from(entry.contents), entry.path);
  }
  zip.end();
  await writing;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("prepareArchiveSource", () => {
  it("materialises a typical exported project into an ephemeral project snapshot", async () => {
    const root = await temporaryDirectory();
    const archivePath = path.join(root, "lovable-export.zip");
    await writeZip(archivePath, [
      { path: "lovable-export/package.json", contents: '{"name":"lovable-export"}\n' },
      { path: "lovable-export/src/main.ts", contents: "export const ready = true;\n" }
    ]);

    const prepared = await prepareArchiveSource(archivePath);

    expect(prepared).not.toBeNull();
    expect(prepared).toMatchObject({
      kind: "archive",
      displayName: "lovable-export.zip",
      sourceInput: {
        provider: "upload",
        acquisition: "uploaded-snapshot",
        executionLocation: "user-device",
        capabilities: ["source-files", "dependency-manifests"],
        ephemeral: true
      }
    });
    expect(await fs.readFile(path.join(prepared!.projectPath, "package.json"), "utf8"))
      .toContain("lovable-export");
    expect(await fs.readFile(path.join(prepared!.projectPath, "src/main.ts"), "utf8"))
      .toContain("ready");

    const materialisedPath = prepared!.projectPath;
    await prepared!.cleanup();
    await expect(fs.stat(materialisedPath)).rejects.toThrow();
  });

  it("returns null for a non-archive source", async () => {
    const root = await temporaryDirectory();
    const sourcePath = path.join(root, "project.txt");
    await fs.writeFile(sourcePath, "not a zip");

    await expect(prepareArchiveSource(sourcePath)).resolves.toBeNull();
  });
});
