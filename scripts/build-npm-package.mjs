import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npmRoot = path.join(root, "dist", "npm", "node_modules", "@good-ship");
const mainOutput = path.join(npmRoot, "ship-check");
const rootPackage = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
);

const platformPackages = {
  "win32-x64": {
    os: "win32",
    cpu: "x64",
    scanners: [
      {
        name: "@good-ship/ship-check-gitleaks-win32-x64",
        shortName: "ship-check-gitleaks-win32-x64",
        binary: "gitleaks.exe",
        label: "Gitleaks",
        license: "MIT",
        licenseFile: "gitleaks-LICENSE.txt"
      },
      {
        name: "@good-ship/ship-check-osv-win32-x64",
        shortName: "ship-check-osv-win32-x64",
        binary: "osv-scanner.exe",
        label: "OSV-Scanner",
        license: "Apache-2.0",
        licenseFile: "osv-scanner-LICENSE.txt"
      }
    ]
  },
  "linux-x64": {
    os: "linux",
    cpu: "x64",
    scanners: [
      {
        name: "@good-ship/ship-check-gitleaks-linux-x64",
        shortName: "ship-check-gitleaks-linux-x64",
        binary: "gitleaks",
        label: "Gitleaks",
        license: "MIT",
        licenseFile: "gitleaks-LICENSE.txt"
      },
      {
        name: "@good-ship/ship-check-osv-linux-x64",
        shortName: "ship-check-osv-linux-x64",
        binary: "osv-scanner",
        label: "OSV-Scanner",
        license: "Apache-2.0",
        licenseFile: "osv-scanner-LICENSE.txt"
      }
    ]
  },
  "darwin-arm64": {
    os: "darwin",
    cpu: "arm64",
    scanners: [
      {
        name: "@good-ship/ship-check-gitleaks-darwin-arm64",
        shortName: "ship-check-gitleaks-darwin-arm64",
        binary: "gitleaks",
        label: "Gitleaks",
        license: "MIT",
        licenseFile: "gitleaks-LICENSE.txt"
      },
      {
        name: "@good-ship/ship-check-osv-darwin-arm64",
        shortName: "ship-check-osv-darwin-arm64",
        binary: "osv-scanner",
        label: "OSV-Scanner",
        license: "Apache-2.0",
        licenseFile: "osv-scanner-LICENSE.txt"
      }
    ]
  }
};

await fs.rm(path.join(root, "dist", "npm"), { recursive: true, force: true });
await fs.mkdir(mainOutput, { recursive: true });

const pnpmCommand = process.platform === "win32"
  ? (process.env.ComSpec || "cmd.exe")
  : "pnpm";
const pnpmArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", "pnpm build"]
  : ["build"];

await execFileAsync(
  pnpmCommand,
  pnpmArgs,
  {
    cwd: root,
    env: process.env,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  }
);

await execFileAsync(
  "bun",
  [
    "build",
    "packages/cli/src/index.ts",
    "--target=node",
    "--outfile",
    path.relative(root, path.join(mainOutput, "index.js"))
  ],
  {
    cwd: root,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  }
);

const entryPath = path.join(mainOutput, "index.js");
let entry = await fs.readFile(entryPath, "utf8");
if (!entry.startsWith("#!")) {
  entry = `#!/usr/bin/env node\n${entry}`;
  await fs.writeFile(entryPath, entry);
}
await fs.chmod(entryPath, 0o755);

const optionalDependencies = {};
for (const platform of Object.values(platformPackages)) {
  for (const scanner of platform.scanners) {
    optionalDependencies[scanner.name] = rootPackage.version;
  }
}

const packageJson = {
  name: "@good-ship/ship-check",
  version: rootPackage.version,
  description: "Evidence-led pre-ship software assurance from The Good Ship.",
  type: "module",
  license: "Apache-2.0",
  bin: {
    "ship-check": "./index.js"
  },
  files: [
    "index.js",
    "README.md",
    "skill/SKILL.md"
  ],
  engines: {
    node: ">=22.12.0"
  },
  optionalDependencies,
  repository: {
    type: "git",
    url: "git+https://github.com/tomcwxyz/Ship-check.git"
  },
  publishConfig: {
    access: "public"
  }
};

