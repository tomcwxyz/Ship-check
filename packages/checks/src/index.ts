import path from "node:path";
import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Confidence, Finding, Severity } from "@ship-check/schemas";

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

function gap(input: {
  checkId: string;
  pack: AssessmentGap["pack"];
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
    pack: input.pack,
    area: input.area,
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

const sensitiveEnvNames = /(^|\/)\.env(?:\.(?:local|production|development|staging|test))?$/i;

const trackedEnvCheck: CheckDefinition = {
  id: "secure.tracked-env-file",
  pack: "secure-build",
  title: "Sensitive environment files",
  description: "Find environment files that are part of the scanned source set.",
  coverage: [{ area: "secrets", status: "partial" }],
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
  coverage: [{ area: "secrets", status: "partial" }],
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
  coverage: [
    { area: "access-control", status: "partial" },
    { area: "cost", status: "partial" }
  ],
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
  coverage: [{ area: "configuration", status: "partial" }],
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
  coverage: [{ area: "secrets", status: "partial" }],
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

const dangerousServerExecutionCheck: CheckDefinition = {
  id: "secure.dangerous-server-execution",
  pack: "secure-build",
  title: "Dangerous server execution primitives",
  description: "Flag high-risk dynamic execution and explicitly unsafe SQL primitives in server request handlers.",
  coverage: [{ area: "code-security", status: "partial" }],
  async run(context) {
    const findings: Finding[] = [];
    const patterns = [
      {
        label: "dynamic JavaScript evaluation",
        regex: /\b(?:eval\s*\(|new\s+Function\s*\()/,
        severity: "high" as const,
        why: "Dynamic code evaluation in a request boundary can turn unsafe input handling into code execution.",
        fix: "Replace dynamic evaluation with an explicit parser, dispatch table or validated data transformation."
      },
      {
        label: "explicitly unsafe raw SQL",
        regex: /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(/,
        severity: "high" as const,
        why: "Explicitly unsafe raw-SQL APIs bypass parameterisation safeguards and can make injection much easier.",
        fix: "Use the parameterised/safe query API and keep dynamic identifiers behind an explicit allow-list."
      }
    ];

    for (const file of context.files.filter(isApiHandler)) {
      const text = await context.readText(file);
      if (!text) continue;
      for (const pattern of patterns) {
        const match = pattern.regex.exec(text);
        if (!match) continue;
        findings.push(finding({
          checkId: this.id,
          pack: this.pack,
          suffix: `${file}:${lineNumber(text, match.index)}:${pattern.label}`,
          title: "High-risk execution primitive in a request handler",
          summary: `${file} contains ${pattern.label} inside an API/server request surface.`,
          severity: pattern.severity,
          confidence: "high",
          evidence: [{ kind: "file-match", path: file, line: lineNumber(text, match.index), excerpt: pattern.label, detail: "A high-risk primitive is present in repository-visible request-handling code." }],
          why: pattern.why,
          fix: pattern.fix,
          verify: "Exercise the affected route with representative and hostile input, confirm the dangerous primitive is gone, then rerun Ship Check.",
          agentPrompt: `Review ${file} around line ${lineNumber(text, match.index)}. Remove the ${pattern.label} primitive from the request boundary using the narrowest safe alternative, preserve intended behaviour, and add an abuse-path regression test.`
        }));
      }

      if (/\b(?:node:child_process|child_process)\b/.test(text)) {
        const shellMatch = /\b(?:exec|execSync)\s*\(/.exec(text);
        if (shellMatch) {
          findings.push(finding({
            checkId: this.id,
            pack: this.pack,
            suffix: `${file}:${lineNumber(text, shellMatch.index)}:shell`,
            title: "Shell execution is reachable from a request handler",
            summary: `${file} imports child-process functionality and invokes a shell execution API.`,
            severity: "high",
            confidence: "high",
            evidence: [{ kind: "file-match", path: file, line: lineNumber(text, shellMatch.index), excerpt: "child_process shell execution", detail: "Shell execution in a request boundary deserves explicit input and command-boundary review." }],
            why: "Shell execution can become command injection if any part of the command is influenced by request or stored user input.",
            fix: "Prefer execFile/spawn with a fixed executable and validated argument array, or remove the shell boundary entirely.",
            verify: "Confirm hostile metacharacters cannot alter the executed command and add a regression test before rerunning Ship Check.",
            agentPrompt: `Review the child-process execution in ${file}. Replace shell-string execution with a fixed executable plus validated arguments or remove the process boundary. Trace request-derived input into the call and add a command-injection regression test.`
          }));
        }
      }
    }
    return findings;
  }
};

const webhookVerificationPattern = /\b(?:constructEvent(?:Async)?|webhooks?\.verify|verify(?:Webhook|Signature)|createHmac|timingSafeEqual)\b|\.verify\s*\(/i;

const webhookVerificationCheck: CheckDefinition = {
  id: "secure.webhook-signature-verification",
  pack: "secure-build",
  title: "Webhook signature verification",
  description: "Identify webhook handlers where repository-visible signature verification cannot be established.",
  async run(context) {
    const gaps: AssessmentGap[] = [];
    let candidates = 0;
    for (const file of context.files.filter(isApiHandler)) {
      const text = await context.readText(file);
      if (!text) continue;
      const looksLikeWebhook = /webhooks?/i.test(file) || /\b(?:stripe\.webhooks|svix|webhook)\b/i.test(text);
      if (!looksLikeWebhook) continue;
      candidates += 1;
      if (webhookVerificationPattern.test(text)) continue;
      gaps.push(gap({
        checkId: this.id,
        pack: this.pack,
        area: "access-control",
        suffix: file,
        title: "Webhook verification could not be established",
        summary: `${file} looks like a webhook receiver, but the handler does not show a recognised signature/HMAC verification marker. Verification may live in an imported helper or upstream layer.`,
        evidence: [{ kind: "file-match", path: file, detail: "Webhook-like request handler found without repository-local verification evidence in the handler." }],
        verify: "Trace the request from ingress to side effect and confirm the provider signature is verified against the raw request before any trusted action occurs."
      }));
    }
    return {
      findings: [],
      gaps,
      coverage: candidates > 0 ? [{ area: "access-control", status: "partial" }] : []
    };
  }
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeForCronPath(files: string[], cronPath: string): string | undefined {
  const normalised = cronPath.replace(/^\/+|\/+$/g, "");
  if (!normalised.startsWith("api/")) return undefined;
  const escaped = escapeRegExp(normalised);
  const pattern = new RegExp(
    `(^|/)(?:app/${escaped}/route|pages/${escaped}(?:/index)?)\\.(?:js|jsx|ts|tsx)$`,
    "i"
  );
  return files.find((file) => pattern.test(file));
}

const cronAuthPattern = /\b(?:CRON_SECRET|cronSecret|verifyCron|authorization|Bearer)\b/i;

const vercelCronAuthCheck: CheckDefinition = {
  id: "secure.vercel-cron-auth",
  pack: "secure-build",
  title: "Vercel cron endpoint authentication",
  description: "Check whether repository-declared Vercel cron routes show an explicit request-authentication boundary.",
  async run(context) {
    const text = await context.readText("vercel.json");
    if (!text) return [];
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      return [];
    }
    const crons = config && typeof config === "object" ? (config as { crons?: unknown }).crons : null;
    if (!Array.isArray(crons) || crons.length === 0) return [];

    const gaps: AssessmentGap[] = [];
    for (const [index, item] of crons.entries()) {
      if (!item || typeof item !== "object") continue;
      const cronPath = (item as { path?: unknown }).path;
      if (typeof cronPath !== "string") continue;
      const route = routeForCronPath(context.files, cronPath);
      if (!route) {
        gaps.push(gap({
          checkId: this.id,
          pack: this.pack,
          area: "access-control",
          suffix: `${index}:${cronPath}:missing-route`,
          title: "Cron route authentication could not be traced",
          summary: `${cronPath} is scheduled in vercel.json, but Ship Check could not map it to a recognised Next.js route file.`,
          evidence: [{ kind: "configuration", path: "vercel.json", excerpt: cronPath, detail: "Scheduled route exists but its request handler was not resolved from the repository inventory." }],
          verify: "Locate the deployed handler for this cron path and confirm it rejects requests that do not carry the intended scheduler credential."
        }));
        continue;
      }
      const routeText = await context.readText(route);
      if (routeText && cronAuthPattern.test(routeText)) continue;
      gaps.push(gap({
        checkId: this.id,
        pack: this.pack,
        area: "access-control",
        suffix: `${index}:${cronPath}`,
        title: "Cron endpoint authentication could not be established",
        summary: `${cronPath} maps to ${route}, but the handler does not show a recognised scheduler-secret or Authorization check. Protection may live in middleware or hosting configuration.`,
        evidence: [
          { kind: "configuration", path: "vercel.json", excerpt: cronPath, detail: "Vercel cron route declaration." },
          { kind: "file-match", path: route, detail: "Mapped request handler has no recognised cron-auth marker." }
        ],
        verify: "Call the cron endpoint without its scheduler credential and confirm it is rejected before expensive work or side effects begin."
      }));
    }

    return {
      findings: [],
      gaps,
      coverage: [
        { area: "access-control", status: "partial" },
        { area: "cost", status: "partial" }
      ]
    };
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
    const coverage = [{ area: "supply-chain" as const, status: "partial" as const }];
    if (lockfiles.length === 1) return { findings: [], coverage };
    if (lockfiles.length === 0) {
      return { coverage, findings: [finding({
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
      })] };
    }
    return { coverage, findings: [finding({
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
    })] };
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
  description: "Look for repository-visible security-header configuration in Next.js projects without treating missing repository evidence as a defect.",
  async run(context) {
    if (!(await isNextProject(context))) return [];
    const coverage = [{ area: "configuration" as const, status: "partial" as const }];
    const config = context.files.find((file) => /^next\.config\.(?:js|mjs|cjs|ts)$/.test(path.basename(file)));
    const text = config ? await context.readText(config) : null;
    if (text && /headers\s*\(/.test(text) && /(?:Content-Security-Policy|Strict-Transport-Security|X-Content-Type-Options)/i.test(text)) {
      return { findings: [], gaps: [], coverage };
    }
    return {
      findings: [],
      coverage,
      gaps: [gap({
        checkId: this.id,
        pack: this.pack,
        area: "configuration",
        suffix: config ?? "missing-config",
        title: "Security headers are not verified from repository evidence",
        summary: "This Next.js project does not show a recognised core security-header policy in next.config.*. Headers may be set in middleware, a proxy, CDN or hosting platform, so Ship Check is recording an evidence gap rather than a fault.",
        evidence: [{ kind: "configuration", path: config, detail: config ? "next.config.* exists but no recognised core security-header markers were found." : "No next.config.* file was found in the scanned source set." }],
        verify: "Inspect deployed response headers for representative routes. If the app owns the policy, make it repository-visible and tested; if infrastructure owns it, record and test that boundary."
      })]
    };
  }
};

export const builtInChecks: CheckDefinition[] = [
  trackedEnvCheck,
  secretPatternCheck,
  paidEndpointCheck,
  wildcardCorsCheck,
  publicSecretNameCheck,
  dangerousServerExecutionCheck,
  webhookVerificationCheck,
  vercelCronAuthCheck,
  lockfileCheck,
  nextHeadersCheck
];

export function checksForPacks(packs: Array<"secure-build" | "production-ready">): CheckDefinition[] {
  const selected = new Set<CheckDefinition["pack"]>(packs);
  return builtInChecks.filter((check) => selected.has(check.pack));
}
