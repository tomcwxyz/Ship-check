const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "apps", "desktop", "src-tauri", "resources");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ship-check-scanners-"));

const assets = {
  "win32-x64": {
    gitleaks: {
      url: "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip",
      sha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
      archive: "zip",
      member: "gitleaks.exe",
      destination: "gitleaks.exe",
    },
    osv: {
      url: "https://github.com/google/osv-scanner/releases/download/v2.5.1/osv-scanner_windows_amd64.exe",
      sha256: "25e42f5ef6711fd8c0fb45390972205891dd44c6bd02ac93f0f63e8e98d9bfb6",
      archive: "none",
      destination: "osv-scanner.exe",
    },
  },
  "linux-x64": {
    gitleaks: {
      url: "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
      sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
      archive: "tar.gz",
      member: "gitleaks",
      destination: "gitleaks",
    },
    osv: {
      url: "https://github.com/google/osv-scanner/releases/download/v2.5.1/osv-scanner_linux_amd64",
      sha256: "f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be",
      archive: "none",
      destination: "osv-scanner",
    },
  },
  "darwin-arm64": {
    gitleaks: {
      url: "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_arm64.tar.gz",
      sha256: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
      archive: "tar.gz",
      member: "gitleaks",
      destination: "gitleaks",
    },
    osv: {
      url: "https://github.com/google/osv-scanner/releases/download/v2.5.1/osv-scanner_darwin_arm64",
      sha256: "75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054",
      archive: "none",
      destination: "osv-scanner",
    },
  },
};

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function download(url, file) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, bytes);
}

function verify(file, expected) {
  const actual = sha256(file);
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`);
  }
}

function extract(asset, archivePath, outputPath) {
  if (asset.archive === "none") {
    fs.copyFileSync(archivePath, outputPath);
    return;
  }

  const extractDir = path.join(temporary, `extract-${path.basename(outputPath)}`);
  fs.mkdirSync(extractDir, { recursive: true });
  if (asset.archive === "zip") {
    if (process.platform === "win32") {
      execFileSync("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`,
      ], { stdio: "inherit" });
    } else {
      execFileSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "inherit" });
    }
  } else if (asset.archive === "tar.gz") {
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "inherit" });
  } else {
    throw new Error(`Unknown archive type: ${asset.archive}`);
  }

  const extracted = path.join(extractDir, asset.member);
  if (!fs.existsSync(extracted)) throw new Error(`Expected ${asset.member} in ${path.basename(archivePath)}.`);
  fs.copyFileSync(extracted, outputPath);
}

async function install(name, asset) {
  const archivePath = path.join(temporary, `${name}-${path.basename(new URL(asset.url).pathname)}`);
  const outputPath = path.join(destination, asset.destination);
  process.stdout.write(`Installing ${name} from ${asset.url}\n`);
  await download(asset.url, archivePath);
  verify(archivePath, asset.sha256);
  extract(asset, archivePath, outputPath);
  if (process.platform !== "win32") fs.chmodSync(outputPath, 0o755);
  if (!fs.statSync(outputPath).isFile() || fs.statSync(outputPath).size === 0) {
    throw new Error(`${name} did not produce a usable binary at ${outputPath}.`);
  }
}

async function main() {
  const platformKey = `${process.platform}-${process.arch}`;
  const selected = assets[platformKey];
  if (!selected) {
    throw new Error(`No pinned Ship Check scanner binaries are configured for ${platformKey}.`);
  }
  fs.mkdirSync(destination, { recursive: true });
  await install("Gitleaks 8.30.1", selected.gitleaks);
  await install("OSV-Scanner 2.5.1", selected.osv);
  process.stdout.write(`Pinned deep scanners installed for ${platformKey}.\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
  });
