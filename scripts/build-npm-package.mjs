import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const output = path.join(root, "dist", "npm");
const rootPackage = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
);

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

await execFileAsync(
  "bun",
  [
    "build",
    "packages/cli/src/index.ts",
    "--target=node",
    "--outfile",
    "dist/npm/index.js"
  ],
  {
    cwd: root,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  }
);

const entryPath = path.join(output, "index.js");
let entry = await fs.readFile(entryPath, "utf8");
if (!entry.startsWith("#!")) {
  entry = `#!/usr/bin/env node\n${entry}`;
  await fs.writeFile(entryPath, entry);
}
await fs.chmod(entryPath, 0o755);

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
  repository: {
    type: "git",
    url: "git+https://github.com/tomcwxyz/Ship-check.git"
  },
  publishConfig: {
    access: "public"
  }
};

await fs.writeFile(
  path.join(output, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`
);

await fs.writeFile(
  path.join(output, "README.md"),
  `# @good-ship/ship-check

Evidence-led pre-ship software assurance.

## Run without installing globally

\`\`\`bash
npx --yes @good-ship/ship-check scan . --format markdown
npx --yes @good-ship/ship-check scan-dir ~/Code --format markdown
\`\`\`

The npm package contains the bundled JavaScript Ship Check engine so the internal monorepo workspace packages are not runtime dependencies.

External scanner capability is reported explicitly. A requested scanner that is unavailable is missing evidence, not a pass. Networked dependency checking remains opt-in.

Source: https://github.com/tomcwxyz/Ship-check
`
);

console.log(`Staged npm package at ${path.relative(root, output)}`);
