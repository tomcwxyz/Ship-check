import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectContext, scanProject } from "@ship-check/core";
import {
  importedAwarePaidEndpointCheck,
  importedAwareVercelCronAuthCheck,
  importedAwareWebhookCheck,
  traceLocalImports
} from "./surface.js";

const temporaryRoots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-surface-"));
  temporaryRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("bounded local import tracing", () => {
  it("follows relative and root @/ aliases but stops at two helper levels", async () => {
    const root = await fixture({
      "app/api/demo/route.ts": 'import { work } from "@/lib/work"; export async function POST() { return work(); }',
      "lib/work.ts": 'import { helper } from "./helper"; export const work = () => helper();',
      "lib/helper.ts": 'import { ignored } from "./third"; export const helper = () => ignored();',
      "lib/third.ts": 'export const ignored = () => "third";'
    });
    const context = await createProjectContext(root);
    const sources = await traceLocalImports(context, "app/api/demo/route.ts");
    expect(sources.map((item) => item.file)).toEqual([
      "app/api/demo/route.ts",
      "lib/work.ts",
      "lib/helper.ts"
    ]);
  });

  it("resolves common @/ aliases into src when the root path does not exist", async () => {
    const root = await fixture({
      "src/app/api/demo/route.ts": 'import { requireUser } from "@/lib/auth"; export async function POST() { return requireUser(); }',
      "src/lib/auth.ts": 'export function requireUser() { return auth(); }'
    });
    const context = await createProjectContext(root);
    const sources = await traceLocalImports(context, "src/app/api/demo/route.ts");
    expect(sources.map((item) => item.file)).toContain("src/lib/auth.ts");
  });

  it("resolves wildcard tsconfig paths with baseUrl, comments and trailing commas", async () => {
    const root = await fixture({
      "tsconfig.json": `{
        // Common server-only aliases
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@server/*": ["src/server/*"],
          },
        },
      }`,
      "app/api/demo/route.ts": 'import { requireUser } from "@server/auth"; export async function POST() { return requireUser(); }',
      "src/server/auth.ts": 'export function requireUser() { return auth(); }'
    });
    const context = await createProjectContext(root);
    const sources = await traceLocalImports(context, "app/api/demo/route.ts");
    expect(sources.map((item) => item.file)).toContain("src/server/auth.ts");
  });

  it("resolves exact jsconfig aliases", async () => {
    const root = await fixture({
      "jsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "server-auth": ["lib/auth.ts"] }
        }
      }),
      "app/api/demo/route.ts": 'import { requireUser } from "server-auth"; export async function POST() { return requireUser(); }',
      "lib/auth.ts": 'export function requireUser() { return auth(); }'
    });
    const context = await createProjectContext(root);
    const sources = await traceLocalImports(context, "app/api/demo/route.ts");
    expect(sources.map((item) => item.file)).toContain("lib/auth.ts");
  });

  it("uses the nearest config for a nested app before a root alias with the same pattern", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }),
      "src/lib/auth.ts": 'export const rootAuth = () => "root";',
      "packages/app/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }),
      "packages/app/app/api/demo/route.ts": 'import { requireUser } from "@/lib/auth"; export async function POST() { return requireUser(); }',
      "packages/app/src/lib/auth.ts": 'export function requireUser() { return auth(); }'
    });
    const context = await createProjectContext(root);
    const sources = await traceLocalImports(context, "packages/app/app/api/demo/route.ts");
    const files = sources.map((item) => item.file);
    expect(files).toContain("packages/app/src/lib/auth.ts");
    expect(files).not.toContain("src/lib/auth.ts");
  });

  it("ignores alias targets that would escape the repository", async () => {
    const root = await fixture({
      "packages/app/tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@outside/*": ["../../../outside/*"] } }
      }),
      "packages/app/app/api/demo/route.ts": 'import { thing } from "@outside/thing"; export async function POST() { return thing(); }'
    });
    const context = await createProjectContext(root);
    const sources = await traceLocalImports(context, "packages/app/app/api/demo/route.ts");
    expect(sources.map((item) => item.file)).toEqual(["packages/app/app/api/demo/route.ts"]);
  });
});

