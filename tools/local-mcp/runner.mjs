import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const MAX_OUTPUT = 1024 * 1024;
const MAX_TIME_MS = 120_000;

export async function resolveProjectRoot(configuredRoot, requested = ".") {
  const root = await realpath(path.resolve(configuredRoot));
  if (typeof requested !== "string" || requested.length > 512 || path.isAbsolute(requested)) {
    throw new Error("Only relative project paths inside the configured root are allowed.");
  }
  const candidate = await realpath(path.resolve(root, requested));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Project path must stay inside the configured root.");
  }
  if (!(await stat(candidate)).isDirectory()) throw new Error("Project path must be a directory.");
  return candidate;
}

/** Return bounded, evidence-led summaries; never send raw scan evidence to the MCP client. */
export function boundedReport(raw, limit = 12) {
  if (!raw || typeof raw !== "object" || !raw.summary || !Array.isArray(raw.findings)) {
    throw new Error("Ship Check returned an invalid report.");
  }
  const findings = raw.findings
    .map((f) => ({
      id: String(f.id || "").slice(0, 180),
      title: String(f.title || "").slice(0, 180),
      severity: String(f.severity || "unknown"),
      knownExploited: String(f.summary || "").includes("CISA KEV: known exploited"),
      summary: String(f.summary || "").slice(0, 650),
      fix: String(f.remediation?.fix || "").slice(0, 650)
    }))
    .sort((a, b) => Number(b.knownExploited) - Number(a.knownExploited));
  return {
    generatedAt: raw.generatedAt,
    snapshot: { completeness: raw.project?.snapshot?.fingerprint?.completeness ?? "unknown" },
    totals: {
      findings: raw.findings.length,
      unverified: Array.isArray(raw.gaps) ? raw.gaps.length : 0,
      errorChecks: Array.isArray(raw.checks) ? raw.checks.filter((c) => c.status === "error").length : 0
    },
    findings: findings.slice(0, limit),
    unverified: (Array.isArray(raw.gaps) ? raw.gaps : []).slice(0, limit).map((g) => ({
      title: String(g.title || "").slice(0, 180),
      summary: String(g.summary || "").slice(0, 500)
    })),
    coverage: (Array.isArray(raw.coverage) ? raw.coverage : []).map((c) => ({
      area: c.area, status: c.status
    })),
    truncated: findings.length > limit || (Array.isArray(raw.gaps) && raw.gaps.length > limit),
    caution: "No findings does not establish safety; check missing evidence and deployment-specific controls."
  };
}

export function invokeShipCheck(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    // No shell invocation; tool arguments cannot inject commands.
    const bin = options.bin || process.env.SHIP_CHECK_BIN || "ship-check";
    const child = spawn(bin, args, { cwd, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    let finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      done(new Error("The scanner exceeded its time limit."));
    }, MAX_TIME_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s) => {
      output += s;
      if (output.length > MAX_OUTPUT) {
        child.kill();
        done(new Error("The scanner report exceeded the output limit."));
      }
    });
    child.stderr.on("data", (s) => { stderr = (stderr + s).slice(-2000); });
    child.on("error", () => done(new Error("Ship Check CLI was not found. Install the CLI and set SHIP_CHECK_BIN if needed.")));
    child.on("close", (code) => {
      if (code === 0 || code === 2) done(null, output);
      else done(new Error(`Ship Check could not complete (exit ${code ?? "unknown"}). Review it locally in your terminal.`));
    });
  });
}
