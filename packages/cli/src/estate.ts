import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { ScanReport, Severity } from "@ship-check/schemas";
import { isUnavailableScannerGap } from "./reportMarkdown.js";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor"
]);

const projectMarkers = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "mix.exs",
  "deno.json",
  "deno.jsonc"
]);

export type DiscoveredProject = {
  path: string;
  relativePath: string;
  gitRepository: boolean;
  markers: string[];
};

export type EstateProjectResult =
  | {
      relativePath: string;
      status: "scanned";
      report: ScanReport;
    }
  | {
      relativePath: string;
      status: "failed";
      error: string;
    };

export type EstateScanReport = {
  schemaVersion: "0.1";
  type: "ship-check-estate-report";
  tool: {
    name: "ship-check";
    version: string;
  };
  root: string;
  projectCount: number;
  scannedCount: number;
  failedCount: number;
  summary: {
    findings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    unverified: number;
    checkErrors: number;
    scannerUnavailable: number;
  };
  projects: EstateProjectResult[];
  generatedAt: string;
};

export type DiscoverEstateOptions = {
  maxDepth?: number;
};

function normaliseRelative(root: string, candidate: string): string {
  const relative = path.relative(root, candidate).split(path.sep).join("/");
  return relative || ".";
}

function isHiddenDirectory(name: string): boolean {
  return name.startsWith(".") && name !== ".git";
}

export async function discoverProjectDirectories(
  estateRoot: string,
  options: DiscoverEstateOptions = {}
): Promise<DiscoveredProject[]> {
  const root = path.resolve(estateRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error(`Ship Check needs an estate directory: ${root}`);
  }

  const maxDepth = options.maxDepth ?? 3;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 12) {
    throw new Error("Estate discovery max depth must be an integer between 0 and 12.");
  }

  const projects: DiscoveredProject[] = [];

  async function visit(current: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    const gitEntry = entries.find((entry) => entry.name === ".git");
    const markers = entries
      .filter((entry) => entry.isFile() && projectMarkers.has(entry.name))
      .map((entry) => entry.name)
      .sort();

    if (gitEntry || markers.length > 0) {
      projects.push({
        path: current,
        relativePath: normaliseRelative(root, current),
        gitRepository: Boolean(gitEntry),
        markers
      });
      return;
    }

    if (depth >= maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignoredDirectories.has(entry.name) || isHiddenDirectory(entry.name)) continue;
      await visit(path.join(current, entry.name), depth + 1);
    }
  }

  await visit(root, 0);
  return projects.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function unavailableScannerGaps(report: ScanReport): number {
  return (report.gaps ?? []).filter(isUnavailableScannerGap).length;
}

export function buildEstateScanReport(
  estateRoot: string,
  projects: EstateProjectResult[],
  version: string
): EstateScanReport {
  const scanned = projects.filter(
    (project): project is Extract<EstateProjectResult, { status: "scanned" }> =>
      project.status === "scanned"
  );

  const summary = {
    findings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    unverified: 0,
    checkErrors: 0,
    scannerUnavailable: 0
  };

  for (const project of scanned) {
    summary.findings += project.report.summary.total;
    summary.critical += project.report.summary.critical;
    summary.high += project.report.summary.high;
    summary.medium += project.report.summary.medium;
    summary.low += project.report.summary.low;
    summary.info += project.report.summary.info;
    summary.unverified += project.report.gaps?.length ?? 0;
    summary.checkErrors += project.report.checks.filter((check) => check.status === "error").length;
    summary.scannerUnavailable += unavailableScannerGaps(project.report);
  }

  return {
    schemaVersion: "0.1",
    type: "ship-check-estate-report",
    tool: { name: "ship-check", version },
    root: path.resolve(estateRoot),
    projectCount: projects.length,
    scannedCount: scanned.length,
    failedCount: projects.length - scanned.length,
    summary,
    projects,
    generatedAt: new Date().toISOString()
  };
}

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

function markdownEvidenceLocation(pathValue?: string, line?: number): string {
  if (!pathValue) return "Project evidence";
  return `${pathValue}${line ? `:${line}` : ""}`;
}

