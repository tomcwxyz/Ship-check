import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
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
    name: "@good-ship/ship-check-gitleaks-win32-x64",
    shortName: "ship-check-gitleaks-win32-x64",
    os: "win32",
    cpu: "x64",
    binary: "gitleaks.exe"
  },
  "linux-x64": {
    name: "@good-ship/ship-check-gitleaks-linux-x64",
    shortName: "ship-check-gitleaks-linux-x64",
    os: "linux",
    cpu: "x64",
    binary: "gitleaks"
  },
  "darwin-arm64": {
    name: "@good-ship/ship-check-gitleaks-darwin-arm64",
    shortName: "ship-check-gitleaks-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    binary: "gitleaks"
  }
};

await fs.rm(path.join(root, "dist", "npm"), { recursive: true, force: true });
await fs.mkdir(mainOutput, { recursive: true });

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

const optionalDependencies = Object.fromEntries(
  Object.values(platformPackages).map((item) => [item.name, rootPackage.version])
);

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
    "README.md"
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

await fs.writeFile(
  path.join(mainOutput, "README.md"),
  `# @good-ship/ship-check

Evidence-led pre-ship software assurance.

## Run without installing globally

\`\`\`bash
npx --yes @good-ship/ship-check scan . --format markdown
npx --yes @good-ship/ship-check scan-dir ~/Code --format markdown
\`\`\`

The package contains the bundled JavaScript Ship Check engine rather than depending on the internal monorepo workspace graph.

Pinned Gitleaks is supplied by an OS/CPU-specific optional package and resolved at runtime. Networked dependency checking remains explicitly opt-in.

Source: https://github.com/tomcwxyz/Ship-check
`
);

const platformKey = `${process.platform}-${process.arch}`;
const platformPackage = platformPackages[platformKey];

if (platformPackage) {
  const scannerOutput = path.join(npmRoot, platformPackage.shortName);
  const scannerBin = path.join(scannerOutput, "bin");
  await fs.mkdir(scannerBin, { recursive: true });

  await execFileAsync(
    process.execPath,
    [
      "scripts/install-deep-scanners.cjs",
      "--gitleaks-only",
      "--destination",
      scannerBin
    ],
    {
      cwd: root,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024
    }
  );

  const scannerManifest = {
    name: platformPackage.name,
    version: rootPackage.version,
    description: `Pinned Gitleaks binary for Ship Check on ${platformPackage.os}/${platformPackage.cpu}.`,
    license: "Apache-2.0",
    os: [platformPackage.os],
    cpu: [platformPackage.cpu],
    files: [`bin/${platformPackage.binary}`],
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

  const installedBinary = path.join(scannerBin, platformPackage.binary);
  const stat = await fs.stat(installedBinary);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Pinned Gitleaks package did not contain ${platformPackage.binary}.`);
  }
}

console.log(`Staged npm packages under ${path.relative(root, npmRoot)}`);
