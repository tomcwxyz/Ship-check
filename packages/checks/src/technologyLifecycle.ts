import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentGap, Evidence, Finding, Observation } from "@ship-check/schemas";

/**
 * This small, reviewed snapshot is deliberately NOT a live advisory feed.
 * Unknown IDs and deployments remain unverified. Cloud must refresh intelligence
 * independently and never infer production usage from a repository declaration.
 */
export type ModelRetirement = {
  provider: "openai" | "anthropic";
  model: string;
  retirementDate: string;
  replacement: string;
  sourceUrl: string;
};

const OPENAI_SOURCE = "https://developers.openai.com/api/docs/deprecations";
const ANTHROPIC_SOURCE = "https://platform.claude.com/docs/en/about-claude/model-deprecations";

export const MODEL_RETIREMENTS: readonly ModelRetirement[] = [
  ...["gpt-5", "gpt-5-2025-08-07"].map((model) => ({ provider: "openai" as const, model, retirementDate: "2026-12-11", replacement: "gpt-5.6-sol", sourceUrl: OPENAI_SOURCE })),
  ...["gpt-5-mini", "gpt-5-mini-2025-08-07"].map((model) => ({ provider: "openai" as const, model, retirementDate: "2026-12-11", replacement: "gpt-5.6-terra", sourceUrl: OPENAI_SOURCE })),
  ...["gpt-5-nano", "gpt-5-nano-2025-08-07"].map((model) => ({ provider: "openai" as const, model, retirementDate: "2026-12-11", replacement: "gpt-5.6-luna", sourceUrl: OPENAI_SOURCE })),
  ...["o3", "o3-2025-04-16", "o3-pro", "o3-pro-2025-06-10"].map((model) => ({ provider: "openai" as const, model, retirementDate: "2026-12-11", replacement: "gpt-5.6-sol", sourceUrl: OPENAI_SOURCE })),
  ...["gpt-5.1", "gpt-5.1-2025-11-13"].map((model) => ({ provider: "openai" as const, model, retirementDate: "2027-04-01", replacement: "gpt-6-sol", sourceUrl: OPENAI_SOURCE })),
  ...["gpt-4o-2024-08-06", "gpt-4o-2024-11-20", "gpt-4.1-2025-04-14", "gpt-4.1-mini-2025-04-14"].map((model) => ({ provider: "openai" as const, model, retirementDate: "2027-01-14", replacement: "gpt-6-luna", sourceUrl: OPENAI_SOURCE })),
  { provider: "anthropic", model: "claude-sonnet-4-5-20250929", retirementDate: "2026-11-30", replacement: "claude-sonnet-5-5", sourceUrl: ANTHROPIC_SOURCE },
  { provider: "anthropic", model: "claude-opus-4-1-20250805", retirementDate: "2026-08-05", replacement: "claude-opus-4-8", sourceUrl: ANTHROPIC_SOURCE }
];

