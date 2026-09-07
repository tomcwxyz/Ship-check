import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  ScanReportSchema,
  type AssessmentArea,
  type AssessmentGap,
  type CheckPack,
  type CheckResult,
  type CoverageEntry,
  type Finding,
  type Observation,
  type PracticePrincipleId,
  type ScanReport
} from "@ship-check/schemas";

const execFileAsync = promisify(execFile);
const MAX_TEXT_BYTES = 512 * 1024;
const ignoredDirectories = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "target"]);

export const BUILT_IN_PRACTICE_PRINCIPLES: Record<string, PracticePrincipleId[]> = {
  "secure.tracked-env-file": ["practice.preserve-safety"],
  "secure.secret-pattern": ["practice.preserve-safety"],
  "secure.paid-endpoint-abuse-control": ["practice.preserve-safety", "practice.cost-discipline"],
  "secure.wildcard-cors": ["practice.preserve-safety"],
  "secure.public-secret-env-name": ["practice.preserve-safety"],
  "secure.webhook-signature-verification": ["practice.preserve-safety"],
  "secure.vercel-cron-auth": ["practice.preserve-safety", "practice.cost-discipline"],
  "production.package-lock-discipline": ["practice.dependency-restraint"],
  "production.next-security-headers": ["practice.preserve-safety"],
  "cost.vercel-cron-frequency": ["practice.cost-discipline"],
  "cost.frequent-network-polling": ["practice.cost-discipline"]
};

export const ASSESSMENT_AREAS: AssessmentArea[] = [
  "secrets",
  "access-control",
  "configuration",
  "supply-chain",
  "cost",
  "code-security",
  "database",
  "runtime"
];

const areaLabels: Record<AssessmentArea, string> = {
  secrets: "Secrets and credential exposure",
  "access-control": "Access control and exposed server boundaries",
  configuration: "Application and platform configuration",
  "supply-chain": "Dependency and supply-chain risk",
  cost: "Cost and background-work boundaries",
  "code-security": "Static code security",
  database: "Database permissions and data boundaries",
  runtime: "Deployed runtime behaviour"
};

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

export type CoverageContribution = {
  area: AssessmentArea;
  status: "assessed" | "partial";
};

export type CheckExecution = {
  findings?: Finding[];
  gaps?: AssessmentGap[];
  observations?: Observation[];
  coverage?: CoverageContribution[];
};

export type CheckDefinition = {
  id: string;
  pack: CheckPack;
  title: string;
  description: string;
  principles?: PracticePrincipleId[];
  coverage?: CoverageContribution[];
  run(context: ProjectContext): Promise<Finding[] | CheckExecution>;
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

function normaliseExecution(execution: Finding[] | CheckExecution): Required<CheckExecution> {
  if (Array.isArray(execution)) {
    return { findings: execution, gaps: [], observations: [], coverage: [] };
  }
  return {
    findings: execution.findings ?? [],
    gaps: execution.gaps ?? [],
    observations: execution.observations ?? [],
    coverage: execution.coverage ?? []
  };
}

function summariseCoverage(
  contributions: Array<CoverageContribution & { checkId: string }>
): CoverageEntry[] {
  return ASSESSMENT_AREAS.map((area) => {
    const matches = contributions.filter((entry) => entry.area === area);
    const checkIds = [...new Set(matches.map((entry) => entry.checkId))].sort();
    if (matches.length === 0) {
      return {
        area,
        status: "not-assessed" as const,
        checkIds,
        detail: `${areaLabels[area]} was not assessed by the selected checks.`
      };
    }
    const status = matches.some((entry) => entry.status === "assessed") ? "assessed" as const : "partial" as const;
    return {
      area,
      status,
      checkIds,
      detail: status === "assessed"
        ? `${areaLabels[area]} has deterministic assessment evidence from ${checkIds.length} check${checkIds.length === 1 ? "" : "s"}.`
        : `${areaLabels[area]} was partially assessed by ${checkIds.length} narrow check${checkIds.length === 1 ? "" : "s"}; this is not full verification.`
    };
  });
}

export async function scanProject(projectPath: string, checks: CheckDefinition[], version = "0.0.0-alpha.6"): Promise<ScanReport> {
  const context = await createProjectContext(projectPath);
  const findings: Finding[] = [];
  const gaps: AssessmentGap[] = [];
  const observations: Observation[] = [];
  const results: CheckResult[] = [];
  const coverageContributions: Array<CoverageContribution & { checkId: string }> = [];

  for (const check of checks) {
    const started = performance.now();
    const principles = check.principles ?? BUILT_IN_PRACTICE_PRINCIPLES[check.id] ?? [];
    try {
      const execution = normaliseExecution(await check.run(context));
      findings.push(...execution.findings);
      gaps.push(...execution.gaps);
      observations.push(...execution.observations);
      for (const contribution of [...(check.coverage ?? []), ...execution.coverage]) {
        coverageContributions.push({ ...contribution, checkId: check.id });
      }
      results.push({
        checkId: check.id,
        pack: check.pack,
        principles,
        status: execution.findings.length > 0
          ? "findings"
          : execution.gaps.length > 0
            ? "unverified"
            : "passed",
        findingCount: execution.findings.length,
        gapCount: execution.gaps.length,
        observationCount: execution.observations.length,
        durationMs: Math.max(0, Math.round(performance.now() - started))
      });
    } catch (error) {
      results.push({
        checkId: check.id,
        pack: check.pack,
        principles,
        status: "error",
        findingCount: 0,
        gapCount: 0,
        observationCount: 0,
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
    gaps: gaps.sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`)),
    observations: observations.sort((a, b) => `${a.area}:${a.id}`.localeCompare(`${b.area}:${b.id}`)),
    coverage: summariseCoverage(coverageContributions),
    summary: summarise(findings),
    generatedAt: new Date().toISOString()
  };

  return ScanReportSchema.parse(report);
}
