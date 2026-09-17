import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import type { ProjectEvidenceSourceInput } from "@ship-check/schemas";

export const ARCHIVE_LIMITS = {
  archiveBytes: 100 * 1024 * 1024,
  entries: 20_000,
  entryBytes: 50 * 1024 * 1024,
  expandedBytes: 500 * 1024 * 1024
} as const;

export type PreparedArchiveSource = {
  kind: "archive";
  projectPath: string;
  displayName: string;
  sourceInput: ProjectEvidenceSourceInput;
  cleanup: () => Promise<void>;
};

type OpenZip = yauzl.ZipFile;
type ZipEntry = yauzl.Entry;

function openZip(archivePath: string): Promise<OpenZip> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, zipFile) => {
        if (error) reject(error);
        else if (!zipFile) reject(new Error("ZIP archive could not be opened."));
        else resolve(zipFile);
      }
    );
  });
}

function openEntryStream(zipFile: OpenZip, entry: ZipEntry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else if (!stream) reject(new Error(`ZIP entry '${entry.fileName}' could not be read.`));
      else resolve(stream);
    });
  });
}

function safeRelativePath(fileName: string): string {
  if (!fileName || fileName.includes("\0") || fileName.includes("\\")) {
    throw new Error(`ZIP contains an unsafe path: ${JSON.stringify(fileName)}.`);
  }
  if (fileName.startsWith("/") || /^[A-Za-z]:\//.test(fileName)) {
    throw new Error(`ZIP contains an absolute path: ${fileName}.`);
  }

  const withoutTrailingSlash = fileName.replace(/\/+$/, "");
  if (!withoutTrailingSlash) return "";
  const segments = withoutTrailingSlash.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`ZIP contains a path outside the project boundary: ${fileName}.`);
  }

  const normalised = path.posix.normalize(withoutTrailingSlash);
  if (normalised === ".." || normalised.startsWith("../") || path.posix.isAbsolute(normalised)) {
    throw new Error(`ZIP contains a path outside the project boundary: ${fileName}.`);
  }
  return normalised;
}

function unixFileType(entry: ZipEntry): number {
  return ((entry.externalFileAttributes >>> 16) & 0xffff) & 0o170000;
}

function entryKind(entry: ZipEntry): "directory" | "file" {
  const fileType = unixFileType(entry);
  if (fileType === 0o120000) {
    throw new Error(`ZIP symlinks are not accepted: ${entry.fileName}.`);
  }
  if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
    throw new Error(`ZIP special filesystem entries are not accepted: ${entry.fileName}.`);
  }
  return entry.fileName.endsWith("/") || fileType === 0o040000 ? "directory" : "file";
}

function boundedStream(entry: ZipEntry, counters: { actualExpandedBytes: number }): Transform {
  let entryBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      entryBytes += chunk.length;
      counters.actualExpandedBytes += chunk.length;
      if (entryBytes > ARCHIVE_LIMITS.entryBytes || entryBytes > entry.uncompressedSize) {
        callback(new Error(`ZIP entry '${entry.fileName}' expanded beyond its permitted size.`));
        return;
      }
      if (counters.actualExpandedBytes > ARCHIVE_LIMITS.expandedBytes) {
        callback(new Error("ZIP expanded beyond the permitted project size."));
        return;
      }
      callback(null, chunk);
    }
  });
}

async function extractZip(archivePath: string, destination: string): Promise<void> {
  const zipFile = await openZip(archivePath);
  const counters = { actualExpandedBytes: 0 };
  let entryCount = 0;
  let declaredExpandedBytes = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      zipFile.once("error", finish);
      zipFile.once("end", () => finish());

      zipFile.on("entry", async (entry: ZipEntry) => {
        try {
          entryCount += 1;
          if (entryCount > ARCHIVE_LIMITS.entries) {
            throw new Error(`ZIP contains more than ${ARCHIVE_LIMITS.entries} entries.`);
          }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            throw new Error(`Encrypted ZIP entries are not accepted: ${entry.fileName}.`);
          }
          if (entry.uncompressedSize > ARCHIVE_LIMITS.entryBytes) {
            throw new Error(`ZIP entry '${entry.fileName}' exceeds the per-file extraction limit.`);
          }
          declaredExpandedBytes += entry.uncompressedSize;
          if (declaredExpandedBytes > ARCHIVE_LIMITS.expandedBytes) {
            throw new Error("ZIP declared expanded size exceeds the permitted project size.");
          }

          const relative = safeRelativePath(entry.fileName);
          const kind = entryKind(entry);
          if (!relative) {
            zipFile.readEntry();
            return;
          }
          const outputPath = path.resolve(destination, ...relative.split("/"));
          if (outputPath !== destination && !outputPath.startsWith(`${destination}${path.sep}`)) {
            throw new Error(`ZIP entry escaped the extraction directory: ${entry.fileName}.`);
          }

          if (kind === "directory") {
            await fs.mkdir(outputPath, { recursive: true });
          } else {
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            const stream = await openEntryStream(zipFile, entry);
            await pipeline(
              stream,
              boundedStream(entry, counters),
              createWriteStream(outputPath, { flags: "wx", mode: 0o600 })
            );
          }
          zipFile.readEntry();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          zipFile.close();
        }
      });

      zipFile.readEntry();
    });
  } finally {
    try { zipFile.close(); } catch { /* Already closed after an extraction error. */ }
  }
}

async function projectRoot(extractionRoot: string): Promise<string> {
  const entries = (await fs.readdir(extractionRoot, { withFileTypes: true }))
    .filter((entry) => entry.name !== "__MACOSX" && entry.name !== ".DS_Store");
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractionRoot, entries[0].name);
  }
  return extractionRoot;
}

export async function prepareArchiveSource(input: string): Promise<PreparedArchiveSource | null> {
  if (path.extname(input).toLowerCase() !== ".zip") return null;

  let archiveStat;
  try {
    archiveStat = await fs.stat(input);
  } catch {
    return null;
  }
  if (!archiveStat.isFile()) return null;
  if (archiveStat.size > ARCHIVE_LIMITS.archiveBytes) {
    throw new Error(`ZIP archive exceeds the ${ARCHIVE_LIMITS.archiveBytes / (1024 * 1024)} MB upload limit.`);
  }

  const archivePath = path.resolve(input);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-upload-"));
  const extractionRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(extractionRoot, { recursive: true });

  try {
    await extractZip(archivePath, extractionRoot);
    const root = await projectRoot(extractionRoot);
    const displayName = path.basename(archivePath);
    let cleaned = false;
    return {
      kind: "archive",
      projectPath: root,
      displayName,
      sourceInput: {
        id: `upload:${displayName}`,
        type: "source",
        provider: "upload",
        label: displayName,
        acquisition: "uploaded-snapshot",
        executionLocation: "user-device",
        capabilities: ["source-files", "dependency-manifests"],
        ephemeral: true
      },
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw new Error(`Could not prepare ZIP project '${path.basename(archivePath)}': ${error instanceof Error ? error.message : String(error)}`);
  }
}
