import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const RETENTION = new Set(["30-days", "90-days", "180-days", "365-days", "until-deleted"]);
const MAX_METADATA_BYTES = 256 * 1024;

export function cloudSyncPlan(input) {
  if (!ALLOWED_EVENTS.has(input.eventName)) {
    throw new Error("Cloud sync is only allowed for push, schedule or manual workflow events.");
  }
  if (!input.workspace || !path.isAbsolute(input.workspace) || !input.actionPath || !path.isAbsolute(input.actionPath)) {
    throw new Error("GitHub workspace and action paths are required.");
  }
  if (!input.metadataPath || path.isAbsolute(input.metadataPath)) {
    throw new Error("Metadata path must be repository-relative.");
  }
  const root = path.resolve(input.workspace);
  const metadata = path.resolve(root, input.metadataPath);
  if (metadata === root || !metadata.startsWith(root + path.sep)) {
    throw new Error("Metadata path must stay within the repository checkout.");
  }
  const retention = input.retention || "90-days";
  if (!RETENTION.has(retention)) throw new Error("Unsupported cloud retention policy.");
  if (!input.cloudToken || !/^shipcheck_[A-Za-z0-9_-]{43}$/.test(input.cloudToken)) {
    throw new Error("A scoped Ship Check cloud token is required.");
  }
  let cloudUrl;
  try { cloudUrl = new URL(input.cloudUrl); }
  catch { throw new Error("A valid Cloud URL is required."); }
  const local = cloudUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(cloudUrl.hostname);
  if ((!local && cloudUrl.protocol !== "https:") || cloudUrl.username || cloudUrl.password ||
    cloudUrl.search || cloudUrl.hash || !cloudUrl.hostname || cloudUrl.pathname !== "/") {
    throw new Error("Cloud URL must be a plain HTTPS origin, without credentials, path or query.");
  }
  const args = [
    path.join(path.resolve(input.actionPath), "packages", "cli", "dist", "index.js"),
    "cloud", "connect", metadata, "--retention", retention
  ];
  // The bearer secret is sent only via environment, never as a CLI argument.
  return {
    metadata, args,
    env: { SHIP_CHECK_CLOUD_URL: cloudUrl.origin, SHIP_CHECK_CLOUD_TOKEN: input.cloudToken }
  };
}

async function run() {
  const plan = cloudSyncPlan({
    workspace: process.env.GITHUB_WORKSPACE,
    actionPath: process.env.GITHUB_ACTION_PATH,
    eventName: process.env.GITHUB_EVENT_NAME,
    metadataPath: process.env.SHIP_CHECK_METADATA_PATH,
    cloudUrl: process.env.SHIP_CHECK_CLOUD_URL,
    cloudToken: process.env.SHIP_CHECK_CLOUD_TOKEN,
    retention: process.env.SHIP_CHECK_CLOUD_RETENTION
  });
  const root = await fs.realpath(path.resolve(process.env.GITHUB_WORKSPACE));
  const metadataReal = await fs.realpath(plan.metadata);
  if (!metadataReal.startsWith(root + path.sep)) {
    throw new Error("The metadata path resolves outside the GitHub workspace.");
  }
  const stat = await fs.stat(metadataReal);
  if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) {
    throw new Error("Cloud history requires a regular metadata file of at most 256 KiB.");
  }

  const child = spawn(process.execPath, plan.args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SHIP_CHECK_CLOUD_URL: plan.env.SHIP_CHECK_CLOUD_URL,
      SHIP_CHECK_CLOUD_TOKEN: plan.env.SHIP_CHECK_CLOUD_TOKEN
    },
    signal: AbortSignal.timeout(20_000)
  });
  // Intentionally do not forward CLI stdout/stderr: some SDKs could return
  // user-supplied values. In an automation context use a bounded status only.
  child.stdout.resume();
  child.stderr.resume();
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode));
  });
  if (code !== 0) throw new Error("Cloud metadata sync failed. Check Cloud connectivity, scoped token and retention policy.");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      "\nCloud: source-free assurance metadata synced (explicit opt-in). No source or full report uploaded.\n");
  }
  process.stdout.write("Ship Check Cloud: metadata sync completed.\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run().catch(() => {
    process.stderr.write("Ship Check Cloud: metadata sync unavailable. Check the scoped token, Cloud endpoint and retention policy.\n");
    process.exitCode = 1;
  });
}
