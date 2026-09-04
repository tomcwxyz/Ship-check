import path from "node:path";
import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { Confidence, Finding, Severity } from "@ship-check/schemas";

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function finding(input: {
  checkId: string;
  pack: Finding["pack"];
  suffix: string;
  title: string;
  summary: string;
  severity: Severity;
  confidence: Confidence;
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: input.pack,
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    confidence: input.confidence,
    evidence: input.evidence,
    remediation: { why: input.why, fix: input.fix, verify: input.verify, agentPrompt: input.agentPrompt }
  };
}

const sensitiveEnvNames = /(^|\/)\.env(?:\.(?:local|production|development|staging|test))?$/i;

const trackedEnvCheck: CheckDefinition = {
  id: "secure.tracked-env-file",
  pack: "secure-build",
  title: "Sensitive environment files",
  description: "Find environment files that are part of the scanned source set.",
  async run(context) {
    return context.files
      .filter((file) => sensitiveEnvNames.test(file))
      .map((file) =>
        finding({
          checkId: this.id,
          pack: this.pack,
          suffix: file,
          title: context.gitRepository ? "Sensitive environment file is tracked" : "Sensitive environment file is inside the project",
          summary: `${file} may contain credentials or deployment secrets and should not be committed or shared as source.`,
          severity: "high",
          confidence: context.gitRepository ? "high" : "medium",
          evidence: [{ kind: context.gitRepository ? "repository" : "file-presence", path: file, detail: context.gitRepository ? "Git reports this environment file as tracked." : "The file is present, but Git tracking could not be established." }],
          why: "Environment files frequently contain credentials with access to production data and paid services.",
          fix: "Move secrets to the deployment secret store, add the environment file to ignore rules, rotate any exposed credentials, and keep only a redacted example file in source control.",
          verify: `Run Ship Check again and confirm ${file} is no longer in the scanned tracked source set.`,
          agentPrompt: `Remove ${file} from source control without deleting required local configuration. Add safe ignore/example handling, identify which credentials need rotation, and do not print secret values.`
        })
      );
  }
};