describe("paid endpoint tracing", () => {
  it("recognises an auth boundary imported by a paid-service route", async () => {
    const root = await fixture({
      "app/api/ask/route.ts": [
        'import { requireUser } from "@/lib/auth";',
        'import { askModel } from "@/lib/ai";',
        'export async function POST() { await requireUser(); return askModel(); }'
      ].join("\n"),
      "lib/auth.ts": 'export async function requireUser() { return auth(); }',
      "lib/ai.ts": 'export async function askModel() { return generateText({ model: "example" }); }'
    });
    const report = await scanProject(root, [importedAwarePaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("passed");
  });

  it("recognises auth and paid work through configured custom aliases", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@guards/*": ["src/guards/*"],
            "@services/*": ["src/services/*"]
          }
        }
      }),
      "app/api/ask/route.ts": [
        'import { requireUser } from "@guards/auth";',
        'import { askModel } from "@services/ai";',
        'export async function POST() { await requireUser(); return askModel(); }'
      ].join("\n"),
      "src/guards/auth.ts": 'export async function requireUser() { return auth(); }',
      "src/services/ai.ts": 'export async function askModel() { return generateText({ model: "example" }); }'
    });
    const report = await scanProject(root, [importedAwarePaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("passed");
  });

  it("finds paid work reached through a helper when no abuse control is visible", async () => {
    const root = await fixture({
      "app/api/ask/route.ts": 'import { askModel } from "@/lib/ai"; export async function POST() { return askModel(); }',
      "lib/ai.ts": 'export async function askModel() { return generateText({ model: "example" }); }'
    });
    const report = await scanProject(root, [importedAwarePaidEndpointCheck]);
    expect(report.findings[0]).toMatchObject({
      checkId: "secure.paid-endpoint-abuse-control",
      severity: "high"
    });
    expect(report.findings[0]?.evidence.some((item) => item.path === "lib/ai.ts")).toBe(true);
  });
});

describe("webhook tracing", () => {
  it("accepts signature verification in a local imported helper", async () => {
    const root = await fixture({
      "app/api/webhooks/stripe/route.ts": 'import { verifyStripe } from "@/lib/stripe-hook"; export async function POST(req) { return verifyStripe(req); }',
      "lib/stripe-hook.ts": 'export function verifyStripe(req) { return stripe.webhooks.constructEvent(req); }'
    });
    const report = await scanProject(root, [importedAwareWebhookCheck]);
    expect(report.gaps).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("passed");
  });

  it("records an evidence gap after tracing helpers without verification", async () => {
    const root = await fixture({
      "app/api/webhook/route.ts": 'import { handleWebhook } from "@/lib/hook"; export async function POST(req) { return handleWebhook(req); }',
      "lib/hook.ts": 'export function handleWebhook(req) { return webhook(req); }'
    });
    const report = await scanProject(root, [importedAwareWebhookCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps[0]).toMatchObject({
      checkId: "secure.webhook-signature-verification",
      area: "access-control"
    });
    expect(report.checks[0]?.status).toBe("unverified");
  });
});

describe("cron auth tracing", () => {
  it("recognises a scheduler secret check in an imported helper", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/daily", schedule: "0 8 * * *" }] }),
      "app/api/cron/daily/route.ts": 'import { requireCron } from "@/lib/cron-auth"; export async function GET(req) { requireCron(req); return Response.json({ ok: true }); }',
      "lib/cron-auth.ts": 'export function requireCron(req) { return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`; }'
    });
    const report = await scanProject(root, [importedAwareVercelCronAuthCheck]);
    expect(report.gaps).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("passed");
  });

  it("keeps a gap when the imported helper has no scheduler authentication", async () => {
    const root = await fixture({
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/daily", schedule: "0 8 * * *" }] }),
      "app/api/cron/daily/route.ts": 'import { runDaily } from "@/lib/jobs"; export async function GET() { return runDaily(); }',
      "lib/jobs.ts": 'export async function runDaily() { return Response.json({ ok: true }); }'
    });
    const report = await scanProject(root, [importedAwareVercelCronAuthCheck]);
    expect(report.gaps[0]?.checkId).toBe("secure.vercel-cron-auth");
    expect(report.checks[0]?.status).toBe("unverified");
  });
});
