import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

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
  const args = [cli, "scan", target, "--format", "json", "--fail-on", failOn];
  for (const pack of [...new Set(packs)]) args.push("--pack", pack);

  const deploymentUrl = input("deployment-url").trim();
  if (deploymentUrl) args.push("--deployment-url", deploymentUrl);
  if (parseBoolean(input("networked-dependency-scan"))) {
    args.push("--networked-dependency-scan");
  }

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

  const result = await run(process.execPath, args, {
    cwd: workspace,
    env: environment,
  });

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new Error(`Ship Check did not produce a JSON report: ${detail.slice(0, 500)}`);
  }

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

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }
}

main().catch((error) => {
  console.error(`Ship Check Action failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
