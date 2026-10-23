import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Finding } from "@ship-check/schemas";

const RELEASE_INDEX_URL = "https://nodejs.org/dist/index.json";
const RELEASE_SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_CHARS = 2_000_000;
const MAX_VERSION_FILES = 80;

type Version = { major: number; minor: number; patch: number };
type VersionDeclaration = { path: string; declared: string; scope: "project" | "image" | "ci" };
export type NodeRelease = { version: string; date: string; security: boolean };
export type NodeSchedule = Record<string, { start?: string; end?: string }>;

export function parseExactNodeVersion(value: string): Version | null {
  const match = /^v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value.trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}
function compareVersion(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
function gap(id: string, title: string, summary: string, verify: string): AssessmentGap {
  return {
    id: "production.node-security:" + id,
    checkId: "production.node-security",
    pack: "production-ready",
    area: "supply-chain",
    title,
    summary,
    evidence: [{ kind: "configuration", detail: "Runtime versions inferred from repository configuration, not production process evidence." }],
    verify
  };
}
function finding(declaration: VersionDeclaration, title: string, summary: string, fix: string, version: string): Finding {
  return {
    id: "production.node-security:" + declaration.scope + ":" + declaration.path + ":" + declaration.declared,
    checkId: "production.node-security",
    pack: "production-ready",
    title, summary,
    severity: "high",
    confidence: "high",
    evidence: [{ kind: "configuration", path: declaration.path,
      excerpt: "Node.js " + declaration.declared,
      detail: "Repository-declared Node.js version (" + declaration.scope + "). This does not verify the deployed runtime. Checked against Node.js release history and the official support schedule." }],
    remediation: {
      why: "Older Node.js releases can lack published security fixes. A repository declaration is not proof of the version deployed by the hosting provider.",
      fix,
      verify: "Confirm the actual runtime in production, CI and container images. Update the relevant configuration or provider setting, rebuild and redeploy, then verify the running version.",
      agentPrompt: "Review the Node.js runtime declaration in " + declaration.path + " (" + declaration.declared + "). " + fix + " Verify the deployed runtime separately. Official release evidence: https://nodejs.org/en/blog/release/" + version
    }
  };
}

export function evaluateNodeRuntimeVersions(
  declarations: VersionDeclaration[], releases: NodeRelease[], schedule: NodeSchedule, today: string
): { findings: Finding[]; gaps: AssessmentGap[] } {
  const findings: Finding[] = [];
  const gaps: AssessmentGap[] = [];
  const latestSecurity = new Map<number, { version: Version; label: string; date: string }>();
  for (const entry of releases) {
    if (!entry.security || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
    const version = parseExactNodeVersion(entry.version);
    if (!version || entry.date > today) continue;
    const previous = latestSecurity.get(version.major);
    if (!previous || compareVersion(version, previous.version) > 0) {
      latestSecurity.set(version.major, { version, label: entry.version, date: entry.date });
    }
  }

  for (const declaration of declarations) {
    const version = parseExactNodeVersion(declaration.declared);
    if (!version) {
      gaps.push(gap("range:" + declaration.path + ":" + declaration.declared,
        "Node.js runtime version needs verifying",
        declaration.path + " declares " + declaration.declared + ", which is not an exact version. This may resolve to a patched release, or a different version at deployment.",
        "Find the exact version currently running in the relevant environment. Check its security status against the Node.js release history."));
      continue;
    }
    const support = schedule["v" + version.major];
    if (support?.end && support.end < today) {
      findings.push(finding(declaration,
        "Node.js " + version.major + " is outside security support",
        declaration.path + " pins Node.js " + declaration.declared + ". The official support schedule ended for this release line on " + support.end + ".",
        "Move to a currently supported Node.js release line, test the application, and update the deployed runtime. An old security patch on this release line is not sufficient.",
        "v" + version.major));
      continue;
    }
    const patched = latestSecurity.get(version.major);
    if (!support?.end) {
      gaps.push(gap("support:" + declaration.path + ":" + declaration.declared,
        "Node.js release support could not be established",
        "The official release schedule did not identify a support end date for Node.js " + version.major + ".",
        "Verify the Node.js release line against https://github.com/nodejs/Release and check the deployed runtime."));
      continue;
    }
    if (!patched) {
      gaps.push(gap("advisory:" + declaration.path + ":" + declaration.declared,
        "No matching Node.js security release found in the current feed",
        "A supported Node.js line was declared, but the fetched release index contained no security-marked version for that line.",
        "Check https://nodejs.org/en/blog/vulnerability/ for advisory coverage and confirm the deployed runtime."));
      continue;
    }
    if (compareVersion(version, patched.version) < 0) {
      findings.push(finding(declaration,
        "Node.js version predates a published security update",
        declaration.path + " pins " + declaration.declared + ". Node.js " + patched.label + " is a subsequent security release dated " + patched.date + ". Impact depends on the affected version and how the application runs.",
        "Review security advisories for " + patched.label + ", update to that security release or a later supported version, and verify the actual deployment.",
        patched.label));
    }
  }
  return { findings, gaps };
}

export async function collectNodeRuntimeVersions(context: Pick<ProjectContext, "files" | "readText">): Promise<VersionDeclaration[]> {
  const candidates = context.files.filter((file) =>
    /(^|\/)(?:package\.json|\.nvmrc|\.node-version|Dockerfile(?:\.[^/]*)?|\.tool-versions)$/.test(file) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)
  ).slice(0, MAX_VERSION_FILES);
  const declarations: VersionDeclaration[] = [];
  for (const file of candidates) {
    const contents = await context.readText(file);
    if (!contents) continue;
    if (file.endsWith("package.json")) {
      try {
        const data: unknown = JSON.parse(contents);
        if (data && typeof data === "object") {
          const engines = (data as { engines?: { node?: unknown } }).engines;
          if (typeof engines?.node === "string") declarations.push({ path: file, declared: engines.node.trim(), scope: "project" });
        }
      } catch { /* Malformed package metadata is outside this check. */ }
    } else if (file.endsWith(".nvmrc") || file.endsWith(".node-version")) {
      const declared = contents.trim().split(/\s/)[0];
      if (declared) declarations.push({ path: file, declared, scope: "project" });
    } else if (file.endsWith(".tool-versions")) {
      const match = /^nodejs\s+(\S+)/m.exec(contents);
      if (match) declarations.push({ path: file, declared: match[1], scope: "project" });
    } else if (/(^|\/)Dockerfile(?:\.[^/]*)?$/.test(file)) {
      for (const match of contents.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?node:(v?\d+(?:\.\d+){0,2})(?:-[A-Za-z0-9._-]+)?(?:\s|$)/gmi)) {
        declarations.push({ path: file, declared: match[1], scope: "image" });
      }
    } else {
      for (const match of contents.matchAll(/^\s*node-version:\s*['"]?(v?\d+(?:\.\d+){0,2})['"]?\s*(?:#.*)?$/gmi)) {
        declarations.push({ path: file, declared: match[1], scope: "ci" });
      }
    }
  }
  return [...new Map(declarations.map((declaration) =>
    [declaration.scope + ":" + declaration.path + ":" + declaration.declared, declaration])).values()];
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Official Node.js intelligence unavailable: HTTP " + response.status);
  const length = Number(response.headers.get("content-length") || "0");
  if (length > MAX_RESPONSE_CHARS) throw new Error("Node.js intelligence exceeds the response limit.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error("Node.js intelligence exceeds the response limit.");
  return JSON.parse(text) as unknown;
}

export const nodeRuntimeSecurityCheck: CheckDefinition = {
  version: "1",
  id: "production.node-security",
  pack: "production-ready",
  title: "Node.js security release intelligence",
  description: "Opt-in comparison of exact declared Node.js versions with the official security release history and support schedule.",
  principles: ["practice.preserve-safety", "practice.dependency-restraint"],
  appliesTo: (context) => context.files.some((file) => /(^|\/)(package\.json|\.nvmrc|\.node-version|\.tool-versions|Dockerfile(?:\.[^/]*)?)$/.test(file)),
  async run(context): Promise<CheckExecution> {
    const declarations = await collectNodeRuntimeVersions(context);
    if (!declarations.length) return {
      gaps: [gap("not-pinned", "Node.js runtime version was not pinned",
        "The repository contains Node.js project files, but no exact runtime version was identifiable. The deployed version may be controlled by the hosting platform.",
        "Check the exact Node.js version in the host's runtime settings, container image or CI configuration.")],
      coverage: [{ area: "supply-chain", status: "partial" }]
    };
    try {
      const [releaseData, scheduleData] = await Promise.all([fetchJson(RELEASE_INDEX_URL), fetchJson(RELEASE_SCHEDULE_URL)]);
      if (!Array.isArray(releaseData) || !scheduleData || typeof scheduleData !== "object" || Array.isArray(scheduleData))
        throw new Error("Unexpected official Node.js feed structure");
      const releases: NodeRelease[] = releaseData.filter((item): item is NodeRelease =>
        Boolean(item && typeof item === "object" && typeof item.version === "string" &&
          typeof item.date === "string" && typeof item.security === "boolean"));
      if (!releases.length) throw new Error("The Node.js release feed contained no usable data.");
      const comparison = evaluateNodeRuntimeVersions(declarations, releases, scheduleData as NodeSchedule,
        new Date().toISOString().slice(0, 10));
      return { ...comparison, coverage: [{ area: "supply-chain", status: "partial" }] };
    } catch {
      return { gaps: [gap("intelligence-unavailable", "Current Node.js security intelligence unavailable",
        "The opt-in check could not retrieve or validate the official Node.js release feed and support schedule. No runtime vulnerability conclusion was reached.",
        "Check network access to nodejs.org and raw.githubusercontent.com, then rerun with --networked-dependency-scan.")],
        coverage: [{ area: "supply-chain", status: "partial" }] };
    }
  }
};
