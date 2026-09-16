import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import {
  githubActionsSupplyChainCheck,
  mutatingObjectAuthorisationCheck,
  outboundRequestBoundaryCheck
} from "./breadth.js";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-breadth-"));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("object-level authorisation questions", () => {
  it("asks for verification when a request-controlled id reaches a mutation without a visible ownership check", async () => {
    const root = await fixture({
      "app/api/items/route.ts": [
        'import { db } from "@/lib/db";',
        'export async function PATCH(request) {',
        '  const { id, title } = await request.json();',
        '  return db.item.update({ where: { id }, data: { title } });',
        '}'
      ].join("\n"),
      "lib/db.ts": 'export const db = new PrismaClient();'
    });
    const report = await scanProject(root, [mutatingObjectAuthorisationCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps[0]).toMatchObject({
      checkId: "secure.mutating-object-authorisation",
      area: "access-control"
    });
    expect(report.checks[0]?.status).toBe("unverified");
  });

  it("does not raise the question when authenticated ownership scope is visible in the bounded call graph", async () => {
    const root = await fixture({
      "app/api/items/route.ts": [
        'import { updateOwned } from "@/lib/items";',
        'export async function PATCH(request) {',
        '  const { id, title } = await request.json();',
        '  return updateOwned(id, title);',
        '}'
      ].join("\n"),
      "lib/items.ts": 'export async function updateOwned(id, title) { const userId = session.user.id; return db.item.update({ where: { id, userId }, data: { title } }); }'
    });
    const report = await scanProject(root, [mutatingObjectAuthorisationCheck]);
    expect(report.gaps).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("passed");
  });

  it("keeps the question when userId comes from the request even if the route also reads the signed-in user", async () => {
    const root = await fixture({
      "app/api/items/route.ts": [
        'import { db } from "@/lib/db";',
        'export async function PATCH(request) {',
        '  const session = await auth();',
        '  const { id, userId, title } = await request.json();',
        '  return db.item.update({ where: { id, userId }, data: { title } });',
        '}'
      ].join("\n"),
      "lib/db.ts": 'export const db = new PrismaClient();'
    });
    const report = await scanProject(root, [mutatingObjectAuthorisationCheck]);
    expect(report.gaps).toHaveLength(1);
    expect(report.checks[0]?.status).toBe("unverified");
  });

  it("does not combine an unrelated crypto update call with database evidence elsewhere", async () => {
    const root = await fixture({
      "app/api/sources/route.ts": [
        'import { createSource } from "@/lib/source";',
        'import { encrypt } from "@/lib/crypto";',
        'export async function POST(request) {',
        '  const body = await request.formData();',
        '  encrypt(String(body.get("title")));',
        '  return createSource({ title: String(body.get("title")) });',
        '}'
      ].join("\n"),
      "lib/source.ts": 'export async function createSource(input) { return db.source.create({ data: input }); }',
      "lib/crypto.ts": 'export function encrypt(value) { const cipher = createCipheriv("aes-256-gcm", key, iv); return cipher.update(value); }'
    });
    const report = await scanProject(root, [mutatingObjectAuthorisationCheck]);
    expect(report.gaps).toHaveLength(0);
  });

  it("does not treat test routes as deployed mutation surfaces", async () => {
    const root = await fixture({
      "app/api/items/route.test.ts": 'export async function PATCH(request) { const { id } = await request.json(); return db.item.update({ where: { id } }); }'
    });
    const report = await scanProject(root, [mutatingObjectAuthorisationCheck]);
    expect(report.gaps).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("not-applicable");
  });
});

describe("outbound request boundary questions", () => {
  it("asks for verification when request input is combined with a variable URL-like outbound target", async () => {
    const root = await fixture({
      "app/api/fetch/route.ts": [
        'export async function POST(request) {',
        '  const { url } = await request.json();',
        '  return fetch(url);',
        '}'
      ].join("\n")
    });
    const report = await scanProject(root, [outboundRequestBoundaryCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.gaps[0]).toMatchObject({
      checkId: "secure.outbound-request-boundary",
      area: "code-security"
    });
  });

  it("does not ask when a recognised destination allow-list is visible", async () => {
    const root = await fixture({
      "app/api/fetch/route.ts": [
        'export async function POST(request) {',
        '  const { url } = await request.json();',
        '  const allowedHosts = new Set(["example.org"]);',
        '  const target = new URL(url);',
        '  if (!allowedHosts.has(target.hostname)) throw new Error("host not allowed");',
        '  return fetch(url);',
        '}'
      ].join("\n")
    });
    const report = await scanProject(root, [outboundRequestBoundaryCheck]);
    expect(report.gaps).toHaveLength(0);
  });

  it("does not ask outbound questions about route test files", async () => {
    const root = await fixture({
      "app/api/fetch/route.test.ts": 'export async function POST(request) { const { url } = await request.json(); return fetch(url); }'
    });
    const report = await scanProject(root, [outboundRequestBoundaryCheck]);
    expect(report.gaps).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("not-applicable");
  });
});

describe("GitHub Actions supply-chain boundaries", () => {
  it("finds write-all permissions and moving branch action references", async () => {
    const root = await fixture({
      ".github/workflows/release.yml": [
        "name: release",
        "permissions: write-all",
        "jobs:",
        "  release:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@main",
        "      - uses: vendor/release-action@master"
      ].join("\n")
    });
    const report = await scanProject(root, [githubActionsSupplyChainCheck]);
    expect(report.findings).toHaveLength(3);
    expect(report.findings.every((item) => item.checkId === "production.github-actions-supply-chain")).toBe(true);
    expect(report.coverage.find((entry) => entry.area === "supply-chain")?.status).toBe("partial");
  });

  it("does not flag explicit permissions with immutable action SHAs", async () => {
    const root = await fixture({
      ".github/workflows/check.yml": [
        "name: check",
        "permissions:",
        "  contents: read",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567"
      ].join("\n")
    });
    const report = await scanProject(root, [githubActionsSupplyChainCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("passed");
  });
});
