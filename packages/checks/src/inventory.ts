import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentArea, Evidence, Observation } from "@ship-check/schemas";
import { traceLocalImports, type TracedSource } from "./surface.js";

const SOURCE_FILE = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/i;
const API_HANDLER = /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i;
const MODULE_SERVER_ACTION_DIRECTIVE = /^(?:(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*["']use server["'];?/;
const INLINE_SERVER_ACTION_FUNCTION = /\basync\s+function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*["']use server["'];?/g;
const INLINE_SERVER_ACTION_ARROW = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*["']use server["'];?/g;
const EXPORTED_SERVER_ACTION_FUNCTION = /\bexport\s+(?:default\s+)?async\s+function\s+([A-Za-z_$][\w$]*)\b/g;
const EXPORTED_SERVER_ACTION_ARROW = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/g;
const WEBHOOK_PATTERN = /\b(?:stripe\.webhooks|svix|webhook)\b/i;
const PAID_PROVIDER_PATTERN = /\b(?:OpenAI|Anthropic|Resend|Firecrawl|Stripe|generateText|generateObject|streamText|chat\.completions|responses\.create|messages\.create|emails\.send)\b/i;
const DATABASE_PATTERN = /\b(?:PrismaClient|drizzle\s*\(|createServerClient|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL|neon\s*\(|sql\s*`)|@(?:prisma\/client|neondatabase\/serverless|supabase\/supabase-js)|drizzle-orm|\b(?:db|database)\.(?:query|insert|update|delete|select)\b/i;
const AUTH_FRAMEWORK_PATTERN = /(?:\bNextAuth\s*\(|from\s+["'](?:next-auth|@auth\/[^"']+)["']|\bexchangeCodeForSession\s*\(|\.auth\.exchangeCodeForSession\s*\(|from\s+["']@clerk\/nextjs["']|from\s+["']lucia["'])/i;
const AUTH_JS_PATTERN = /(?:\bNextAuth\s*\(|from\s+["'](?:next-auth|@auth\/[^"']+)["'])/i;
const AUTH_JS_CALLBACKS_PATTERN = /\bcallbacks\s*:\s*\{/i;
const MAX_EVIDENCE_PATHS = 12;

function observation(input: {
  id: string;
  area: AssessmentArea;
  title: string;
  summary: string;
  evidence: Evidence[];
}): Observation {
  return {
    id: `production.server-surface-inventory:${input.id}`,
    checkId: "production.server-surface-inventory",
    pack: "production-ready",
    area: input.area,
    kind: "inventory",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence
  };
}

function pathEvidence(paths: string[], detail: string): Evidence[] {
  return paths.slice(0, MAX_EVIDENCE_PATHS).map((path) => ({
    kind: "file-presence" as const,
    path,
    detail
  }));
}

function countSummary(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function regexMatches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function anySourceMatches(sources: TracedSource[], pattern: RegExp): boolean {
  return sources.some((source) => regexMatches(pattern, source.text));
}

function sourcePathsMatching(sources: TracedSource[], patterns: RegExp[]): string[] {
  return sources
    .filter((source) => patterns.every((pattern) => regexMatches(pattern, source.text)))
    .map((source) => source.file);
}

async function tracedRoutes(context: ProjectContext, routes: string[]): Promise<Map<string, TracedSource[]>> {
  const traced = new Map<string, TracedSource[]>();
  for (const route of routes) traced.set(route, await traceLocalImports(context, route));
  return traced;
}

type ServerActionSurface = {
  file: string;
  names: string[];
  moduleDirective: boolean;
};

function collectNames(text: string, patterns: RegExp[]): string[] {
  const names = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names].sort();
}

async function serverActionSurfaces(context: ProjectContext): Promise<ServerActionSurface[]> {
  const surfaces: ServerActionSurface[] = [];
  for (const file of context.files.filter((candidate) => SOURCE_FILE.test(candidate))) {
    const text = await context.readText(file);
    if (!text) continue;
    const moduleDirective = regexMatches(MODULE_SERVER_ACTION_DIRECTIVE, text);
    const inlineNames = collectNames(text, [INLINE_SERVER_ACTION_FUNCTION, INLINE_SERVER_ACTION_ARROW]);
    const exportedNames = moduleDirective
      ? collectNames(text, [EXPORTED_SERVER_ACTION_FUNCTION, EXPORTED_SERVER_ACTION_ARROW])
      : [];
    const names = [...new Set([...inlineNames, ...exportedNames])].sort();
    if (moduleDirective || names.length > 0) surfaces.push({ file, names, moduleDirective });
  }
  return surfaces;
}

function serverActionEvidence(surfaces: ServerActionSurface[]): Evidence[] {
  return surfaces.slice(0, MAX_EVIDENCE_PATHS).map((surface) => ({
    kind: "file-match" as const,
    path: surface.file,
    ...(surface.names.length > 0 ? { excerpt: surface.names.join(", ").slice(0, 300) } : {}),
    detail: surface.names.length > 0
      ? `Named Server Action${surface.names.length === 1 ? "" : "s"}: ${surface.names.join(", ")}.`
      : "File declares a module-level use-server boundary; individual action names were not safely enumerated."
  }));
}

async function vercelCronPaths(context: ProjectContext): Promise<string[]> {
  const text = await context.readText("vercel.json");
  if (!text) return [];
  try {
    const config = JSON.parse(text) as { crons?: unknown };
    if (!Array.isArray(config.crons)) return [];
    return config.crons
      .map((item) => item && typeof item === "object" ? (item as { path?: unknown }).path : null)
      .filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export const serverSurfaceInventoryCheck: CheckDefinition = {
  id: "production.server-surface-inventory",
  version: "2",
  pack: "production-ready",
  title: "Server surface inventory",
  description: "Record repository-visible Next.js request, Server Action, scheduler, auth-framework, paid-service and database boundaries as positive observations rather than findings.",
  async run(context): Promise<CheckExecution> {
    const observations: Observation[] = [];
    const routes = context.files.filter((file) => API_HANDLER.test(file));
    const routeSources = await tracedRoutes(context, routes);
    const actionSurfaces = await serverActionSurfaces(context);
    const cronPaths = await vercelCronPaths(context);

    if (routes.length > 0) {
      observations.push(observation({
        id: "api-routes",
        area: "access-control",
        title: "Server request surfaces discovered",
        summary: `${countSummary(routes.length, "API/request route")} found in the scanned repository inventory. Discovery does not establish that every route is authenticated or safe.`,
        evidence: pathEvidence(routes, "Repository-visible server request surface.")
      }));
    }

    if (actionSurfaces.length > 0) {
      const actionCount = actionSurfaces.reduce((total, surface) => total + surface.names.length, 0);
      const unenumeratedFiles = actionSurfaces.filter((surface) => surface.names.length === 0).length;
      observations.push(observation({
        id: "server-actions",
        area: "access-control",
        title: "Server Actions discovered",
        summary: actionCount > 0
          ? `${countSummary(actionCount, "named Server Action")} found across ${countSummary(actionSurfaces.length, "source file")}.${unenumeratedFiles > 0 ? ` ${countSummary(unenumeratedFiles, "use-server file")} could not be safely enumerated at function level.` : ""} These are server execution surfaces; authorisation is not inferred from discovery.`
          : `${countSummary(actionSurfaces.length, "source file with a use-server directive")} found. Ship Check could not safely enumerate named actions in these files, and has not verified authorisation.`,
        evidence: serverActionEvidence(actionSurfaces)
      }));
    }

    const webhookRoutes = routes.filter((route) =>
      /webhooks?/i.test(route) || anySourceMatches(routeSources.get(route) ?? [], WEBHOOK_PATTERN)
    );
    if (webhookRoutes.length > 0) {
      observations.push(observation({
        id: "webhooks",
        area: "access-control",
        title: "Webhook surfaces discovered",
        summary: `${countSummary(webhookRoutes.length, "webhook-like route")} found. Signature verification is assessed separately where Ship Check can trace it.`,
        evidence: pathEvidence(webhookRoutes, "Route name or bounded local call graph contains webhook/provider markers.")
      }));
    }

    if (cronPaths.length > 0) {
      observations.push(observation({
        id: "scheduled-routes",
        area: "cost",
        title: "Scheduled server surfaces discovered",
        summary: `${countSummary(cronPaths.length, "Vercel cron route")} declared. Cadence and authentication are assessed by separate checks.`,
        evidence: cronPaths.slice(0, MAX_EVIDENCE_PATHS).map((cronPath) => ({
          kind: "configuration" as const,
          path: "vercel.json",
          excerpt: cronPath,
          detail: "Repository-declared Vercel cron route."
        }))
      }));
    }

    const authAdminRoutes = routes.filter((route) => /(?:^|\/)(?:api\/auth|auth\/callback|admin)(?:\/|\.)/i.test(route));
    if (authAdminRoutes.length > 0) {
      observations.push(observation({
        id: "auth-admin-routes",
        area: "access-control",
        title: "Auth/admin surfaces discovered",
        summary: `${countSummary(authAdminRoutes.length, "auth, callback or admin route")} found by path convention. These are useful review targets, not evidence of a defect.`,
        evidence: pathEvidence(authAdminRoutes, "Route path matches an auth, callback or admin convention.")
      }));
    }

    const frameworkAuthRoutes = routes.filter((route) =>
      anySourceMatches(routeSources.get(route) ?? [], AUTH_FRAMEWORK_PATTERN)
    );
    if (frameworkAuthRoutes.length > 0) {
      observations.push(observation({
        id: "auth-framework-routes",
        area: "access-control",
        title: "Framework auth request surfaces discovered",
        summary: `${countSummary(frameworkAuthRoutes.length, "request route")} reaches explicit Auth.js/NextAuth, Supabase auth-callback, Clerk or Lucia markers through the bounded local call graph. This identifies authentication boundaries but does not verify callback validation or policy.`,
        evidence: pathEvidence(frameworkAuthRoutes, "Bounded local call graph reaches a recognised authentication-framework marker.")
      }));
    }

    const authJsCallbackSources = [...new Set(
      frameworkAuthRoutes.flatMap((route) =>
        sourcePathsMatching(routeSources.get(route) ?? [], [AUTH_JS_PATTERN, AUTH_JS_CALLBACKS_PATTERN])
      )
    )];
    if (authJsCallbackSources.length > 0) {
      observations.push(observation({
        id: "auth-js-callback-config",
        area: "access-control",
        title: "Auth.js callback configuration discovered",
        summary: `${countSummary(authJsCallbackSources.length, "source file")} in an Auth.js/NextAuth request path contains a callbacks configuration object. Ship Check inventories this policy surface for review but does not infer that individual callbacks are safe or complete.`,
        evidence: pathEvidence(authJsCallbackSources, "Auth.js/NextAuth marker and callbacks configuration found in the bounded request call graph.")
      }));
    }

    const paidRoutes = routes.filter((route) => anySourceMatches(routeSources.get(route) ?? [], PAID_PROVIDER_PATTERN));
    if (paidRoutes.length > 0) {
      observations.push(observation({
        id: "paid-service-routes",
        area: "cost",
        title: "Paid-service request paths discovered",
        summary: `${countSummary(paidRoutes.length, "request route")} reaches repository-visible paid-service markers through the bounded local call graph. Abuse controls are assessed separately.`,
        evidence: pathEvidence(paidRoutes, "Bounded local call graph reaches a recognised paid-service marker.")
      }));
    }

    const databaseRoutes = routes.filter((route) => anySourceMatches(routeSources.get(route) ?? [], DATABASE_PATTERN));
    if (databaseRoutes.length > 0) {
      observations.push(observation({
        id: "database-routes",
        area: "database",
        title: "Database request paths discovered",
        summary: `${countSummary(databaseRoutes.length, "request route")} reaches repository-visible database/client markers. This inventories data boundaries but does not yet assess permissions, RLS or query safety comprehensively.`,
        evidence: pathEvidence(databaseRoutes, "Bounded local call graph reaches a recognised database/client marker.")
      }));
    }

    return { observations };
  }
};