await fs.writeFile(
  path.join(mainOutput, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
);

const skillOutput = path.join(mainOutput, "skill");
await fs.mkdir(skillOutput, { recursive: true });
await fs.copyFile(
  path.join(root, ".claude", "skills", "ship-check", "SKILL.md"),
  path.join(skillOutput, "SKILL.md")
);

await fs.writeFile(
  path.join(mainOutput, "README.md"),
  `# @good-ship/ship-check

**Know what needs attention before you ship — and what still needs checking.**

Ship Check is a local-first software assurance CLI. It distinguishes confirmed findings, unanswered controls and assessment coverage.

## Get started

Node.js 22.12.0 or newer is required. From a project directory:

~~~bash
npx --yes @good-ship/ship-check@alpha --version
npx --yes @good-ship/ship-check@alpha scan .
~~~

No global installation required. The scan enables Secure Build, Production Ready and Cost Aware by default.

## Where do reports go?

**Reports print to the terminal by default. They are not saved to a file automatically.**

Save a Markdown report outside the repo to avoid accidentally committing evidence:

~~~bash
mkdir -p ~/ship-check-reports
npx --yes @good-ship/ship-check@alpha scan . --format markdown > ~/ship-check-reports/review.md
~~~

Save complete JSON for comparison and focused repair:

~~~bash
npx --yes @good-ship/ship-check@alpha scan . --format json > ~/ship-check-reports/before.json
npx --yes @good-ship/ship-check@alpha focus ~/ship-check-reports/before.json
~~~

## More ways to use Ship Check

| Task | Command |
| --- | --- |
| Scan a directory of projects | npx --yes @good-ship/ship-check@alpha scan-dir ~/Code |
| Check current and historical secrets | npx --yes @good-ship/ship-check@alpha scan . --git-history-secrets |
| Check dependencies with OSV | npx --yes @good-ship/ship-check@alpha scan . --networked-dependency-scan |
| Inspect a GitHub repository | npx --yes @good-ship/ship-check@alpha scan owner/repository |
| Scan source and a live deployment | npx --yes @good-ship/ship-check@alpha scan . --deployment-url https://example.com |
| Discover AI/workflow signals | npx --yes @good-ship/ship-check@alpha discover-ai . |
| Install the coding-agent skill | npx --yes @good-ship/ship-check@alpha skill install . |

The OSV check is opt-in because it may send dependency names and versions to the OSV service. Pinned Gitleaks and OSV-Scanner binaries are supplied through platform-specific optional npm packages. Local Semgrep scans require a compatible Semgrep installation.

## Full CLI guide and support

- [Practical npm / npx CLI guide](https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLI_GUIDE.md) — reports, all major commands and safe-use notes.
- [GitHub repository](https://github.com/tomcwxyz/Ship-check) — source, licence and architecture.
- [Report an issue](https://github.com/tomcwxyz/Ship-check/issues) — feedback, without sensitive report content.

A quiet scan does not prove a project is secure or ready to ship. Findings, unanswered checks and unavailable evidence are deliberately distinguished.
`
);

const platformKey = `${process.platform}-${process.arch}`;
const platform = platformPackages[platformKey];

if (platform) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-npm-scanners-"));
  try {
    await execFileAsync(
      process.execPath,
      [
        "scripts/install-deep-scanners.cjs",
        "--destination",
        temporary
      ],
      {
        cwd: root,
        env: process.env,
        maxBuffer: 16 * 1024 * 1024
      }
    );

    for (const scanner of platform.scanners) {
      const scannerOutput = path.join(npmRoot, scanner.shortName);
      const scannerBin = path.join(scannerOutput, "bin");
      await fs.mkdir(scannerBin, { recursive: true });

      const sourceBinary = path.join(temporary, scanner.binary);
      const targetBinary = path.join(scannerBin, scanner.binary);
      await fs.copyFile(sourceBinary, targetBinary);
      if (process.platform !== "win32") await fs.chmod(targetBinary, 0o755);

      const sourceLicense = path.join(temporary, scanner.licenseFile);
      const targetLicense = path.join(scannerOutput, "LICENSE.txt");
      await fs.copyFile(sourceLicense, targetLicense);

      const scannerManifest = {
        name: scanner.name,
        version: rootPackage.version,
        description: `Pinned ${scanner.label} binary for Ship Check on ${platform.os}/${platform.cpu}.`,
        license: scanner.license,
        os: [platform.os],
        cpu: [platform.cpu],
        files: [`bin/${scanner.binary}`, "LICENSE.txt"],
        publishConfig: {
          access: "public"
        },
        repository: {
          type: "git",
          url: "git+https://github.com/tomcwxyz/Ship-check.git"
        }
      };

      await fs.writeFile(
        path.join(scannerOutput, "package.json"),
        `${JSON.stringify(scannerManifest, null, 2)}\n`
      );

      const stat = await fs.stat(targetBinary);
      const licenseStat = await fs.stat(targetLicense);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`Pinned ${scanner.label} package did not contain ${scanner.binary}.`);
      }
      if (!licenseStat.isFile() || licenseStat.size === 0) {
        throw new Error(`Pinned ${scanner.label} package did not contain its upstream licence.`);
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

console.log(`Staged npm packages under ${path.relative(root, npmRoot)}`);
