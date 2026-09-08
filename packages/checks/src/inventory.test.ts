import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { serverSurfaceInventoryCheck } from "./inventory.js";

const temporaryRoots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-inventory-"));
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

describe("server surface inventory", () => {
  it("records API, server action and scheduled surfaces as observations rather than concerns", async () => {
    const root = await fixture({
      "app/api/health/route.ts": 'export async function GET() { return Response.json({ ok: true }); }',
      "app/actions.ts": '"use server"; export async function saveThing() { return true; }',
      "vercel.json": JSON.stringify({ crons: [{ path: "/api/health", schedule: "0 8 * * *" }] })
    });

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const titles = report.observations.map((item) => item.title);

    expect(report.findings).toEqual([]);
    expect(report.gaps).toEqual([]);
    expect(report.checks[0]).toMatchObject({ status: "passed", observationCount: 3, checkVersion: "2" });
    expect(titles).toContain("Server request surfaces discovered");
    expect(titles).toContain("Server Actions discovered");
    expect(titles).toContain("Scheduled server surfaces discovered");
  });

  it("enumerates named module-level and inline Server Actions", async () => {
    const root = await fixture({
      "app/actions.ts": [
        '"use server";',
        'export async function saveThing() { return true; }',
        'export const deleteThing = async () => true;'
      ].join("\n"),
      "app/page.tsx": [
        'export default function Page() { return null; }',
        'async function publishThing() {',
        '  "use server";',
        '  return true;',
        '}'
      ].join("\n")
    });

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const actions = report.observations.find((item) => item.id.endsWith(":server-actions"));

    expect(report.findings).toEqual([]);
    expect(actions?.summary).toMatch(/3 named Server Actions found across 2 source files/);
    expect(actions?.evidence.some((item) => item.path === "app/actions.ts" && item.excerpt?.includes("saveThing"))).toBe(true);
    expect(actions?.evidence.some((item) => item.path === "app/page.tsx" && item.excerpt?.includes("publishThing"))).toBe(true);
  });

  it("uses the bounded import graph to discover paid-service and database request paths", async () => {
    const root = await fixture({
      "app/api/ask/route.ts": 'import { run } from "@/lib/work"; export async function POST() { return run(); }',
      "lib/work.ts": 'import { save } from "./data"; export async function run() { const answer = await generateText({ model: "example" }); await save(answer); return answer; }',
      "lib/data.ts": 'import { neon } from "@neondatabase/serverless"; export async function save(value) { const sql = neon(process.env.DATABASE_URL); return sql`insert into messages(value) values (${value})`; }'
    });

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const byId = new Map(report.observations.map((item) => [item.id, item]));

    expect(byId.get("production.server-surface-inventory:paid-service-routes")?.summary).toMatch(/1 request route/);
    expect(byId.get("production.server-surface-inventory:database-routes")?.summary).toMatch(/1 request route/);
    expect(report.findings).toEqual([]);
  });

  it("recognises webhook and auth/admin route conventions without claiming they are safe", async () => {
    const root = await fixture({
      "app/api/webhooks/stripe/route.ts": 'export async function POST(request) { return stripe.webhooks.constructEvent(request); }',
      "app/api/auth/callback/route.ts": 'export async function GET() { return Response.redirect("/"); }',
      "app/api/admin/users/route.ts": 'export async function GET() { return Response.json([]); }'
    });

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const observations = report.observations;

    expect(observations.some((item) => item.id.endsWith(":webhooks"))).toBe(true);
    const authAdmin = observations.find((item) => item.id.endsWith(":auth-admin-routes"));
    expect(authAdmin?.summary).toMatch(/2 auth, callback or admin routes/);
    expect(authAdmin?.kind).toBe("inventory");
  });

  it("discovers Auth.js request and callback-config surfaces through a configured alias", async () => {
    const root = await fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@security/*": ["src/security/*"] }
        }
      }),
      "app/api/session/route.ts": 'import { handlers } from "@security/auth"; export const { GET, POST } = handlers;',
      "src/security/auth.ts": [
        'import NextAuth from "next-auth";',
        'export const { handlers } = NextAuth({',
        '  callbacks: {',
        '    async signIn() { return true; },',
        '    async session({ session }) { return session; }',
        '  }',
        '});'
      ].join("\n")
    });

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const framework = report.observations.find((item) => item.id.endsWith(":auth-framework-routes"));
    const callbacks = report.observations.find((item) => item.id.endsWith(":auth-js-callback-config"));

    expect(framework?.summary).toMatch(/1 request route/);
    expect(framework?.evidence[0]?.path).toBe("app/api/session/route.ts");
    expect(callbacks?.summary).toMatch(/1 source file/);
    expect(callbacks?.evidence[0]?.path).toBe("src/security/auth.ts");
    expect(report.findings).toEqual([]);
    expect(report.gaps).toEqual([]);
  });

  it("recognises a Supabase auth callback by explicit exchange marker rather than route naming", async () => {
    const root = await fixture({
      "app/api/session-exchange/route.ts": [
        'import { client } from "@/lib/supabase";',
        'export async function GET(request) {',
        '  const code = new URL(request.url).searchParams.get("code");',
        '  return client.auth.exchangeCodeForSession(code);',
        '}'
      ].join("\n"),
      "lib/supabase.ts": 'export const client = { auth: { exchangeCodeForSession(code) { return code; } } };'
    });

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const framework = report.observations.find((item) => item.id.endsWith(":auth-framework-routes"));

    expect(framework?.summary).toMatch(/1 request route/);
    expect(report.observations.some((item) => item.id.endsWith(":auth-admin-routes"))).toBe(false);
  });

  it("caps retained observation evidence paths while preserving the total route count", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 15; index += 1) {
      files[`app/api/item-${index}/route.ts`] = 'export async function GET() { return Response.json({ ok: true }); }';
    }
    const root = await fixture(files);

    const report = await scanProject(root, [serverSurfaceInventoryCheck]);
    const routes = report.observations.find((item) => item.id.endsWith(":api-routes"));

    expect(routes?.summary).toMatch(/15 API\/request routes/);
    expect(routes?.evidence).toHaveLength(12);
  });
});
