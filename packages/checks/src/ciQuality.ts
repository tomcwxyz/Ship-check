import type { CheckDefinition } from "@ship-check/core";
import type { AssessmentGap, Finding, Observation } from "@ship-check/schemas";

const workflowPath = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const testCommand = /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test(?::[\w-]+)?|check|lint|typecheck|type-check|build)\b|\b(?:pytest|vitest|jest|tsc|cargo\s+test|go\s+test|ruff\s+check|mypy)\b/i;
const testScript = /\b(?:test|check|lint|typecheck|type-check|build)\b/i;
const swallow = /(?:\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test|lint|check|typecheck|build)\b|\b(?:pytest|vitest|jest|tsc|cargo\s+test|go\s+test)\b)[^\n]{0,160}(?:\|\|\s*true|;\s*exit\s+0\b)/i;
const onPullRequest = /\bpull_request\s*:/m;
const onPush = /\bpush\s*:/m;
const onDispatchOnly = /\bworkflow_dispatch\s*:/m;
const id = "production.ci-quality";

function gap(suffix: string, title: string, summary: string, verify: string, path?: string): AssessmentGap {
  return {
    id: id + ":" + suffix, checkId: id, pack: "production-ready", area: "supply-chain",
    title, summary, verify,
    evidence: [{ kind: "configuration", ...(path ? { path } : {}), detail: summary }]
  };
}

function finding(suffix: string, title: string, summary: string, path: string, line: number): Finding {
  return {
    id: id + ":" + suffix, checkId: id, pack: "production-ready",
    title, summary, severity: "medium", confidence: "high",
    evidence: [{ kind: "file-match", path, line, excerpt: "Quality command failure explicitly masked", detail: summary }],
    remediation: {
      why: "A test or build failure which is converted into success can allow broken changes to proceed unnoticed.",
      fix: "Remove the explicit success fallback from the quality command. If failures are deliberately informational, use a named non-gating step and document that decision.",
      verify: "Force a controlled failure in a branch and confirm the workflow reports failure. Re-run Ship Check.",
      agentPrompt: "Review " + path + " for a test/build command with a success fallback. Preserve intentional optional checks but make critical quality gates fail when they fail, and verify in CI."
    }
  };
}

function stripCommentLines(yaml: string): string {
  return yaml.replace(/^\s*#.*$/gm, "");
}

function triggerBlock(yaml: string): string {
  const header = yaml.search(/^jobs\s*:/m);
  return header < 0 ? yaml : yaml.slice(0, header);
}

function hasQualityScript(manifest: string | null): boolean {
  if (!manifest) return false;
  try {
    const parsed = JSON.parse(manifest) as { scripts?: Record<string, string> };
    return Object.keys(parsed.scripts ?? {}).some((name) => testScript.test(name));
  } catch { return false; }
}

function qualityCommands(yaml: string): boolean {
  // Step-oriented heuristic, deliberately not proof of effective test execution.
  return /\brun\s*:/m.test(yaml) && testCommand.test(yaml);
}

export const ciQualityCheck: CheckDefinition = {
  id,
  version: "1",
  pack: "production-ready",
  title: "CI quality and pull-request verification",
  description: "Surfaces missing PR verification evidence and explicit test/build failure masking in GitHub Actions.",
  coverage: [{ area: "supply-chain", status: "partial" }],
  appliesTo(context) {
    return context.hasFile("package.json") || context.files.some((path) => workflowPath.test(path));
  },
  async run(context) {
    const files = context.files.filter((path) => workflowPath.test(path)).sort();
    const manifest = context.hasFile("package.json") ? await context.readText("package.json") : null;
    const hasScripts = hasQualityScript(manifest);
    const gaps: AssessmentGap[] = [];
    const findings: Finding[] = [];
    const observations: Observation[] = [];
    if (files.length === 0) {
      if (hasScripts) gaps.push(gap("no-workflows", "Automated checks are not visible",
        "This project declares quality scripts but no GitHub Actions workflows were found.",
        "Confirm whether another CI provider runs checks on pull requests; if not, introduce a minimal test/typecheck/build gate."));
      return { gaps };
    }
    let hasPR = false;
    let prQuality = false;
    let hasOtherAutomation = false;
    let hasPRWithPaths = false;
    let reusablePR = false;
    for (const file of files) {
      const text = await context.readText(file);
      if (text === null) {
        gaps.push(gap("unreadable:" + file, "Workflow could not be inspected",
          file + " was present but could not be read.",
          "Read and validate this workflow locally.", file));
        continue;
      }
      const clean = stripCommentLines(text);
      const triggers = triggerBlock(clean);
      const pr = onPullRequest.test(triggers);
      hasPR ||= pr;
      hasOtherAutomation ||= onPush.test(triggers);
      if (pr) {
        if (qualityCommands(clean)) prQuality = true;
        if (/\buses\s*:\s*[^\s]+\/[^\s]+@/m.test(clean)) reusablePR = true;
        if (/\bpull_request\s*:[\s\S]{0,400}?\bpaths(?:-ignore)?\s*:/m.test(triggers)) hasPRWithPaths = true;
      }
      const match = swallow.exec(clean);
      if (match) {
        const line = clean.slice(0, match.index).split("\n").length;
        findings.push(finding("ignored-failure:" + file + ":" + line,
          "CI quality command masks failure",
          file + " runs a quality command with an explicit success fallback.", file, line));
      }
      if (/\bcontinue-on-error\s*:\s*true\b/i.test(clean) && testCommand.test(clean)) {
        gaps.push(gap("continue-on-error:" + file, "Workflow permits errors during checks",
          file + " sets continue-on-error: true while containing a quality command. Ship Check cannot determine whether the setting applies to a required quality step.",
          "Inspect the affected step/job and make required verification checks gating.", file));
      }
    }
    if (!hasPR && hasOtherAutomation && hasScripts) gaps.push(gap("no-pr-verification",
      "Pull-request verification is not visible",
      "GitHub Actions contains push-triggered workflows and the project declares quality scripts, but no pull_request workflow was found.",
      "Confirm checks run before merging changes, including required status checks or another CI provider."));
    if (hasPR && !prQuality) gaps.push(gap("pr-quality-unverified",
      "Pull-request quality checks are not established",
      "Pull-request workflows exist, but no recognised test, lint, typecheck or build command was found.",
      reusablePR ? "Inspect any called reusable workflow and confirm its quality checks and required gate status." :
        "Confirm tests, type checking and builds run on PRs; add them if they are absent."));
    if (hasPRWithPaths) gaps.push(gap("pr-path-filters",
      "Pull-request validation may skip some changes",
      "At least one pull-request workflow uses paths or paths-ignore filters. Its coverage depends on which files change.",
      "Check that at least one mandatory workflow runs for all relevant changes and that branch protection cannot be bypassed by a skipped check."));
    if (hasPR && prQuality) observations.push({
      id: id + ":pr-commands-visible", checkId: id, pack: "production-ready",
      area: "supply-chain", kind: "inventory",
      title: "Pull-request quality commands found",
      summary: "At least one pull-request workflow contains recognised quality commands. This does not prove that the checks succeed or are required before merge.",
      evidence: [{ kind: "file-presence", path: files[0], detail: "GitHub Actions workflows are visible in source." }]
    });
    if (onDispatchOnly && !hasOtherAutomation && !hasPR && hasScripts) {
      gaps.push(gap("manual-only", "Quality checks may require manual triggering",
        "Workflows were found without a recognised push or pull-request trigger.",
        "Verify what automatically runs on pull requests and main-branch changes."));
    }
    return { findings, gaps, observations };
  }
};
