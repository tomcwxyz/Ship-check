import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ScanReportSchema, type CheckPack, type CheckResult, type Finding, type ScanReport } from "@ship-check/schemas";

const execFileAsync = promisify(execFile);
const MAX_TEXT_BYTES = 512 * 1024;
const ignoredDirectories = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "target"]);

export type ProjectInventorySource = "git-tracked" | "filesystem";

export type ProjectContext = {
  root: string;
  files: string[];
  gitRepository: boolean;
  inventorySource: ProjectInventorySource;
  hasFile(relativePath: string): boolean;
  isTracked(relativePath: string): boolean | null;
  readText(relativePath: string): Promise<string | null>;
};

export type CheckDefinition = {
  id: string;
  pack: CheckPack;
  title: string;
  description: string;
  run(context: ProjectContext): Promise<Finding[]>;
};

function normalise(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

async function gitTrackedFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout: insideWorkTree } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8" },
    );
    if (insideWorkTree.trim() !== "true") return null;

    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "ls-files", "-z", "--", "."],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout
      .split("\0")
      .filter(Boolean)
      .map(normalise)
      .filter(Boolean)
      .sort();
  } catch {
    return null;
  }
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...(await walkFiles(root, absolute)));
    else if (entry.isFile()) output.push(normalise(path.relative(root, absolute)));
  }
  return output.sort();
}

export async function createProjectContext(projectPath: string): Promise<ProjectContext> {
  const root = path.resolve(projectPath);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`Ship Check needs a project directory: ${root}`);

  const tracked = await gitTrackedFiles(root);
  const gitRepository = tracked !== null;

  if (gitRepository && tracked.length === 0) {
    throw new Error(
      `Ship Check found a Git repository in ${root}, but Git reported no tracked files. The scan was stopped rather than falling back to local-only files and reporting false repository findings.`,
    );
  }

  const inventorySource: ProjectInventorySource = gitRepository ? "git-tracked" : "filesystem";
  const files = gitRepository ? tracked : await walkFiles(root);

  if (files.length === 0) {
    throw new Error(
      `Ship Check found no inspectable files in ${root}. The scan was stopped rather than reporting a false clean result.`,
    );
  }

  const fileSet = new Set(files);
  const trackedSet = gitRepository ? new Set(tracked) : null;

  return {
    root,
    files,
    gitRepository,
    inventorySource,
    hasFile(relativePath) {
      return fileSet.has(normalise(relativePath));
    },
    isTracked(relativePath) {
      if (trackedSet === null) return null;
      return trackedSet.has(normalise(relativePath));
    },
    async readText(relativePath) {
      const safeRelative = normalise(relativePath);
      if (!fileSet.has(safeRelative)) return null;
      const absolute = path.resolve(root, safeRelative);
      if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
      try {
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_TEXT_BYTES) return null;
        const buffer = await fs.readFile(absolute);
        if (buffer.includes(0)) return null;
        return buffer.toString("utf8");
      } catch {
        return null;
      }
    }
  };
}

function summarise(findings: Finding[]): ScanReport["summary"] {
  const summary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}

export async function scanProject(projectPath: string, checks: CheckDefinition[], version = "0.0.0-alpha.4"): Promise<ScanReport> {
  const context = await createProjectContext(projectPath);
  const findings: Finding[] = [];
  const results: CheckResult[] = [];

  for (const check of checks) {
    const started = performance.now();
    try {
      const checkFindings = await check.run(context);
      findings.push(...checkFindings);
      results.push({
        checkId: check.id,
        pack: check.pack,
        status: checkFindings.length > 0 ? "findings" : "passed",
        findingCount: checkFindings.length,
        durationMs: Math.max(0, Math.round(performance.now() - started))
      });
    } catch (error) {
      results.push({
        checkId: check.id,
        pack: check.pack,
        status: "error",
        findingCount: 0,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const report = {
    schemaVersion: "0.1" as const,
    tool: { name: "ship-check" as const, version },
    project: {
      path: context.root,
      gitRepository: context.gitRepository,
      inventorySource: context.inventorySource,
      fileCount: context.files.length
    },
    packs: [...new Set(checks.map((check) => check.pack))],
    checks: results,
    findings: findings.sort((a, b) => `${a.severity}:${a.id}`.localeCompare(`${b.severity}:${b.id}`)),
    summary: summarise(findings),
    generatedAt: new Date().toISOString()
  };

  return ScanReportSchema.parse(report);
}