const retirementById = new Map(MODEL_RETIREMENTS.map((entry) => [entry.model, entry]));
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|ya?ml|json|toml)$/i;
const EXCLUDED_FILE = /(?:^|\/)(?:docs?|examples?|fixtures?|test-fixtures|test|tests|__tests__|vendor|node_modules|dist|build)(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$|(?:package-lock|pnpm-lock|composer\.lock|yarn\.lock)/i;
const MODEL_ASSIGNMENT = /\b(?:model|modelId|model_id|modelName|model_name|OPENAI_MODEL|ANTHROPIC_MODEL|GOOGLE_MODEL|LLM_MODEL|AI_MODEL|MODEL_ID|MODEL_NAME)\s*[:=]\s*["']([A-Za-z0-9._/-]{2,100})["']/g;
const SDK_MODEL_CALL = /\b(?:openai|anthropic|google|googleGenerativeAI)\s*\(\s*["']([A-Za-z0-9._/-]{2,100})["']/g;
const MODEL_ID = /^(?:gpt-|o[134](?:-|$)|claude-|gemini-|mistral-|codestral-|deepseek-|llama-|qwen-)/i;
const MAX_MODEL_MATCHES = 40;
const MAX_CMS_ITEMS = 20;

const dayValue = (date: string): number => Date.parse(date + "T00:00:00.000Z");

export function evaluateModelRetirement(model: string, today: string): {
  entry: ModelRetirement | undefined;
  state: "unknown" | "scheduled" | "imminent" | "retired";
  daysRemaining: number | null;
} {
  const entry = retirementById.get(model);
  if (!entry) return { entry: undefined, state: "unknown", daysRemaining: null };
  const daysRemaining = Math.round((dayValue(entry.retirementDate) - dayValue(today)) / 86400000);
  return {
    entry,
    state: daysRemaining <= 0 ? "retired" : daysRemaining <= 30 ? "imminent" : "scheduled",
    daysRemaining
  };
}

function observed(checkId: string, suffix: string, title: string, summary: string, evidence: Evidence[]): Observation {
  return {
    id: checkId + ":" + suffix,
    checkId,
    pack: "production-ready",
    area: "supply-chain",
    kind: "inventory",
    title,
    summary,
    evidence
  };
}

function unverified(checkId: string, suffix: string, title: string, summary: string, evidence: Evidence[], verify: string): AssessmentGap {
  return {
    id: checkId + ":" + suffix,
    checkId,
    pack: "production-ready",
    area: "supply-chain",
    title,
    summary,
    evidence,
    verify
  };
}

function sourceLine(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function isModelSource(file: string): boolean {
  return SOURCE_FILE.test(file) && !EXCLUDED_FILE.test(file);
}

function isModelLike(model: string): boolean {
  return MODEL_ID.test(model);
}

export const aiModelLifecycleCheck: CheckDefinition = {
  id: "production.ai-model-lifecycle",
  version: "1",
  pack: "production-ready",
  title: "AI model lifecycle",
  description: "Discover statically declared models and compare exact IDs against a dated, sourced retirement snapshot; runtime selection remains unverified.",
  async run(context): Promise<CheckExecution> {
    const findings: Finding[] = [];
    const observations: Observation[] = [];
    const gaps: AssessmentGap[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    let inspected = 0;

    for (const file of context.files.filter(isModelSource)) {
      const text = await context.readText(file);
      if (!text) continue;
      for (const pattern of [MODEL_ASSIGNMENT, SDK_MODEL_CALL]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null && inspected < MAX_MODEL_MATCHES) {
          const model = match[1];
          if (!model || !isModelLike(model)) continue;
          const line = sourceLine(text, match.index);
          const identity = file + ":" + line + ":" + model;
          if (seen.has(identity)) continue;
          seen.add(identity);
          inspected += 1;
          const evidence: Evidence[] = [{
            kind: "file-match",
            path: file,
            line,
            excerpt: "Declared model: " + model,
            detail: "Static model identifier in source. Active runtime selection and provider routing were not verified."
          }];
          const status = evaluateModelRetirement(model, today);
          if (status.entry) {
            const retired = status.state === "retired";
            findings.push({
              id: this.id + ":" + identity,
              checkId: this.id,
              pack: this.pack,
              title: retired ? "Declared AI model has passed its published retirement date" : "Declared AI model has a published retirement date",
              summary: model + " is listed for " + status.entry.provider + " API retirement on " + status.entry.retirementDate + ". Its presence in source does not prove production use.",
              severity: retired || status.state === "imminent" ? "high" : "medium",
              confidence: "medium",
              evidence: [...evidence, { kind: "configuration", detail: "Provider notice: " + status.entry.sourceUrl + " (snapshot checked 2026-11-12)." }],
              remediation: {
                why: "A model retired by its provider may stop accepting requests in applications that actually use it.",
                fix: "Confirm the active provider, model selection and fallbacks, then evaluate migration to " + status.entry.replacement + " before the retirement date.",
                verify: "Test the deployed model path and fallbacks using a provider-supported model, and confirm the old ID is not used in production.",
                agentPrompt: "Inspect the model selection for " + model + " in " + file + ". Verify runtime usage and provider routing before replacing it; test compatibility and fallback behaviour."
              }
            });
          } else {
            observations.push(observed(this.id, identity, "AI model identifier found", "Found " + model + " in source; no authoritative lifecycle status is bundled for this exact ID.", evidence));
          }
        }
      }
      if (inspected >= MAX_MODEL_MATCHES) break;
    }
    if (seen.size > 0) {
      gaps.push(unverified(
        this.id, "runtime-selection", "Production AI model usage is not verified",
        "Source declarations may be unused, overridden by environment settings or routed through a provider gateway. Ship Check has not inspected actual API traffic.",
        [{ kind: "configuration", detail: "Source-only model discovery; bounded to " + MAX_MODEL_MATCHES + " matches." }],
        "Confirm production model identifiers and provider lifecycle information with a permitted read-only runtime inventory."
      ));
    }
    return {
      findings,
      observations,
      gaps,
      coverage: seen.size ? [{ area: "supply-chain", status: "partial" }] : []
    };
  }
};

function hasWordPressFiles(context: ProjectContext): boolean {
  return context.hasFile("wp-config.php") ||
    context.hasFile("wp-includes/version.php") ||
    context.files.some((file) => /^wp-content\/(?:plugins|themes)\//.test(file));
}

async function wordpressInventory(context: ProjectContext): Promise<{
  observations: Observation[]; gaps: AssessmentGap[];
}> {
  const checkId = "production.cms-component-inventory";
  const observations: Observation[] = [];
  const coreText = await context.readText("wp-includes/version.php");
  const coreVersion = coreText?.match(/\$wp_version\s*=\s*['"]([0-9][0-9a-zA-Z._-]*)['"]/)?.[1];
  observations.push(observed(checkId, "wordpress-core", "WordPress project recognised",
    coreVersion ? "WordPress core version declared as " + coreVersion + "." : "WordPress files found; core version could not be established.",
    [{ kind: "file-presence", path: coreVersion ? "wp-includes/version.php" : undefined, detail: coreVersion ? "Core version parsed from version.php." : "WordPress-specific project structure detected." }]
  ));
  const candidateFiles = context.files.filter((file) => /^wp-content\/(?:plugins|themes)\/[^/]+\/[^/]+\.php$/i.test(file));
  const found = new Set<string>();
  for (const file of candidateFiles) {
    if (found.size >= MAX_CMS_ITEMS) break;
    const parts = file.split("/");
    const identifier = parts[1] + "/" + parts[2];
    if (found.has(identifier)) continue;
    const text = await context.readText(file);
    if (!text) continue;
    const label = parts[1] === "plugins" ? "Plugin Name" : "Theme Name";
    const header = text.slice(0, 8192);
    const name = header.match(new RegExp("(?:^|\\n)\\s*(?:\\*\\s*)?" + label + "\\s*:\\s*([^\\r\\n]+)", "i"))?.[1]?.trim();
    const version = header.match(/(?:^|\n)\s*(?:\*\s*)?Version\s*:\s*([^\r\n]+)/i)?.[1]?.trim();
    if (!name) continue;
    found.add(identifier);
    observations.push(observed(checkId, "wordpress-" + identifier, "WordPress extension identified",
      name + (version ? " declares version " + version + "." : " has no readable version header."),
      [{ kind: "file-match", path: file, detail: "Extension header; installed production version remains unverified." }]
    ));
  }
  return {
    observations,
    gaps: [unverified(checkId, "wordpress-advisories", "WordPress component vulnerability status is unverified",
      "Source files do not prove what is installed on the deployed site. No live WordPress advisory feed was queried.",
      [{ kind: "configuration", detail: "WordPress project identified from repository files." }],
      "With consent, compare verified core/plugin/theme versions against an authorised and current WordPress security advisory feed."
    )]
  };
}

async function drupalInventory(context: ProjectContext): Promise<{
  observations: Observation[]; gaps: AssessmentGap[];
}> {
  const checkId = "production.cms-component-inventory";
  const observations: Observation[] = [];
  const gaps: AssessmentGap[] = [];
  const composerText = await context.readText("composer.lock");
  if (composerText === null) {
    gaps.push(unverified(checkId, "drupal-lockfile", "Drupal package versions cannot be verified",
      "The Composer lockfile is absent, too large or unreadable in this scan.",
      [{ kind: "file-presence", path: "composer.json", detail: "Drupal project detected, but no readable composer.lock." }],
      "Read the complete locked dependency graph in a bounded, authorised scan."
    ));
    return { observations, gaps };
  }
  try {
    const lock = JSON.parse(composerText) as { packages?: Array<{ name?: string; version?: string }> };
    const packages = (lock.packages ?? []).filter((pkg) => pkg.name?.startsWith("drupal/")).slice(0, MAX_CMS_ITEMS);
    for (const pkg of packages) {
      if (!pkg.name) continue;
      observations.push(observed(checkId, "drupal-" + pkg.name, "Drupal package identified",
        pkg.name + " declares version " + (pkg.version ?? "unknown") + ".",
        [{ kind: "file-match", path: "composer.lock", detail: "Locked Composer package; deployment version remains unverified." }]
      ));
    }
    if (packages.length === 0) {
      gaps.push(unverified(checkId, "drupal-empty-lock", "Drupal package versions could not be established",
        "The readable Composer lockfile contains no recognised drupal/* packages.",
        [{ kind: "file-presence", path: "composer.lock", detail: "No Drupal package records found." }],
        "Verify that the correct deployment Composer lockfile was supplied."
      ));
    }
  } catch {
    gaps.push(unverified(checkId, "drupal-invalid-lock", "Drupal lockfile could not be parsed",
      "composer.lock is not valid JSON within the bounded scan.",
      [{ kind: "file-presence", path: "composer.lock", detail: "Lockfile parse failed." }],
      "Fix or replace the lockfile and scan again."
    ));
  }
  return { observations, gaps };
}

export const cmsComponentInventoryCheck: CheckDefinition = {
  id: "production.cms-component-inventory",
  version: "1",
  pack: "production-ready",
  title: "WordPress and Drupal components",
  description: "Recognise CMS projects and identify source-visible core/extension package versions without inventing installed versions or vulnerability status.",
  async appliesTo(context) {
    if (hasWordPressFiles(context)) return true;
    const composer = await context.readText("composer.json");
    return Boolean(composer && /"drupal\/(?:core|core-recommended|[a-z0-9_-]+)"/i.test(composer));
  },
  async run(context): Promise<CheckExecution> {
    const wp = hasWordPressFiles(context);
    const result = wp ? await wordpressInventory(context) : await drupalInventory(context);
    if (!wp) {
      result.gaps.push(unverified(this.id, "drupal-advisories", "Drupal advisory status is unverified",
        "Locked Drupal package versions need matching against current Drupal Security Advisories and any applicable upstream dependency advisories.",
        [{ kind: "file-presence", path: "composer.lock", detail: "Composer package inventory is source evidence, not proof of deployment." }],
        "Use an authorised, current Drupal advisory feed and confirm which versions are installed on the live site."
      ));
    }
    return {
      ...result,
      findings: [],
      coverage: [{ area: "supply-chain", status: "partial" }]
    };
  }
};