export function renderEstateMarkdown(estate: EstateScanReport): string {
  const lines: string[] = [
    "# Ship Check estate review",
    "",
    `Scanned **${estate.scannedCount}** of **${estate.projectCount}** discovered projects under \`${estate.root}\`.`,
    "",
    `**${estate.summary.findings}** confirmed findings · **${estate.summary.unverified}** unanswered controls · **${estate.summary.scannerUnavailable}** unavailable scanner checks · **${estate.summary.checkErrors}** check errors.`,
    ""
  ];

  if (estate.failedCount > 0) {
    lines.push("## Scans that did not complete", "");
    for (const project of estate.projects.filter(
      (item): item is Extract<EstateProjectResult, { status: "failed" }> => item.status === "failed"
    )) {
      lines.push(`- **${project.relativePath}** — ${project.error}`);
    }
    lines.push("");
  }

  const unavailable = estate.projects
    .filter((item): item is Extract<EstateProjectResult, { status: "scanned" }> => item.status === "scanned")
    .map((project) => ({
      project,
      gaps: project.report.gaps.filter(isUnavailableScannerGap)
    }))
    .filter((entry) => entry.gaps.length > 0);

  if (unavailable.length > 0) {
    lines.push("## Evidence that could not be collected", "");
    lines.push("These checks were requested but did not complete. Do not read the affected area as assessed.", "");
    for (const entry of unavailable) {
      for (const gap of entry.gaps) {
        lines.push(`- **${entry.project.relativePath}** — ${gap.title}: ${gap.verify}`);
      }
    }
    lines.push("");
  }

  // Keep project order neutral and attributable. Severity still orders findings within a
  // project, but the estate must not invent an overall project ranking or infer missing
  // status/ownership context merely to decide which repository appears first.
  const ordered = estate.projects
    .filter((item): item is Extract<EstateProjectResult, { status: "scanned" }> => item.status === "scanned")
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  lines.push("## Projects needing attention", "");

  let attentionProjects = 0;
  for (const project of ordered) {
    const report = project.report;
    if (report.findings.length === 0 && report.gaps.length === 0 && !report.checks.some((check) => check.status === "error")) {
      continue;
    }
    attentionProjects += 1;
    lines.push(`### ${project.relativePath}`, "");
    if (report.project.context) {
      const declared = [
        report.project.context.status ? `status: ${report.project.context.status}` : "",
        report.project.context.ownership ? `ownership: ${report.project.context.ownership}` : ""
      ].filter(Boolean).join(" · ");
      lines.push(`Declared project context — ${declared}.`, "");
    }
    lines.push(
      `${report.summary.total} findings · ${report.gaps.length} unanswered controls · ${report.checks.filter((check) => check.status === "error").length} check errors.`,
      ""
    );

    for (const finding of [...report.findings].sort((left, right) =>
      severityRank[right.severity] - severityRank[left.severity] || left.title.localeCompare(right.title)
    )) {
      const evidence = finding.evidence[0];
      lines.push(
        `- **[${finding.severity.toUpperCase()}] ${finding.title}** — ${finding.summary}`,
        `  - Evidence: ${markdownEvidenceLocation(evidence?.path, evidence?.line)}`,
        `  - Fix: ${finding.remediation.fix}`,
        `  - Verify: ${finding.remediation.verify}`
      );
    }

    for (const gap of report.gaps.filter((gap) => !isUnavailableScannerGap(gap))) {
      lines.push(
        `- **[VERIFY] ${gap.title}** — ${gap.summary}`,
        `  - Verify: ${gap.verify}`
      );
    }
    lines.push("");
  }

  if (attentionProjects === 0) {
    lines.push("No confirmed findings or unanswered controls were reported in the areas assessed.", "");
  }

  const quiet = ordered.filter((project) =>
    project.report.findings.length === 0 &&
    project.report.gaps.length === 0 &&
    !project.report.checks.some((check) => check.status === "error")
  );
  if (quiet.length > 0) {
    lines.push("## Quiet scans", "");
    lines.push(
      `${quiet.length} project${quiet.length === 1 ? "" : "s"} had no confirmed findings or unanswered controls in the areas checked. This is not a claim that those projects are safe or fully assessed.`,
      ""
    );
    for (const project of quiet) lines.push(`- ${project.relativePath}`);
    lines.push("");
  }

  lines.push(
    "## Handoff rules",
    "",
    "- Treat confirmed findings as evidence-backed concerns.",
    "- Treat unanswered controls as questions to investigate before changing code.",
    "- Do not reveal secret values while investigating credential findings.",
    "- Do not infer that unassessed areas are safe.",
    "- Preserve intended behaviour, run relevant project tests after repairs, then rerun Ship Check.",
    "- Keep any agent judgement or contextual classification separate from Ship Check's deterministic result.",
    "",
    "Ship Check reports bounded project evidence, not security or compliance certification."
  );

  return lines.join("\n");
}
