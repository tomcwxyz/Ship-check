import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareReports,
  formatPullRequestComparison,
} from "./github-action-comparison.mjs";

const allowedPacks = new Set(["secure-build", "production-ready", "cost-aware"]);
const allowedFailOn = new Set(["never", "critical", "high", "medium", "low", "info"]);

function input(name, fallback = "") {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key] ?? fallback;
}

function parseBoolean(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveWorkspacePath(workspace, value, label) {
  const resolved = path.resolve(workspace, value || ".");
  if (!within(workspace, resolved)) {
    throw new Error(`${label} must stay inside the checked-out GitHub workspace.`);
  }
  return resolved;
}

function writeOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  return fs.appendFile(output, `${name}=${String(value)}\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function scanArguments(cli, target, packs, options = {}) {
  const args = [
    cli,
    "scan",
    target,
    "--format",
    "json",
    "--fail-on",
    options.failOn ?? "never",
  ];
  for (const pack of [...new Set(packs)]) args.push("--pack", pack);
  if (options.deploymentUrl) args.push("--deployment-url", options.deploymentUrl);
  if (options.networkedDependencyScan) args.push("--networked-dependency-scan");
  return args;
}

function parseScanReport(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(`${label} did not produce a JSON report: ${detail.slice(0, 500)}`);
  }
}

async function runScan(cli, target, packs, options) {
  const result = await run(
    process.execPath,
    scanArguments(cli, target, packs, options),
    {
      cwd: options.cwd,
      env: options.environment,
    },
  );
  return {
    result,
    report: parseScanReport(result, options.label ?? "Ship Check"),
  };
}

async function pullRequestContext() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return null;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  const payload = JSON.parse(await fs.readFile(eventPath, "utf8"));
  const baseSha = payload?.pull_request?.base?.sha;
  const baseRef = payload?.pull_request?.base?.ref;
  if (typeof baseSha !== "string" || !/^[a-f0-9]{40,64}$/.test(baseSha)) {
    throw new Error("GitHub pull request base SHA was unavailable or malformed.");
  }
  return {
    baseSha,
    baseRef: typeof baseRef === "string" ? baseRef : "",
  };
}

async function materialiseBaseWorktree(workspace, baseSha) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-pr-base-"));
  const worktreePath = path.join(temporaryRoot, "base");
  let worktreeAdded = false;

  try {
    const fetched = await run(
      "git",
      ["-C", workspace, "fetch", "--no-tags", "--depth", "1", "origin", baseSha],
      { cwd: workspace, env: process.env },
    );
    if (fetched.code !== 0) {
      throw new Error(`Could not fetch the pull request base commit: ${fetched.stderr.trim().slice(0, 300)}`);
    }

    const added = await run(
      "git",
      ["-C", workspace, "worktree", "add", "--detach", worktreePath, baseSha],
      { cwd: workspace, env: process.env },
    );
    if (added.code !== 0) {
      throw new Error(`Could not materialise the pull request base commit: ${added.stderr.trim().slice(0, 300)}`);
    }
    worktreeAdded = true;

    return {
      path: worktreePath,
      cleanup: async () => {
        if (worktreeAdded) {
          await run(
            "git",
            ["-C", workspace, "worktree", "remove", "--force", worktreePath],
            { cwd: workspace, env: process.env },
          );
        }
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (worktreeAdded) {
      await run(
        "git",
        ["-C", workspace, "worktree", "remove", "--force", worktreePath],
        { cwd: workspace, env: process.env },
      );
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function appendPullRequestSummary(comparison, context) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await fs.appendFile(
    summaryPath,
    "\n" + formatPullRequestComparison(comparison, context),
  );
}

function comparisonOutputs(comparison) {
  if (!comparison?.comparable) {
    return {
      status: "unavailable",
      newFindings: 0,
      reactivatedFindings: 0,
      acceptedFindings: 0,
      noLongerActiveFindings: 0,
      newGaps: 0,
      noLongerActiveGaps: 0,
      newSurfaces: 0,
    };
  }
  return {
    status: "compared",
    newFindings: comparison.findings.introduced.length,
    reactivatedFindings: comparison.findings.reactivated.length,
    acceptedFindings: comparison.findings.accepted.length,
    noLongerActiveFindings: comparison.findings.noLongerActive.length,
    newGaps: comparison.gaps.introduced.length,
    noLongerActiveGaps: comparison.gaps.noLongerActive.length,
    newSurfaces: comparison.surfaces.introduced.length,
  };
}

function sourceProvenance(report) {
  const source = report?.project?.snapshot?.source;
  if (!source) return "project evidence";
  return `${source.provider} · ${source.acquisition} · ${source.executionLocation}`;
}

async function appendSummary(report, scanExitCode) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const gaps = Array.isArray(report?.gaps) ? report.gaps.length : 0;
  const suppressed = Array.isArray(report?.suppressedFindings)
    ? report.suppressedFindings.length
    : Number(report?.summary?.suppressed ?? 0);
  const observations = Array.isArray(report?.observations) ? report.observations.length : 0;
  const notAssessed = Array.isArray(report?.checks)
    ? report.checks.filter((check) => check.status === "not-assessed").length
    : 0;
  const fingerprint = report?.project?.snapshot?.inventory?.fingerprint;
  const fingerprintLabel = fingerprint
    ? `${fingerprint.completeness} source fingerprint · ${fingerprint.hashedEntryCount}/${fingerprint.entryCount} entries hashed`
    : "source fingerprint unavailable";

  const lines = [
    "## Ship Check",
    "",
    `**${report?.summary?.total ?? 0} active findings** · ${suppressed} suppressed · ${gaps} unanswered · ${observations} observed · ${notAssessed} checks not assessed`,
    "",
    `Evidence: ${sourceProvenance(report)}`,
    `Snapshot: ${fingerprintLabel}`,
    `Engine: ${report?.tool?.version ?? "unknown"}`,
    "",
    scanExitCode === 0
      ? "The configured CI threshold was not crossed."
      : "The configured CI threshold was crossed. See the report artifact/path for bounded evidence and repair guidance.",
    "",
    "_Ship Check is bounded assurance evidence, not security or compliance certification._",
    "",
  ];
  await fs.appendFile(summaryPath, lines.join("\n"));
}

async function main() {
  const actionPath = process.env.GITHUB_ACTION_PATH;
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!actionPath || !workspace) {
    throw new Error("This runner is intended to execute inside GitHub Actions.");
  }

  const target = resolveWorkspacePath(workspace, input("path", "."), "path");
  const reportPath = resolveWorkspacePath(
    workspace,
    input("report-path", ".ship-check/report.json"),
    "report-path",
  );
  const failOn = input("fail-on", "high").trim().toLowerCase();
  if (!allowedFailOn.has(failOn)) {
    throw new Error(`Unknown fail-on severity: ${failOn}`);
  }

  const packs = input("packs", "secure-build,production-ready,cost-aware")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (packs.length === 0 || packs.some((pack) => !allowedPacks.has(pack))) {
    throw new Error("packs must contain secure-build, production-ready and/or cost-aware.");
  }

  const cli = path.join(actionPath, "packages", "cli", "dist", "index.js");
  const deploymentUrl = input("deployment-url").trim();
  const networkedDependencyScan = parseBoolean(input("networked-dependency-scan"));
  const prComparisonEnabled = parseBoolean(input("pr-comparison", "true"));

  const repository = process.env.GITHUB_REPOSITORY || "github-workspace";
  const relativeTarget = path.relative(workspace, target).replace(/\\/g, "/") || ".";
  const sourceLabel = relativeTarget === "." ? repository : `${repository}:${relativeTarget}`;
  const environment = {
    ...process.env,
    SHIP_CHECK_EXECUTION_LOCATION: "ci-runner",
    SHIP_CHECK_SOURCE_PROVIDER: "github",
    SHIP_CHECK_SOURCE_LABEL: sourceLabel,
    SHIP_CHECK_SOURCE_ID: `github:${sourceLabel}`,
    SHIP_CHECK_SOURCE_REF: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "",
  };

  const { result, report } = await runScan(cli, target, packs, {
    cwd: workspace,
    environment,
    failOn,
    deploymentUrl,
    networkedDependencyScan,
    label: "Ship Check",
  });

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

  const relativeReport = path.relative(workspace, reportPath).replace(/\\/g, "/");
  await Promise.all([
    writeOutput("report-path", relativeReport),
    writeOutput("exit-code", result.code),
    writeOutput("finding-count", report?.summary?.total ?? 0),
    writeOutput("unverified-count", Array.isArray(report?.gaps) ? report.gaps.length : 0),
    writeOutput("snapshot-completeness", report?.project?.snapshot?.inventory?.fingerprint?.completeness ?? "unknown"),
  ]);
  await appendSummary(report, result.code);

  let comparison = null;
  let comparisonContext = null;
  let comparisonStatus = prComparisonEnabled ? "not-applicable" : "disabled";

  if (prComparisonEnabled) {
    try {
      const prContext = await pullRequestContext();
      if (prContext) {
        comparisonContext = prContext;
        const materialised = await materialiseBaseWorktree(workspace, prContext.baseSha);
        try {
          const baseTarget = relativeTarget === "."
            ? materialised.path
            : path.join(materialised.path, relativeTarget);
          const baseStat = await fs.stat(baseTarget).catch(() => null);

          if (!baseStat?.isDirectory()) {
            comparison = {
              comparable: false,
              reason: "The configured project path did not exist at the pull request base commit.",
            };
          } else {
            let currentSourceReport = report;
            if (deploymentUrl) {
              currentSourceReport = (await runScan(cli, target, packs, {
                cwd: workspace,
                environment,
                failOn: "never",
                networkedDependencyScan,
                label: "Current source comparison scan",
              })).report;
            }

            const baseEnvironment = {
              ...environment,
              SHIP_CHECK_SOURCE_REF: prContext.baseSha,
            };
            const baseReport = (await runScan(cli, baseTarget, packs, {
              cwd: materialised.path,
              environment: baseEnvironment,
              failOn: "never",
              networkedDependencyScan,
              label: "Pull request base scan",
            })).report;

            comparison = compareReports(baseReport, currentSourceReport);
          }
        } finally {
          await materialised.cleanup();
        }

        comparisonStatus = comparison?.comparable ? "compared" : "unavailable";
        await appendPullRequestSummary(comparison, prContext);
      }
    } catch (error) {
      comparisonStatus = "unavailable";
      const message = (error instanceof Error ? error.message : String(error))
        .replaceAll(workspace, "<workspace>")
        .replaceAll(os.tmpdir(), "<temp>")
        .slice(0, 300);
      comparison = { comparable: false, reason: "The exact pull request base could not be compared in this runner." };
      await appendPullRequestSummary(comparison, comparisonContext ?? {});
      process.stderr.write(`Ship Check PR comparison unavailable: ${message}\n`);
    }
  }

  const delta = comparisonOutputs(comparison);
  await Promise.all([
    writeOutput("comparison-status", comparisonStatus === "compared" ? delta.status : comparisonStatus),
    writeOutput("new-finding-count", delta.newFindings),
    writeOutput("reactivated-finding-count", delta.reactivatedFindings),
    writeOutput("accepted-finding-count", delta.acceptedFindings),
    writeOutput("no-longer-active-finding-count", delta.noLongerActiveFindings),
    writeOutput("new-unverified-count", delta.newGaps),
    writeOutput("no-longer-active-unverified-count", delta.noLongerActiveGaps),
    writeOutput("new-surface-count", delta.newSurfaces),
  ]);

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }
}

main().catch((error) => {
  console.error(`Ship Check Action failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
