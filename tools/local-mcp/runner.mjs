import { spawn } from "node:child_process";
import { realpath, stat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
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
    scannerVersion: typeof raw.tool?.version === "string" ? raw.tool.version.slice(0,60) : null,
    snapshot: { completeness: raw.project?.snapshot?.inventory?.fingerprint?.completeness ?? "unknown" },
    technologies: boundedTechnologies(raw),
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

/** Reuse the canonical scan's source-free, structured technology inventory.
 * A report without the new handoff is *unknown*, never a verified empty list.
 */
export function boundedTechnologies(report) {
  const data = report?.monitoringHandoff?.inventory;
  if (!data || data.schemaVersion !== "ship-check-technology-inventory/0.1" ||
      !Array.isArray(data.components) ||
      !["complete", "not-assessed"].includes(data.sourceInventory)) {
    return { available: false, reason: "Scanner does not provide a completed technology inventory." };
  }
  const allowed = new Set(["ai-model", "wordpress-core", "wordpress-plugin", "wordpress-theme", "drupal-package"]);
  const components = data.components.slice(0, 50).filter(item =>
    allowed.has(item?.kind) && typeof item.id === "string" &&
    /^[A-Za-z0-9._/-]{1,160}$/.test(item.id) &&
    (item.version === undefined || (typeof item.version === "string" && /^[A-Za-z0-9._+/-]{1,80}$/.test(item.version)))
  ).map(item => ({kind:item.kind, id:item.id, ...(item.version?{version:item.version}:{}), evidence:"source-declared"}));
  const siteHints = (Array.isArray(data.siteHints) ? data.siteHints : []).slice(0,2)
    .filter(h => ["wordpress","drupal"].includes(h?.cms) && ["likely","possible"].includes(h?.confidence))
    .map(h => ({cms:h.cms,confidence:h.confidence,evidence:"public-website-hint"}));
  return {
    available:true,sourceInventory:data.sourceInventory,components,siteHints,
    truncated:data.components.length>50,
    caution:"A source declaration does not prove production use; a public CMS hint is not an installed-plugin inventory."
  };
}

const INVALID_HOST_SUFFIX = /(?:^|\.)(?:localhost|local|internal|test|invalid|lan|home|arpa|onion)$/i;

/** This is only the *first* URL check. The Node HTTPS transport guard
 * independently rechecks DNS on every connection and pins public IPv4.
 */
export function parsePublicWebsiteUrl(input) {
  if (typeof input !== "string" || input.length > 1700) throw new Error("Enter one public HTTPS website URL.");
  let url;
  try {url = new URL(input);} catch {throw new Error("Enter a valid public HTTPS URL.");}
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      (url.hash || url.search) || isIP(url.hostname) || !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      !url.hostname.includes(".") || INVALID_HOST_SUFFIX.test(url.hostname) ||
      url.pathname.length > 1024) {
    throw new Error("Only public HTTPS hostnames are permitted; IP addresses, private hosts, credentials and ports are not allowed.");
  }
  return url;
}

export function requireCloudMonitoringConsent(monitor) {
  if (!monitor) return false;
  if (process.env.SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE !== "1" ||
      !process.env.SHIP_CHECK_CLOUD_TOKEN?.trim()) {
    throw new Error("Cloud monitoring requires SHIP_CHECK_MCP_ALLOW_CLOUD_WRITE=1 and a scoped SHIP_CHECK_CLOUD_TOKEN configured by the user.");
  }
  return true;
}

/** Website scanning is intentionally Node-only: a compiled native executable
 * could ignore NODE_OPTIONS and bypass the socket-level SSRF guard.
 * SHIP_CHECK_JS_ENTRY points to the installed npm CLI's index.js.
 */
export async function websiteScannerConfiguration(url, options = {}) {
  const entryValue = options.entry ?? process.env.SHIP_CHECK_JS_ENTRY;
  if (typeof entryValue !== "string" || !path.isAbsolute(entryValue) || !/\.[cm]?js$/i.test(entryValue)) {
    throw new Error("Website MCP scans require the absolute Node CLI file SHIP_CHECK_JS_ENTRY (the installed @good-ship/ship-check/index.js).");
  }
  const entry = await realpath(entryValue);
  if (!(await stat(entry)).isFile()) throw new Error("The configured scanner entry is not a file.");
  const guard = fileURLToPath(new URL("../../playground/lib/public-site-fetch-guard.cjs", import.meta.url));
  if (!(await stat(guard)).isFile()) throw new Error("Ship Check public-website network guard is missing.");
  return {
    bin:process.execPath,
    prefixArgs:[entry],
    env:{...process.env,
      SHIP_CHECK_SAFE_SITE_HOST:url.hostname,
      NODE_OPTIONS:"--require " + JSON.stringify(guard)
    }
  };
}

export async function scanWebsite(urlInput, cwd, options = {}) {
  const url = parsePublicWebsiteUrl(urlInput);
  const monitor = requireCloudMonitoringConsent(options.monitor === true);
  const scanner = await websiteScannerConfiguration(url, options);
  const output = await invokeShipCheck(
    ["scan",url.href,"--format","json", ...(monitor?["--monitor"]:[])],
    cwd,scanner
  );
  const report = JSON.parse(output);
  const summary = boundedReport(report);
  return {...summary, website:{hostname:url.hostname, url:url.origin+url.pathname},
    cloudMonitoring:monitor?"enabled":"not-requested"};
}

/** Only GitHub's owner/repo shorthand is accepted. Shell commands,
 * arbitrary Git endpoints and URLs are not valid MCP scan inputs.
 */
export function parsePublicGitHubRepo(value) {
  if(typeof value!=="string" || value.length>140 ||
     !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) {
    throw new Error("Enter a public GitHub repository in owner/repository format.");
  }
  const [owner,name]=value.split("/");
  if (owner==="."||owner===".."||name==="."||name==="..") {
    throw new Error("Invalid GitHub repository name.");
  }
  return value;
}
export async function scanGitHubRepository(value,cwd,options={}) {
  const repository=parsePublicGitHubRepo(value);
  const monitor=requireCloudMonitoringConsent(options.monitor===true);
  const raw=await invokeShipCheck(["scan","https://github.com/"+repository,"--format","json",...(monitor?["--monitor"]:[])],cwd);
  return {...boundedReport(JSON.parse(raw)),repository,
    cloudMonitoring:monitor?"enabled":"not-requested"};
}

export async function scannerVersion(cwd) {
  const reported = (await invokeShipCheck(["--version"],cwd)).trim().slice(0,64);
  let packageVersion=null;
  const entry=process.env.SHIP_CHECK_JS_ENTRY;
  if(entry && path.isAbsolute(entry)) {
    try{
      const manifest=JSON.parse(await readFile(path.join(path.dirname(await realpath(entry)),"package.json"),"utf8"));
      if(typeof manifest.version==="string" && /^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(manifest.version))
        packageVersion=manifest.version;
    }catch { /* Explicitly report that this metadata is unavailable. */ }
  }
  return {reportedScannerVersion:reported,installedPackageVersion:packageVersion,
    mismatch:packageVersion!==null && packageVersion!==reported,
    note:"The MCP adaptor invokes the locally installed scanner; it does not update it automatically."};
}

export function invokeShipCheck(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    // No shell invocation; tool arguments cannot inject commands.
    const bin = options.bin || process.env.SHIP_CHECK_BIN || "ship-check";
    const child = spawn(bin, [...(options.prefixArgs ?? []),...args], { cwd, shell: false, windowsHide: true,
      ...(options.env ? {env:options.env} : {}),
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