const secretPatterns = [
  { label: "OpenAI-style API key", regex: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
  { label: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{24,}\b/g },
  { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "Private key material", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: "Supabase service-role assignment", regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?[A-Za-z0-9._-]{24,}/g }
];

const secretPatternCheck: CheckDefinition = {
  id: "secure.secret-pattern",
  pack: "secure-build",
  title: "Credential patterns",
  description: "Detect common high-risk credential shapes without returning the secret value.",
  async run(context) {
    const findings: Finding[] = [];
    const candidateFiles = context.files.filter((file) => /\.(?:cjs|env|go|js|json|jsx|mjs|py|rb|rs|toml|ts|tsx|ya?ml)$/i.test(file));
    for (const file of candidateFiles) {
      const text = await context.readText(file);
      if (!text) continue;
      for (const pattern of secretPatterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(text);
        if (!match) continue;
        findings.push(
          finding({
            checkId: this.id,
            pack: this.pack,
            suffix: `${file}:${lineNumber(text, match.index)}:${pattern.label}`,
            title: "Possible live credential in source",
            summary: `${pattern.label} detected in ${file}. Ship Check deliberately does not echo the matched value.`,
            severity: "critical",
            confidence: "high",
            evidence: [{ kind: "file-match", path: file, line: lineNumber(text, match.index), excerpt: `${pattern.label} pattern detected; value redacted`, detail: "A known credential shape appears in tracked project text." }],
            why: "A committed credential can grant direct access to data, infrastructure or paid APIs even when the application itself appears to work normally.",
            fix: "Revoke or rotate the credential first, then remove it from source and history where appropriate and load the replacement from a secret store.",
            verify: "Confirm the old credential is revoked, then rerun Ship Check and your repository secret scanner.",
            agentPrompt: `A ${pattern.label} pattern is present in ${file}. Do not reveal or repeat it. Remove the credential from source, replace usage with environment/secret-store loading, and give me a rotation and verification checklist.`
          })
        );
      }
    }
    return findings;
  }
};

const paidProviderPattern = /\b(?:OpenAI|Anthropic|Resend|Firecrawl|Stripe|generateText|generateObject|chat\.completions|responses\.create)\b/i;
const requestHandlerPattern = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)/;
const abuseControlPattern = /\b(?:rate.?limit|Ratelimit|turnstile|captcha|hcaptcha|recaptcha|requireAuth|getServerSession|currentUser|verifyToken|auth\s*\(|session)\b/i;

function isApiHandler(file: string): boolean {
  return /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i.test(file);
}

const paidEndpointCheck: CheckDefinition = {
  id: "secure.paid-endpoint-abuse-control",
  pack: "secure-build",
  title: "Paid public endpoints",
  description: "Flag API handlers that appear to call paid providers without repository-visible auth or abuse controls.",
  async run(context) {
    const findings: Finding[] = [];
    for (const file of context.files.filter(isApiHandler)) {
      const text = await context.readText(file);
      if (!text || !requestHandlerPattern.test(text) || !paidProviderPattern.test(text) || abuseControlPattern.test(text)) continue;
      const match = paidProviderPattern.exec(text);
      findings.push(
        finding({
          checkId: this.id,
          pack: this.pack,
          suffix: file,
          title: "Paid API work appears reachable without an obvious abuse control",
          summary: `${file} appears to invoke a paid external service, but Ship Check cannot find authentication, rate limiting or a bot challenge in the handler.`,
          severity: "high",
          confidence: "medium",
          evidence: [{ kind: "file-match", path: file, line: match ? lineNumber(text, match.index) : undefined, excerpt: "Paid-provider call detected; no recognised abuse-control marker found", detail: "This is a conservative source heuristic and may miss controls applied outside the repository or upstream." }],
          why: "Public endpoints that trigger paid services can be scripted repeatedly, creating cost spikes or spam even when normal usage looks fine.",
          fix: "Add server-side rate limiting and an appropriate authentication or bot-control boundary. Add idempotency where duplicate requests can cause side effects or cost.",
          verify: "Exercise the endpoint anonymously and above the intended rate threshold, confirm requests are rejected safely, then rerun Ship Check.",
          agentPrompt: `Review ${file} as a paid-service endpoint. Add the narrowest appropriate server-side rate limit plus authentication or bot protection, preserve legitimate usage, add an abuse-path test, and explain any upstream protection that means a local control is unnecessary.`
        })
      );
    }
    return findings;
  }
};

const wildcardCorsCheck: CheckDefinition = {
  id: "secure.wildcard-cors",
  pack: "secure-build",
  title: "Wildcard CORS",
  description: "Find explicit wildcard CORS configuration in application source.",
  async run(context) {
    const pattern = /(?:Access-Control-Allow-Origin["']?\s*[,=:]\s*["']\*|origin\s*:\s*["']\*["'])/i;
    const findings: Finding[] = [];
    for (const file of context.files.filter((file) => /\.(?:js|jsx|ts|tsx)$/i.test(file))) {
      const text = await context.readText(file);
      if (!text) continue;
      const match = pattern.exec(text);
      if (!match) continue;
      findings.push(
        finding({
          checkId: this.id,
          pack: this.pack,
          suffix: file,
          title: "Wildcard CORS policy detected",
          summary: `${file} explicitly allows requests from any origin.`,
          severity: "medium",
          confidence: "high",
          evidence: [{ kind: "file-match", path: file, line: lineNumber(text, match.index), excerpt: "Wildcard origin policy detected", detail: "The source contains an explicit wildcard CORS setting." }],
          why: "A wildcard origin can make browser-based abuse easier and is especially risky around authenticated or sensitive APIs.",
          fix: "Replace the wildcard with an explicit allow-list that matches the actual browser clients, and keep credentialed requests locked down.",
          verify: "Confirm allowed origins succeed and an unrecognised origin is rejected, then rerun Ship Check.",
          agentPrompt: `Replace the wildcard CORS policy in ${file} with a minimal explicit origin allow-list. Preserve required clients, do not enable credentialed wildcard access, and add a rejection test for an unrecognised origin.`
        })
      );
    }
    return findings;
  }
};

const publicSecretNameCheck: CheckDefinition = {
  id: "secure.public-secret-env-name",
  pack: "secure-build",
  title: "Client-exposed secret environment names",
  description: "Detect secret-like values deliberately exposed through public environment prefixes.",
  async run(context) {
    const pattern = /\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|DATABASE_URL|OPENAI|ANTHROPIC|PRIVATE_KEY)[A-Z0-9_]*\b/g;
    const findings: Finding[] = [];
    for (const file of context.files.filter((file) => /\.(?:js|jsx|ts|tsx|env)$/i.test(file))) {
      const text = await context.readText(file);
      if (!text) continue;
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (!match) continue;
      findings.push(
        finding({
          checkId: this.id,
          pack: this.pack,
          suffix: `${file}:${match[0]}`,
          title: "Secret-like environment variable is marked public",
          summary: `${match[0]} uses Next.js's client-exposed NEXT_PUBLIC_ prefix.`,
          severity: "critical",
          confidence: "high",
          evidence: [{ kind: "file-match", path: file, line: lineNumber(text, match.index), excerpt: match[0], detail: "NEXT_PUBLIC_ values are eligible for inclusion in browser bundles." }],
          why: "Server credentials and database connection details must not be made available to browser code.",
          fix: "Move the value to a server-only environment variable and route required browser operations through a least-privilege server boundary.",
          verify: "Build the application and confirm the value/name is absent from public bundles; rerun Ship Check.",
          agentPrompt: `Remove client exposure of ${match[0]} referenced in ${file}. Replace it with a server-only boundary using least-privilege credentials, update callers, and add a test or build check showing the secret is not present in client output.`
        })
      );
    }
    return findings;
  }
};

const lockfileCheck: CheckDefinition = {
  id: "production.package-lock-discipline",
  pack: "production-ready",
  title: "Dependency lock file",
  description: "Check JavaScript projects for a single repository-visible dependency lock file.",
  async run(context) {
    if (!context.hasFile("package.json")) return [];
    const lockfiles = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"].filter((file) => context.hasFile(file));
    if (lockfiles.length === 1) return [];
    if (lockfiles.length === 0) {
      return [finding({
        checkId: this.id,
        pack: this.pack,
        suffix: "missing",
        title: "No dependency lock file found",
        summary: "package.json exists but no supported lock file is part of the scanned source set.",
        severity: "medium",
        confidence: "high",
        evidence: [{ kind: "repository", path: "package.json", detail: "JavaScript package manifest found without a pnpm, npm, Yarn or Bun lock file." }],
        why: "Unlocked dependency resolution makes builds less reproducible and can introduce unreviewed transitive changes.",
        fix: "Choose one package manager, generate and commit its lock file, and make CI use the frozen/locked install mode.",
        verify: "Run a clean frozen install in CI and rerun Ship Check.",
        agentPrompt: "Choose the package manager already implied by this project, create exactly one lock file, make CI use a frozen install, and avoid unrelated dependency upgrades."
      })];
    }
    return [finding({
      checkId: this.id,
      pack: this.pack,
      suffix: "multiple",
      title: "Multiple dependency lock files found",
      summary: `More than one package-manager lock file is tracked: ${lockfiles.join(", ")}.`,
      severity: "low",
      confidence: "high",
      evidence: lockfiles.map((file) => ({ kind: "file-presence" as const, path: file, detail: "Tracked dependency lock file." })),
      why: "Competing lock files make it unclear which dependency graph CI and developers are expected to trust.",
      fix: "Choose the canonical package manager, remove stale lock files and document the expected install command.",
      verify: "Confirm a clean checkout installs from one lock file and rerun Ship Check.",
      agentPrompt: `Resolve competing lock files (${lockfiles.join(", ")}) without broad dependency upgrades. Keep the package manager used by CI/deployment and update documentation if needed.`
    })];
  }
};

async function isNextProject(context: ProjectContext): Promise<boolean> {
  const packageText = await context.readText("package.json");
  if (!packageText) return false;
  try {
    const manifest = JSON.parse(packageText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return Boolean(manifest.dependencies?.next || manifest.devDependencies?.next);
  } catch {
    return false;
  }
}

const nextHeadersCheck: CheckDefinition = {
  id: "production.next-security-headers",
  pack: "production-ready",
  title: "Next.js security headers",
  description: "Look for repository-visible security-header configuration in Next.js projects.",
  async run(context) {
    if (!(await isNextProject(context))) return [];
    const config = context.files.find((file) => /^next\.config\.(?:js|mjs|cjs|ts)$/.test(path.basename(file)));
    const text = config ? await context.readText(config) : null;
    if (text && /headers\s*\(/.test(text) && /(?:Content-Security-Policy|Strict-Transport-Security|X-Content-Type-Options)/i.test(text)) return [];
    return [finding({
      checkId: this.id,
      pack: this.pack,
      suffix: config ?? "missing-config",
      title: "No repository evidence of core security headers",
      summary: "This Next.js project does not show a recognised security-header configuration in next.config.*. Headers may still be applied by hosting infrastructure.",
      severity: "low",
      confidence: "low",
      evidence: [{ kind: "configuration", path: config, detail: config ? "next.config.* exists but no recognised core security-header markers were found." : "No next.config.* file was found in the scanned source set." }],
      why: "Browser security headers reduce the impact of several common web attack classes, but they can also be configured outside the application repository.",
      fix: "Confirm where headers are owned. If the application owns them, add an explicit tested header policy; otherwise document and test the upstream policy rather than duplicating it.",
      verify: "Inspect deployed response headers for representative routes and rerun Ship Check after recording the repository-side evidence.",
      agentPrompt: "Determine whether security headers are owned by this Next.js app or its hosting layer. If local, add a conservative tested policy; if upstream, document the boundary and add a deployment check. Do not add a brittle CSP without understanding current asset/script needs."
    })];
  }
};

export const builtInChecks: CheckDefinition[] = [
  trackedEnvCheck,
  secretPatternCheck,
  paidEndpointCheck,
  wildcardCorsCheck,
  publicSecretNameCheck,
  lockfileCheck,
  nextHeadersCheck
];

export function checksForPacks(packs: Array<"secure-build" | "production-ready">): CheckDefinition[] {
  const selected = new Set<CheckDefinition["pack"]>(packs);
  return builtInChecks.filter((check) => selected.has(check.pack));
}
