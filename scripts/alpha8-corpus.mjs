import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT_ROOT = ".ship-check-alpha8";
const DEFAULT_SOURCES = [
  "tomcwxyz/attention-agent-pilot",
  "tomcwxyz/glade",
  "tomcwxyz/Event",
  "tomcwxyz/Trader",
  "tomcwxyz/the-list",
  "tomcwxyz/RELAY",
];

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeName(source) {
  return source
    .replace(/^https?:\/\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "repository";
}

function evidenceLocations(items = []) {
  return items.map((item) => ({
    kind: item.kind,
    ...(item.path ? { path: item.path } : {}),
    ...(item.line ? { line: item.line } : {}),
    detail: item.detail,
  }));
}

function calibrationReport(report, source) {
  return {
    source,
    generatedAt: report.generatedAt,
    tool: report.tool,
    project: {
      inventorySource: report.project?.inventorySource,
      fileCount: report.project?.fileCount,
      ...(report.project?.commit ? { commit: report.project.commit } : {}),
    },
    packs: report.packs,
    summary: report.summary,
    checks: (report.checks ?? []).map((check) => ({
      checkId: check.checkId,
      checkVersion: check.checkVersion,
      pack: check.pack,
      status: check.status,
      findingCount: check.findingCount,
      suppressedCount: check.suppressedCount,
      gapCount: check.gapCount,
      observationCount: check.observationCount,
      ...(check.scannerVersion ? { scannerVersion: check.scannerVersion } : {}),
      ...(check.error ? { error: check.error } : {}),
    })),
    findings: (report.findings ?? []).map((finding) => ({
      id: finding.id,
      checkId: finding.checkId,
      title: finding.title,
      summary: finding.summary,
      severity: finding.severity,
      confidence: finding.confidence,
      evidence: evidenceLocations(finding.evidence),
      verification: finding.remediation?.verify,
    })),
    gaps: (report.gaps ?? []).map((gap) => ({
      id: gap.id,
      checkId: gap.checkId,
      area: gap.area,
      title: gap.title,
      summary: gap.summary,
      evidence: evidenceLocations(gap.evidence),
      verification: gap.verify,
    })),
    observations: (report.observations ?? []).map((observation) => ({
      id: observation.id,
      checkId: observation.checkId,
      area: observation.area,
      title: observation.title,
      summary: observation.summary,
      evidence: evidenceLocations(observation.evidence),
    })),
    coverage: report.coverage,
    suppressedFindings: (report.suppressedFindings ?? []).map((suppression) => ({
      findingId: suppression.finding?.id,
      checkId: suppression.finding?.checkId,
      checkVersion: suppression.checkVersion,
      title: suppression.finding?.title,
    })),
  };
}

function locationText(evidence = []) {
  const locations = evidence
    .map((item) => item.path ? `${item.path}${item.line ? `:${item.line}` : ""}` : item.kind)
    .filter(Boolean);
  return locations.length ? locations.join("<br>") : "Project";
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function repositorySection(result) {
  const lines = [`## ${result.source}`, ""];
  if (result.error) {
    lines.push(`**Scan failed:** ${result.error}`, "");
    return lines.join("\n");
  }

  const report = result.report;
  lines.push(
    `${report.project.fileCount ?? 0} files · ${report.summary.total ?? 0} active findings · ${report.gaps.length} unanswered questions · ${report.observations.length} observations`,
    "",
    "### Findings",
    "",
  );

  if (report.findings.length === 0) {
    lines.push("No active findings.", "");
  } else {
    lines.push("| Classification | Severity | Check | Finding | Evidence | Notes |", "| --- | --- | --- | --- | --- | --- |");
    for (const finding of report.findings) {
      lines.push(`| TBD | ${escapeCell(finding.severity)} | \`${escapeCell(finding.checkId)}\` | ${escapeCell(finding.title)} | ${escapeCell(locationText(finding.evidence))} |  |`);
    }
    lines.push("", "Classification: `useful` · `true-but-low-value` · `false-positive` · `uncertain`", "");
  }

  lines.push("### Unanswered questions", "");
  if (report.gaps.length === 0) {
    lines.push("No unanswered questions.", "");
  } else {
    lines.push("| Classification | Area | Check | Question | Evidence | Notes |", "| --- | --- | --- | --- | --- | --- |");
    for (const gap of report.gaps) {
      lines.push(`| TBD | ${escapeCell(gap.area)} | \`${escapeCell(gap.checkId)}\` | ${escapeCell(gap.title)} | ${escapeCell(locationText(gap.evidence))} |  |`);
    }
    lines.push("", "Classification: `useful-to-verify` · `already-protected-elsewhere` · `heuristic-missed-local-evidence` · `not-useful`", "");
  }

  lines.push(
    "### Manual misses",
    "",
    "Record important concerns or boundaries you expected Ship Check to surface but it did not:",
    "",
    "- ",
    "",
    "### Coverage notes",
    "",
    ...report.coverage.map((entry) => `- **${entry.area}: ${entry.status}** — ${entry.detail}`),
    "",
  );

  return lines.join("\n");
}

async function buildCli() {
  console.log("Building Ship Check CLI once for the corpus pass…");
  await execFileAsync(command("pnpm"), ["--filter", "@ship-check/cli", "build"], {
    cwd: process.cwd(),
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function scanSource(source) {
  console.log(`Scanning ${source}…`);
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["packages/cli/dist/index.js", "scan", source, "--format", "json", "--fail-on", "never"],
      {
        cwd: process.cwd(),
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return { source, report: calibrationReport(JSON.parse(stdout), source) };
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    return {
      source,
      error: stderr || (error instanceof Error ? error.message : String(error)),
    };
  }
}

async function main() {
  const requested = process.argv.slice(2).filter((value) => value.trim());
  const sources = requested.length ? requested : DEFAULT_SOURCES;
  const runDirectory = path.resolve(OUTPUT_ROOT, timestamp());
  const reportsDirectory = path.join(runDirectory, "reports");
  await fs.mkdir(reportsDirectory, { recursive: true });

  await buildCli();

  const results = [];
  for (const source of sources) {
    const result = await scanSource(source);
    results.push(result);
    const target = path.join(reportsDirectory, `${safeName(source)}.json`);
    await fs.writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  const successful = results.filter((result) => result.report).length;
  const failed = results.length - successful;
  const markdown = [
    "# Ship Check alpha.8 corpus calibration",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Sources: ${results.length} · completed: ${successful} · failed: ${failed}`,
    "",
    "This file is deliberately a calibration worksheet, not a pass/fail scorecard. Review every finding and unanswered question against the repository context before deciding whether a rule is useful.",
    "",
    ...results.map(repositorySection),
  ].join("\n");

  await fs.writeFile(path.join(runDirectory, "CALIBRATION.md"), markdown, "utf8");
  await fs.writeFile(
    path.join(runDirectory, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sources, successful, failed }, null, 2)}\n`,
    "utf8",
  );

  console.log(`\nAlpha.8 corpus pass complete: ${successful}/${results.length} repositories scanned.`);
  console.log(`Review ${path.relative(process.cwd(), path.join(runDirectory, "CALIBRATION.md"))}`);
  if (failed > 0) {
    console.log(`${failed} source${failed === 1 ? "" : "s"} could not be scanned; the worksheet records the failure without stopping the remaining corpus.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
