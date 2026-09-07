import type { CheckDefinition, CheckExecution, ProjectContext } from "@ship-check/core";
import type { AssessmentArea, Evidence, Observation } from "@ship-check/schemas";
import { traceLocalImports, type TracedSource } from "./surface.js";

const SOURCE_FILE = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/i;
const API_HANDLER = /(^|\/)(?:app\/api\/.+\/route|pages\/api\/.+|api\/.+)\.(?:js|jsx|ts|tsx)$/i;
const SERVER_ACTION_DIRECTIVE = /^\s*["']use server["'];?/m;
const WEBHOOK_PATTERN = /\b(?:stripe\.webhooks|svix|webhook)\b/i;
const PAID_PROVIDER_PATTERN = /\b(?:OpenAI|Anthropic|Resend|Firecrawl|Stripe|generateText|generateObject|streamText|chat\.completions|responses\.create|messages\.create|emails\.send)\b/i;
const DATABASE_PATTERN = /\b(?:PrismaClient|drizzle\s*\(|createServerClient|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL|neon\s*\(|sql\s*`)|@(?:prisma\/client|neondatabase\/serverless|supabase\/supabase-js)|drizzle-orm|\b(?:db|database)\.(?:query|insert|update|delete|select)\b/i;
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

function anySourceMatches(sources: TracedSource[], pattern: RegExp): boolean {
  return sources.some((source) => {
    pattern.lastIndex = 0;
    return pattern.test(source.text);
  });
}

async function tracedRoutes(context: ProjectContext, routes: string[]): Promise<Map<string, TracedSource[]>> {
  const traced = new Map<string, TracedSource[]>();
  for (const route of routes) traced.set(route, await traceLocalImports(context, route));
  return traced;
}

async function serverActionFiles(context: ProjectContext): Promise<string[]> {
  const actions: string[] = [];
  for (const file of context.files.filter((candidate) => SOURCE_FILE.test(candidate))) {
    const text = await context.readText(file);
    if (text && SERVER_ACTION_DIRECTIVE.test(text)) actions.push(file);
  }
  return actions;
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
  pack: "production-ready",
  title: "Server surface inventory",
  description: "Record repository-visible Next.js request, action, scheduler, paid-service and database boundaries as positive observations rather than findings.",
  async run(context): Promise<CheckExecution> {
    const observations: Observation[] = [];
    const routes = context.files.filter((file) => API_HANDLER.test(file));
    const routeSources = await tracedRoutes(context, routes);
    const actions = await serverActionFiles(context);
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

    if (actions.length > 0) {
      observations.push(observation({
        id: "server-actions",
        area: "access-control",
        title: "Server Actions discovered",
        summary: `${countSummary(actions.length, "source file with a use-server directive")} found. Ship Check has inventoried these server execution surfaces but has not yet verified authorisation for each action.`,
        evidence: pathEvidence(actions, "Source file declares a server execution boundary with the use-server directive.")
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
