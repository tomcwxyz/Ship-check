import type { CheckDefinition, CheckExecution } from "@ship-check/core";
import type { AssessmentGap, Finding } from "@ship-check/schemas";
import { traceLocalImports, type TracedSource } from "./surface.js";

const API_HANDLER = /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i;
const MUTATING_HANDLER = /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b|export\s+const\s+(?:POST|PUT|PATCH|DELETE)\b/;
const REQUEST_CONTROLLED_INPUT = /\b(?:params(?:\.|\[)|searchParams|request\.json\s*\(|req\.body|formData\s*\(|FormData\s*\()/i;
const DATABASE_MUTATION = /\b(?:update|updateMany|delete|deleteMany|upsert)\s*\(|\.(?:update|delete|upsert)\s*\(|\b(?:UPDATE|DELETE\s+FROM)\b/i;
const DATABASE_MARKER = /\b(?:PrismaClient|drizzle\s*\(|createServerClient|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL|neon\s*\(|sql\s*`)|@(?:prisma\/client|neondatabase\/serverless|supabase\/supabase-js)|drizzle-orm|\b(?:db|database)\.(?:[A-Za-z_$][\w$]*\.)?(?:query|findMany|findFirst|findUnique|insert|create|update|updateMany|delete|deleteMany|upsert|select)\b/i;
const EXPLICIT_AUTHORISATION = /\b(?:authori[sz]e|permission|requireRole|requirePermission|requireOwner(?:ship)?|assertOwner(?:ship)?|can(?:Edit|Delete|Update|Manage)|isAdmin|adminOnly)\b/i;
const AUTHENTICATED_OBJECT_SCOPE = /\b(?:ownerId|userId|createdBy|accountId|organisationId|organizationId|tenantId|workspaceId)\s*(?::|=)\s*(?:session\.user(?:\?\.|\.)id|currentUser(?:\s*\(\s*\))?(?:\?\.|\.)id|getUser\s*\(\s*\)(?:\?\.|\.)id)\b/i;
const OUTBOUND_VARIABLE_TARGET = /\b(?:fetch|got|ky)\s*\(\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[\w$]+)*)|\baxios\.(?:get|post|put|patch|delete)\s*\(\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/i;
const URLISH_NAME = /(?:^|\.)(?:url|uri|endpoint|target|callback|webhook|source|src|remote|destination)$/i;
const OUTBOUND_ALLOWLIST = /\b(?:allowedHosts?|allowlistedHosts?|trustedHosts?|trustedOrigins?|hostname\s*(?:===|==|!==|!=)|\.startsWith\s*\(\s*["']https:\/\/)/i;
const WORKFLOW_FILE = /^\.github\/workflows\/.+\.ya?ml$/i;

function gap(input: {
  checkId: string;
  area: AssessmentGap["area"];
  suffix: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: "secure-build",
    area: input.area,
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

function finding(input: {
  checkId: string;
  suffix: string;
  title: string;
  summary: string;
  severity: Finding["severity"];
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: "production-ready",
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    confidence: "high",
    evidence: input.evidence,
    remediation: {
      why: input.why,
      fix: input.fix,
      verify: input.verify,
      agentPrompt: input.agentPrompt
    }
  };
}

function sourceMatches(source: TracedSource, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(source.text);
}

function matchesAny(sources: TracedSource[], pattern: RegExp): boolean {
  return sources.some((source) => sourceMatches(source, pattern));
}

function firstSource(sources: TracedSource[], pattern: RegExp): TracedSource | undefined {
  return sources.find((source) => sourceMatches(source, pattern));
}

function hasVisibleAuthorisation(sources: TracedSource[]): boolean {
  return matchesAny(sources, EXPLICIT_AUTHORISATION) || matchesAny(sources, AUTHENTICATED_OBJECT_SCOPE);
}

export const mutatingObjectAuthorisationCheck: CheckDefinition = {
  id: "secure.mutating-object-authorisation",
  version: "1",
  pack: "secure-build",
  title: "Object-level authorisation on changes",
  description: "Identify mutating request paths where request-controlled identifiers reach database changes without a repository-visible ownership, role or permission boundary.",
  principles: ["practice.preserve-safety"],
  coverage: [
    { area: "access-control", status: "partial" },
    { area: "database", status: "partial" }
  ],
  appliesTo: (context) => context.files.some((file) => API_HANDLER.test(file)),
  async run(context): Promise<CheckExecution> {
    const gaps: AssessmentGap[] = [];
    for (const file of context.files.filter((candidate) => API_HANDLER.test(candidate))) {
      const entry = await context.readText(file);
      if (!entry || !MUTATING_HANDLER.test(entry)) continue;
      const sources = await traceLocalImports(context, file);
      if (!matchesAny(sources, REQUEST_CONTROLLED_INPUT)) continue;
      if (!matchesAny(sources, DATABASE_MARKER) || !matchesAny(sources, DATABASE_MUTATION)) continue;
      if (hasVisibleAuthorisation(sources)) continue;

      const mutationSource = firstSource(sources, DATABASE_MUTATION);
      gaps.push(gap({
        checkId: this.id,
        area: "access-control",
        suffix: file,
        title: "Check that people can only change records they are allowed to change",
        summary: `${file} accepts request-controlled input and reaches a database update/delete path, but Ship Check could not find a repository-visible ownership, role or permission boundary in the bounded local call graph. This is an unanswered authorisation question, not proof of broken access control.`,
        evidence: [
          { kind: "file-match", path: file, detail: "Mutating request handler with request-controlled input." },
          ...(mutationSource && mutationSource.file !== file ? [{ kind: "file-match" as const, path: mutationSource.file, detail: "Database mutation reached through a bounded local import." }] : [])
        ],
        verify: "Test the route with two ordinary accounts that own different records. Confirm each account can change only its own records, cannot change another account's record by changing an ID, and cannot gain admin-only behaviour by changing request fields. If authorisation is enforced in database policy or an upstream layer, document and test that boundary."
      }));
    }
    return { gaps };
  }
};

export const outboundRequestBoundaryCheck: CheckDefinition = {
  id: "secure.outbound-request-boundary",
  version: "1",
  pack: "secure-build",
  title: "Request-controlled outbound destinations",
  description: "Identify server request paths where request-controlled data appears to influence a variable outbound destination without a visible host allow-list.",
  principles: ["practice.preserve-safety"],
  coverage: [
    { area: "code-security", status: "partial" },
    { area: "runtime", status: "partial" }
  ],
  appliesTo: (context) => context.files.some((file) => API_HANDLER.test(file)),
  async run(context): Promise<CheckExecution> {
    const gaps: AssessmentGap[] = [];
    for (const file of context.files.filter((candidate) => API_HANDLER.test(candidate))) {
      const sources = await traceLocalImports(context, file);
      if (!matchesAny(sources, REQUEST_CONTROLLED_INPUT)) continue;
      if (matchesAny(sources, OUTBOUND_ALLOWLIST)) continue;

      let outbound: { source: TracedSource; variable: string } | null = null;
      for (const source of sources) {
        OUTBOUND_VARIABLE_TARGET.lastIndex = 0;
        const match = OUTBOUND_VARIABLE_TARGET.exec(source.text);
        const variable = match?.[1] ?? match?.[2];
        if (variable && URLISH_NAME.test(variable)) {
          outbound = { source, variable };
          break;
        }
      }
      if (!outbound) continue;

      gaps.push(gap({
        checkId: this.id,
        area: "code-security",
        suffix: `${file}:${outbound.source.file}:${outbound.variable}`,
        title: "Check whether visitors can choose where the server sends a request",
        summary: `${file} handles request-controlled input and reaches an outbound request using ${outbound.variable} as a variable destination. Ship Check could not find a recognised destination allow-list in the bounded local call graph. This needs verification before treating it as a safe outbound-request boundary.`,
        evidence: [
          { kind: "file-match", path: file, detail: "Server request surface accepts request-controlled input." },
          { kind: "file-match", path: outbound.source.file, excerpt: `variable destination: ${outbound.variable}`, detail: "Outbound request uses a URL-like variable rather than a repository-visible fixed destination." }
        ],
        verify: "Trace how the outbound URL is constructed. Confirm users cannot make the server call arbitrary hosts, private/internal addresses or cloud metadata services. Prefer a fixed destination or explicit host allow-list, reject redirects to untrusted hosts, then add tests for allowed and denied destinations."
      }));
    }
    return { gaps };
  }
};

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export const githubActionsSupplyChainCheck: CheckDefinition = {
  id: "production.github-actions-supply-chain",
  version: "1",
  pack: "production-ready",
  title: "GitHub Actions workflow boundaries",
  description: "Find explicit write-all workflow permissions and action dependencies that follow moving branch-like references.",
  principles: ["practice.preserve-safety", "practice.dependency-restraint"],
  coverage: [{ area: "supply-chain", status: "partial" }],
  appliesTo: (context) => context.files.some((file) => WORKFLOW_FILE.test(file)),
  async run(context): Promise<CheckExecution> {
    const findings: Finding[] = [];
    for (const file of context.files.filter((candidate) => WORKFLOW_FILE.test(candidate))) {
      const text = await context.readText(file);
      if (!text) continue;

      const writeAll = /^\s*permissions\s*:\s*write-all\s*$/gmi.exec(text);
      if (writeAll) {
        findings.push(finding({
          checkId: this.id,
          suffix: `${file}:write-all`,
          title: "Workflow grants broad write access",
          summary: `${file} declares permissions: write-all, giving the workflow a broad write-capable GitHub token rather than a task-specific permission set.`,
          severity: "medium",
          evidence: [{ kind: "configuration", path: file, line: lineNumber(text, writeAll.index), excerpt: "permissions: write-all", detail: "Workflow-level token permissions are explicitly broad." }],
          why: "A compromised or unexpectedly changed workflow step has a larger blast radius when its token can write broadly to the repository and related GitHub resources.",
          fix: "Replace write-all with the smallest explicit permissions needed by the workflow or individual jobs. Keep read-only as the default where possible.",
          verify: "Run the workflow with the reduced permission set and confirm required jobs still succeed. Check that unrelated write operations fail.",
          agentPrompt: `Review ${file}. Replace permissions: write-all with the narrowest explicit GitHub Actions permissions required by each job. Preserve the workflow's intended releases/checks and explain each remaining write permission.`
        }));
      }

      const actionPattern = /\buses\s*:\s*([^\s#]+)@([^\s#]+)/g;
      for (let match = actionPattern.exec(text); match; match = actionPattern.exec(text)) {
        const action = match[1];
        const ref = match[2];
        if (!action || action.startsWith("./") || !/^(?:main|master|latest|dev|develop|head)$/i.test(ref)) continue;
        findings.push(finding({
          checkId: this.id,
          suffix: `${file}:${action}@${ref}`,
          title: "Workflow action follows a moving branch reference",
          summary: `${file} uses ${action}@${ref}. That reference can change without a commit in this repository.`,
          severity: "medium",
          evidence: [{ kind: "configuration", path: file, line: lineNumber(text, match.index), excerpt: `${action}@${ref}`, detail: "External workflow dependency is pinned to a branch-like moving reference." }],
          why: "Build and release workflows execute third-party code with repository permissions. Moving references make the exact code executed less reproducible and can change independently of this repository.",
          fix: "Pin the action to a reviewed immutable commit SHA, record the human-readable release version in a comment, and use a dependency-update tool or deliberate review process for upgrades.",
          verify: "Confirm the workflow resolves the reviewed immutable SHA and still completes successfully. Future action upgrades should appear as explicit repository changes.",
          agentPrompt: `Review ${action}@${ref} in ${file}. Replace the moving branch reference with the immutable commit SHA for the intended reviewed release, keep the release tag/version in a comment, and verify the workflow still succeeds.`
        }));
      }
    }
    return { findings };
  }
};

export const breadthChecks: CheckDefinition[] = [
  mutatingObjectAuthorisationCheck,
  outboundRequestBoundaryCheck,
  githubActionsSupplyChainCheck
];
