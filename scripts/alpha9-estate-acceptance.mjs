import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT_ROOT = ".ship-check-alpha9";
const IGNORED_PROJECT_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function usage() {
  return [
    "Usage:",
    "  node scripts/alpha9-estate-acceptance.mjs <estate-root> [options]",
    "",
    "Options:",
    "  --max-depth <0-12>                Discovery depth (default 3)",
    "  --git-history-secrets             Include local Git-history credential evidence",
    "  --local-semgrep-scan              Request the pinned local Semgrep rules",
    "  --networked-dependency-scan       Explicitly opt into OSV network checks",
    "  --skip-build                      Reuse the existing workspace build",
    "",
    "The acceptance output stays local under .ship-check-alpha9/ and may contain",
    "local paths and bounded evidence. Do not upload it as a public CI artefact.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    root: "",
    maxDepth: 3,
    gitHistorySecrets: false,
    localSemgrepScan: false,
    networkedDependencyScan: false,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--max-depth") {
      const next = argv[index + 1];
      if (next === undefined) throw new Error("--max-depth requires a value.");
      options.maxDepth = Number(next);
      index += 1;
      continue;
    }
    if (value === "--git-history-secrets") {
      options.gitHistorySecrets = true;
      continue;
    }
    if (value === "--local-semgrep-scan") {
      options.localSemgrepScan = true;
      continue;
    }
    if (value === "--networked-dependency-scan") {
      options.networkedDependencyScan = true;
      continue;
    }
    if (value === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (value?.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    if (options.root) throw new Error(`Unexpected extra path: ${value}`);
    options.root = value;
  }

  if (!options.root) throw new Error(usage());
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0 || options.maxDepth > 12) {
    throw new Error("--max-depth must be an integer between 0 and 12.");
  }
  return options;
}

function processFailure(error, fallback) {
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  return [fallback, stdout, stderr].filter(Boolean).join("\n");
}

async function buildCli() {
  console.log("Building Ship Check once for the estate acceptance pass…");
  try {
    await execFileAsync(command("pnpm"), ["build"], {
      cwd: process.cwd(),
      windowsHide: true,
      shell: process.platform === "win32",
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(processFailure(error, "Ship Check workspace build failed before the estate scan."));
  }
}

async function runEstateScan(options) {
  const args = [
    "packages/cli/dist/index.js",
    "scan-dir",
    path.resolve(options.root),
    "--max-depth",
    String(options.maxDepth),
    "--format",
    "json",
    "--fail-on",
    "never",
  ];
  if (options.gitHistorySecrets) args.push("--git-history-secrets");
  if (options.localSemgrepScan) args.push("--local-semgrep-scan");
  if (options.networkedDependencyScan) args.push("--networked-dependency-scan");

  console.log(`Scanning estate: ${path.resolve(options.root)}`);
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: 2_700_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(processFailure(error, "Ship Check estate scan failed."));
  }
}

function reviewProjects(estate) {
  return estate.projects.filter(
    (project) =>
      project.status === "scanned" &&
      (
        (project.report?.findings?.length ?? 0) > 0 ||
        (project.report?.gaps?.length ?? 0) > 0 ||
        (project.report?.checks ?? []).some((check) => check.status === "error")
      ),
  );
}

function focusProjects(estate) {
  return estate.projects.filter(
    (project) =>
      project.status === "scanned" &&
      ((project.report?.findings?.length ?? 0) > 0 || (project.report?.gaps?.length ?? 0) > 0),
  );
}

function ignoredPathHits(estate) {
  return estate.projects
    .map((project) => project.relativePath)
    .filter((relativePath) =>
      String(relativePath)
        .split("/")
        .some((segment) => IGNORED_PROJECT_SEGMENTS.has(segment)),
    );
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function scoreLikeKeys(value, prefix = "") {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      hits.push(...scoreLikeKeys(value[index], `${prefix}[${index}]`));
    }
    return hits;
  }

  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (["score", "rank", "attentionScore", "priorityScore", "statusWeight", "ownershipWeight"].includes(key)) {
      hits.push(next);
    }
    hits.push(...scoreLikeKeys(child, next));
  }
  return hits;
}

