import { readFile } from "node:fs/promises";

const manifest=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
const cli=await readFile(new URL("../packages/cli/src/index.ts",import.meta.url),"utf8");
const matches=[...cli.matchAll(/^const version = "(\d+\.\d+\.\d+-alpha\.\d+)";$/gm)];
if (matches.length!==1 || matches[0][1]!==manifest.version) {
  console.error("CLI version must match the releasable npm package version. Found " +
    (matches[0]?.[1]??"missing")+", package.json="+manifest.version);
  process.exitCode=1;
} else {
  console.log("CLI scanner version matches published package manifest: "+manifest.version);
}
