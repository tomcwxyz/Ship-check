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
        label: "Gitleaks"
      },
      {
        name: "@good-ship/ship-check-osv-win32-x64",
        shortName: "ship-check-osv-win32-x64",
        binary: "osv-scanner.exe",
        label: "OSV-Scanner"
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
        label: "Gitleaks"
      },
      {
        name: "@good-ship/ship-check-osv-linux-x64",
        shortName: "ship-check-osv-linux-x64",
        binary: "osv-scanner",
        label: "OSV-Scanner"
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
        label: "Gitleaks"
      },
      {
        name: "@good-ship/ship-check-osv-darwin-arm64",
        shortName: "ship-check-osv-darwin-arm64",
        binary: "osv-scanner",
        label: "OSV-Scanner"
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

Evidence-led pre-ship software assurance.

## Run without installing globally

\`\`\`bash
npx --yes @good-ship/ship-check scan . --format markdown
npx --yes @good-ship/ship-check scan . --git-history-secrets --format markdown
npx --yes @good-ship/ship-check scan-dir ~/Code --format markdown
npx --yes @good-ship/ship-check focus ./ship-check-report.json
npx --yes @good-ship/ship-check skill install .
\`\`\`

The package contains the bundled JavaScript Ship Check engine rather than depending on the internal monorepo workspace graph.

Pinned Gitleaks and OSV-Scanner binaries are supplied through OS/CPU-specific optional packages and resolved at runtime. OSV execution still remains explicitly opt-in via \`--networked-dependency-scan\`.

Source: https://github.com/tomcwxyz/Ship-check
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

      const scannerManifest = {
        name: scanner.name,
        version: rootPackage.version,
        description: `Pinned ${scanner.label} binary for Ship Check on ${platform.os}/${platform.cpu}.`,
        license: "Apache-2.0",
        os: [platform.os],
        cpu: [platform.cpu],
        files: [`bin/${scanner.binary}`],
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
      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`Pinned ${scanner.label} package did not contain ${scanner.binary}.`);
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

console.log(`Staged npm packages under ${path.relative(root, npmRoot)}`);