function leakedSecretEvidence(estate) {
  const secretShape =
    /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const hits = [];

  for (const project of estate.projects) {
    if (project.status !== "scanned") continue;
    for (const finding of project.report.findings ?? []) {
      if (!/secret|credential|gitleaks/i.test(`${finding.checkId} ${finding.title}`)) continue;
      for (const evidence of finding.evidence ?? []) {
        const excerpt = typeof evidence.excerpt === "string" ? evidence.excerpt : "";
        if (secretShape.test(excerpt)) {
          hits.push({ project: project.relativePath, findingId: finding.id });
        }
      }
    }
  }
  return hits;
}

function scannerProminenceCheck(estate, markdown) {
  if ((estate.summary?.scannerUnavailable ?? 0) === 0) {
    return {
      id: "scanner-prominence",
      label: "Unavailable scanners remain explicit",
      status: "pass",
      detail: "No requested scanner was unavailable in this pass.",
    };
  }
  const prominent = markdown.includes("## Evidence that could not be collected");
  return {
    id: "scanner-prominence",
    label: "Unavailable scanners remain explicit",
    status: prominent ? "pass" : "fail",
    detail: prominent
      ? `${estate.summary.scannerUnavailable} unavailable scanner check(s) are called out separately.`
      : "The aggregate reports unavailable scanner evidence but the Markdown hand-off does not give it a dedicated section.",
  };
}

