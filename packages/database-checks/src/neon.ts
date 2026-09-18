import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Observation } from "@ship-check/schemas";

const sourceTextPattern = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/i;
const neonImportPattern = /from\s+["']@neondatabase\/serverless["']|require\(["']@neondatabase\/serverless["']\)/i;
const neonHttpPattern = /\bneon\s*\(/;
const poolPattern = /\bnew\s+Pool\s*\(/;
const clientPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Client\s*\(/g;

function packageDependencies(manifest: unknown): Record<string, string> {
  if (!manifest || typeof manifest !== "object") return {};
  const record = manifest as { dependencies?: unknown; devDependencies?: unknown };
  const dependencies = record.dependencies && typeof record.dependencies === "object"
    ? record.dependencies as Record<string, string>
    : {};
  const devDependencies = record.devDependencies && typeof record.devDependencies === "object"
    ? record.devDependencies as Record<string, string>
    : {};
  return { ...dependencies, ...devDependencies };
}

async function neonSignals(context: ProjectContext): Promise<string[]> {
  const signals = new Set<string>();

  if (context.hasFile("package.json")) {
    const text = await context.readText("package.json");
    if (text) {
      try {
        const dependencies = packageDependencies(JSON.parse(text));
        if (dependencies["@neondatabase/serverless"]) signals.add("package:@neondatabase/serverless");
      } catch {
        // Invalid package.json is handled elsewhere.
      }
    }
  }

  for (const file of context.files.filter((candidate) => sourceTextPattern.test(candidate))) {
    const text = await context.readText(file);
    if (!text) continue;
    if (neonImportPattern.test(text)) signals.add(`import:${file}`);
    if (/\.neon\.tech\b/i.test(text)) signals.add(`hostname:${file}`);
  }

  return [...signals].sort();
}

function observation(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  evidence: Observation["evidence"];
}): Observation {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
    area: "database",
    kind: "inventory",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence
  };
}

function gap(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "production-ready",
    area: "database",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

export const neonConnectionEvidenceCheck: CheckDefinition = {
  id: "database.neon-connection-evidence",
  version: "1",
  pack: "production-ready",
  title: "Neon connection evidence",
  description: "Records repository-visible Neon serverless-driver connection strategies and checks explicit Client lifecycle evidence without assuming one connection model fits every runtime.",
  coverage: [{ area: "database", status: "partial" }],
  async appliesTo(context) {
    return (await neonSignals(context)).length > 0;
  },
  async run(context) {
    const observations: Observation[] = [];
    const gaps: AssessmentGap[] = [];
    let recognisedUsage = false;

    for (const file of context.files.filter((candidate) => sourceTextPattern.test(candidate))) {
      const text = await context.readText(file);
      if (!text || !neonImportPattern.test(text)) continue;

      if (neonHttpPattern.test(text)) {
        recognisedUsage = true;
        observations.push(observation({
          id: `${this.id}:${file}:http`,
          checkId: this.id,
          title: "Neon HTTP query helper is used",
          summary: `${file} uses the Neon serverless driver's HTTP query helper. This is connection-strategy evidence, not proof that query scope, credentials or runtime behaviour are safe.`,
          evidence: [{
            kind: "file-match",
            path: file,
            excerpt: "neon(...) query helper",
            detail: "Repository source imports @neondatabase/serverless and uses its HTTP query helper."
          }]
        }));
      }

      if (poolPattern.test(text)) {
        recognisedUsage = true;
        observations.push(observation({
          id: `${this.id}:${file}:pool`,
          checkId: this.id,
          title: "A Neon-compatible connection pool is used",
          summary: `${file} constructs a Pool from the Neon serverless driver. Ship Check records that strategy but does not infer whether the pool size or lifecycle fits the deployed runtime.`,
          evidence: [{
            kind: "file-match",
            path: file,
            excerpt: "Pool(...) connection strategy",
            detail: "Repository source imports @neondatabase/serverless and constructs a connection pool."
          }]
        }));
      }

      clientPattern.lastIndex = 0;
      let clientMatch = clientPattern.exec(text);
      while (clientMatch) {
        recognisedUsage = true;
        const variable = clientMatch[1]!;
        const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const endPattern = new RegExp(`\\b${escaped}\\s*\\.\\s*end\\s*\\(`);
        if (endPattern.test(text)) {
          observations.push(observation({
            id: `${this.id}:${file}:${variable}:closed`,
            checkId: this.id,
            title: "Neon Client cleanup is visible in source",
            summary: `${file} creates a Neon Client and contains a matching ${variable}.end(...) call. This establishes repository-visible cleanup intent, not runtime execution on every path.`,
            evidence: [{
              kind: "file-match",
              path: file,
              excerpt: `${variable}.end(...) lifecycle evidence`,
              detail: "A Client constructed in this file has a matching close call in the same source file."
            }]
          }));
        } else {
          gaps.push(gap({
            id: `${this.id}:${file}:${variable}:cleanup-not-visible`,
            checkId: this.id,
            title: "Neon Client cleanup is not visible",
            summary: `${file} constructs a Neon Client as ${variable}, but Ship Check could not find a matching ${variable}.end(...) call in the same file. Cleanup may happen through another abstraction, so this is an evidence gap rather than a leak claim.`,
            evidence: [{
              kind: "file-match",
              path: file,
              excerpt: `new Client(...) assigned to ${variable}`,
              detail: "The bounded source check found Client construction but no matching close call in the same file."
            }],
            verify: "Trace the Client lifecycle for this execution path. Confirm each connected Client is closed, or replace the pattern with the Neon HTTP helper or an intentionally managed Pool where that better matches the runtime."
          }));
        }
        clientMatch = clientPattern.exec(text);
      }
    }

    if (!recognisedUsage) {
      observations.push(observation({
        id: `${this.id}:provider-detected`,
        checkId: this.id,
        title: "Neon database source evidence is present",
        summary: "Ship Check detected Neon-specific source evidence, but did not classify a direct HTTP helper, Pool or Client construction in the files it inspected. Connection behaviour may be hidden behind another package or local abstraction.",
        evidence: [{
          kind: "configuration",
          detail: `Neon source signals: ${(await neonSignals(context)).join(", ")}.`
        }]
      }));
    }

    return { observations, gaps };
  }
};

export const neonSourceChecks: CheckDefinition[] = [neonConnectionEvidenceCheck];