export function evaluateEstate(estate, markdown, selectFocusedReview) {
  const projects = Array.isArray(estate.projects) ? estate.projects : [];
  const scanned = projects.filter((project) => project.status === "scanned");
  const failed = projects.filter((project) => project.status === "failed");
  const relativePaths = projects.map((project) => project.relativePath);
  const duplicatePaths = duplicateValues(relativePaths);
  const ignoredHits = ignoredPathHits(estate);
  const scoreKeys = scoreLikeKeys(estate);
  const secretLeaks = leakedSecretEvidence(estate);
  const malformed = scanned.filter(
    (project) =>
      !project.report ||
      !Array.isArray(project.report.findings) ||
      !Array.isArray(project.report.gaps) ||
      !Array.isArray(project.report.checks) ||
      !Array.isArray(project.report.coverage),
  );

  const focusFailures = [];
  const focusSummaries = [];
  for (const project of focusProjects(estate)) {
    try {
      const focused = selectFocusedReview(project.report);
      const expectedType = project.report.findings.length > 0 ? "finding" : "unverified";
      const expectedAction = expectedType === "finding" ? "fix" : "verify";
      if (focused.type !== expectedType || focused.action !== expectedAction) {
        focusFailures.push(
          `${project.relativePath}: expected ${expectedAction}/${expectedType}, got ${focused.action}/${focused.type}`,
        );
      }
      focusSummaries.push({
        project: project.relativePath,
        type: focused.type,
        action: focused.action,
        ...(focused.id ? { id: focused.id } : {}),
        ...(focused.title ? { title: focused.title } : {}),
      });
    } catch (error) {
      focusFailures.push(
        `${project.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const markdownHeadings = [...markdown.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  const expectedHeadings = reviewProjects(estate)
    .map((project) => project.relativePath)
    .sort((left, right) => left.localeCompare(right));
  const neutralOrder =
    markdownHeadings.length === expectedHeadings.length &&
    markdownHeadings.every((heading, index) => heading === expectedHeadings[index]);

  const countConsistent =
    estate.projectCount === projects.length &&
    estate.scannedCount === scanned.length &&
    estate.failedCount === failed.length;

  const checks = [
    {
      id: "aggregate-counts",
      label: "Aggregate project counts match project records",
      status: countConsistent ? "pass" : "fail",
      detail: countConsistent
        ? `${scanned.length} scanned + ${failed.length} failed = ${projects.length} discovered.`
        : "Aggregate project counts do not match the project records.",
    },
    {
      id: "unique-projects",
      label: "Discovered project roots are unique",
      status: duplicatePaths.length === 0 ? "pass" : "fail",
      detail:
        duplicatePaths.length === 0
          ? "No duplicate relative project paths."
          : `Duplicate roots: ${duplicatePaths.join(", ")}`,
    },
    {
      id: "ignored-directories",
      label: "Discovery avoids dependency/build directories",
      status: ignoredHits.length === 0 ? "pass" : "fail",
      detail:
        ignoredHits.length === 0
          ? "No discovered project root sits under a known ignored dependency/build directory."
          : `Unexpected roots: ${ignoredHits.join(", ")}`,
    },
    {
      id: "project-boundaries",
      label: "Every completed project retains a complete independent report shape",
      status: malformed.length === 0 ? "pass" : "fail",
      detail:
        malformed.length === 0
          ? `${scanned.length} completed project reports retain findings, questions, checks and coverage separately.`
          : `Malformed project reports: ${malformed.map((project) => project.relativePath).join(", ")}`,
    },
    scannerProminenceCheck(estate, markdown),
    {
      id: "neutral-order",
      label: "Aggregate hand-off has neutral project ordering",
      status: neutralOrder ? "pass" : "fail",
      detail: neutralOrder
        ? "Projects needing attention are ordered by path, not a hidden estate score."
        : "Project headings are not in the expected neutral path order.",
    },
    {
      id: "no-score-contract",
      label: "Estate JSON exposes no score/rank field",
      status: scoreKeys.length === 0 ? "pass" : "fail",
      detail:
        scoreKeys.length === 0
          ? "No score, rank or hidden weighting field was found in the aggregate contract."
          : `Score-like keys found: ${scoreKeys.join(", ")}`,
    },
    {
      id: "secret-redaction",
      label: "Credential findings do not echo recognisable secret material in evidence excerpts",
      status: secretLeaks.length === 0 ? "pass" : "fail",
      detail:
        secretLeaks.length === 0
          ? "No recognisable credential-shaped material was found in secret-finding evidence excerpts."
          : `Potential secret material found in ${secretLeaks.length} evidence excerpt(s); inspect locally immediately.`,
    },
    {
      id: "focused-handoff",
      label: "Every active project can produce the canonical FIX / VERIFY hand-off",
      status: focusFailures.length === 0 ? "pass" : "fail",
      detail:
        focusFailures.length === 0
          ? `${focusSummaries.length} project(s) with active findings/questions produced the expected focused action.`
          : focusFailures.join(" | "),
    },
  ];

  return {
    checks,
    focusSummaries,
    manualReview: {
      discoveredRoots: relativePaths,
      advisoryAliasReviewNeeded: Boolean(
        scanned.some((project) =>
          (project.report.findings ?? []).some((finding) =>
            /osv|vulnerab|dependency/i.test(`${finding.checkId} ${finding.title}`),
          ),
        ),
      ),
      failedProjects: failed.map((project) => ({
        project: project.relativePath,
        error: project.error,
      })),
    },
  };
}

function markdownTableCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function acceptanceWorksheet({ estate, evaluation, options, runDirectory }) {
  const lines = [
    "# Ship Check Alpha 0.9 estate acceptance",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "> Local-only acceptance artefact. This folder may contain local paths and bounded project evidence. Do not upload it publicly.",
    "",
    "## Run",
    "",
    `- Estate root: \`${path.resolve(options.root)}\``,
    `- Discovery depth: ${options.maxDepth}`,
    `- Git-history credential scan: ${options.gitHistorySecrets ? "on" : "off"}`,
    `- Local Semgrep: ${options.localSemgrepScan ? "requested" : "off"}`,
    `- Networked dependency scan: ${options.networkedDependencyScan ? "explicitly enabled" : "off"}`,
    `- Projects: ${estate.projectCount} discovered · ${estate.scannedCount} scanned · ${estate.failedCount} failed`,
    "",
    "## Machine-checkable acceptance",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
  ];

  for (const check of evaluation.checks) {
    lines.push(
      `| ${markdownTableCell(check.label)} | **${check.status.toUpperCase()}** | ${markdownTableCell(check.detail)} |`,
    );
  }

  lines.push(
    "",
    "## Manual acceptance still required",
    "",
    "These deliberately remain human judgements rather than being turned into another synthetic score:",
    "",
    "1. **Discovery completeness:** compare the discovered project list below with the folders you actually intended to assess. A clean automated discovery check cannot know about a missing project it never saw.",
    "2. **Finding usefulness:** sample the high/medium findings and unanswered controls. Record false positives, low-value truths and important manual misses.",
    "3. **Dependency consolidation:** if OSV was enabled, confirm package/version units are the first-line problem and CVE/GHSA aliases are not presented as separate independent packages.",
    "4. **Credential handling:** if history scanning was enabled, inspect a sample of history findings and confirm values are redacted and deletion is not described as revocation.",
    "5. **Agent hand-off:** copy at least one FIX and one VERIFY action into the development workflow, make/verify a narrow change, rerun the affected project, and compare before/after state.",
    "",
    "## Discovered projects",
    "",
    ...evaluation.manualReview.discoveredRoots.map((project) => `- [ ] ${project}`),
    "",
    "## Project attention summary",
    "",
    "| Project | State | Findings | Verify | Check errors | Focused next action |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  );

  const focusByProject = new Map(
    evaluation.focusSummaries.map((entry) => [entry.project, entry]),
  );
  for (const project of estate.projects) {
    if (project.status === "failed") {
      lines.push(
        `| ${markdownTableCell(project.relativePath)} | failed | — | — | — | scan did not complete |`,
      );
      continue;
    }
    const focus = focusByProject.get(project.relativePath);
    const errors = project.report.checks.filter((check) => check.status === "error").length;
    lines.push(
      `| ${markdownTableCell(project.relativePath)} | scanned | ${project.report.findings.length} | ${project.report.gaps.length} | ${errors} | ${focus ? `${focus.action.toUpperCase()} · ${markdownTableCell(focus.title ?? focus.id ?? "")}` : "none active"} |`,
    );
  }

  lines.push(
    "",
    "## Local artefacts",
    "",
    `- Full estate JSON: \`${path.relative(process.cwd(), path.join(runDirectory, "estate-report.json"))}\``,
    `- Canonical Markdown hand-off: \`${path.relative(process.cwd(), path.join(runDirectory, "estate-review.md"))}\``,
    `- Acceptance manifest: \`${path.relative(process.cwd(), path.join(runDirectory, "manifest.json"))}\``,
    "",
    "A machine PASS means these bounded invariants held. It is not an estate security score or a claim that every project is safe.",
    "",
  );

  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (!options.skipBuild) await buildCli();

  const estate = await runEstateScan(options);
  const estateModule = await import(
    pathToFileURL(path.resolve("packages/cli/dist/estate.js")).href
  );
  const focusModule = await import(
    pathToFileURL(path.resolve("packages/cli/dist/focus.js")).href
  );

  const markdown = estateModule.renderEstateMarkdown(estate);
  const evaluation = evaluateEstate(estate, markdown, focusModule.selectFocusedReview);
  const runDirectory = path.resolve(OUTPUT_ROOT, timestamp());
  await fs.mkdir(runDirectory, { recursive: true });

  await fs.writeFile(
    path.join(runDirectory, "estate-report.json"),
    `${JSON.stringify(estate, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(runDirectory, "estate-review.md"), `${markdown}\n`, "utf8");
  await fs.writeFile(
    path.join(runDirectory, "manifest.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      options: {
        maxDepth: options.maxDepth,
        gitHistorySecrets: options.gitHistorySecrets,
        localSemgrepScan: options.localSemgrepScan,
        networkedDependencyScan: options.networkedDependencyScan,
      },
      projectCount: estate.projectCount,
      scannedCount: estate.scannedCount,
      failedCount: estate.failedCount,
      checks: evaluation.checks,
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(runDirectory, "ACCEPTANCE.md"),
    `${acceptanceWorksheet({ estate, evaluation, options, runDirectory })}\n`,
    "utf8",
  );

  const failedChecks = evaluation.checks.filter((check) => check.status === "fail");
  console.log(
    `Alpha 0.9 estate acceptance: ${evaluation.checks.length - failedChecks.length}/${evaluation.checks.length} machine checks passed across ${estate.projectCount} discovered projects.`,
  );
  console.log(
    `Review ${path.relative(process.cwd(), path.join(runDirectory, "ACCEPTANCE.md"))}`,
  );
  if (failedChecks.length > 0) {
    console.error(
      `Failed checks: ${failedChecks.map((check) => check.label).join("; ")}`,
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
