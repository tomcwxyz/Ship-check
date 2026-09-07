import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { checksForPacks } from "../src/index.js";

const execFileAsync = promisify(execFile);
const risky = fileURLToPath(new URL("../../../test-fixtures/risky-next/", import.meta.url));
const safe = fileURLToPath(new URL("../../../test-fixtures/safe-next/", import.meta.url));
const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-checks-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const destination = path.join(root, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
}

async function initGit(root: string): Promise<void> {
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "ship-check@example.invalid"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Ship Check Test"]);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("built-in secure-build checks", () => {
  it("finds concrete alpha risks in the risky fixture", async () => {
    const report = await scanProject(risky, checksForPacks(["secure-build"]));
    const ids = report.findings.map((finding) => finding.checkId);
    expect(ids).toContain("secure.tracked-env-file");
    expect(ids).toContain("secure.paid-endpoint-abuse-control");
    expect(ids).toContain("secure.wildcard-cors");
    expect(ids).toContain("secure.public-secret-env-name");
  });

  it("does not invent the risky fixture findings for the guarded fixture", async () => {
    const report = await scanProject(safe, checksForPacks(["secure-build"]));
    const ids = report.findings.map((finding) => finding.checkId);
    expect(ids).not.toContain("secure.paid-endpoint-abuse-control");
    expect(ids).not.toContain("secure.wildcard-cors");
    expect(ids).not.toContain("secure.public-secret-env-name");
  });

  it("treats an actually tracked .env.local as high-confidence repository evidence", async () => {
    const root = await temporaryDirectory();
    await initGit(root);
    await fs.writeFile(path.join(root, ".gitignore"), ".env*.local\n");
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, ".env.local"), "EXAMPLE_ONLY=value\n");
    await execFileAsync("git", ["-C", root, "add", ".gitignore", "package.json"]);
    await execFileAsync("git", ["-C", root, "add", "-f", ".env.local"]);

    const report = await scanProject(root, checksForPacks(["secure-build"]));
    const finding = report.findings.find((candidate) => candidate.checkId === "secure.tracked-env-file");

    expect(finding).toMatchObject({
      severity: "high",
      confidence: "high",
      title: "Sensitive environment file is tracked",
    });
    expect(finding?.evidence[0]).toMatchObject({ kind: "repository", path: ".env.local" });
  });

  it("does not flag an ignored local-only .env.local in a Git repository", async () => {
    const root = await temporaryDirectory();
    await initGit(root);
    await fs.writeFile(path.join(root, ".gitignore"), ".env*.local\n");
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, ".env.local"), "LOCAL_ONLY=value\n");
    await execFileAsync("git", ["-C", root, "add", ".gitignore", "package.json"]);

    const report = await scanProject(root, checksForPacks(["secure-build"]));

    expect(report.project.inventorySource).toBe("git-tracked");
    expect(report.findings.some((finding) => finding.checkId === "secure.tracked-env-file")).toBe(false);
  });

  it("never echoes a detected credential value in report evidence or repair guidance", async () => {
    const root = await temporaryDirectory();
    await initGit(root);
    const fakeSecret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
    await fs.writeFile(path.join(root, "config.ts"), `export const key = "${fakeSecret}";\n`);
    await execFileAsync("git", ["-C", root, "add", "config.ts"]);

    const report = await scanProject(root, checksForPacks(["secure-build"]));
    const finding = report.findings.find((candidate) => candidate.checkId === "secure.secret-pattern");

    expect(finding).toMatchObject({ severity: "critical", confidence: "high" });
    expect(JSON.stringify(finding)).not.toContain(fakeSecret);
    expect(finding?.evidence[0].excerpt).toContain("value redacted");
  });

  it("flags a secret-like NEXT_PUBLIC name but not an ordinary public setting", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(
      path.join(root, "settings.ts"),
      "export const region = process.env.NEXT_PUBLIC_REGION;\nexport const db = process.env.NEXT_PUBLIC_DATABASE_URL;\n",
    );

    const report = await scanProject(root, checksForPacks(["secure-build"]));
    const findings = report.findings.filter((finding) => finding.checkId === "secure.public-secret-env-name");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.summary).toContain("NEXT_PUBLIC_DATABASE_URL");
    expect(JSON.stringify(findings)).not.toContain("NEXT_PUBLIC_REGION uses");
  });

  it("finds explicitly unsafe SQL in a request handler", async () => {
    const root = await temporaryDirectory();
    await writeFile(root, "package.json", '{"name":"fixture","dependencies":{"next":"15.5.0"}}\n');
    await writeFile(
      root,
      "src/app/api/search/route.ts",
      "export async function GET(request: Request) {\n  const query = new URL(request.url).searchParams.get('q');\n  return prisma.$queryRawUnsafe(query);\n}\n",
    );

    const report = await scanProject(root, checksForPacks(["secure-build"]));
    const risk = report.findings.find((finding) => finding.checkId === "secure.dangerous-server-execution");

    expect(risk).toMatchObject({ severity: "high", confidence: "high" });
    expect(risk?.summary).toContain("explicitly unsafe raw SQL");
    expect(report.coverage.find((entry) => entry.area === "code-security")?.status).toBe("partial");
  });

  it("records an unverified webhook boundary instead of declaring it vulnerable", async () => {
    const root = await temporaryDirectory();
    await writeFile(root, "package.json", '{"name":"fixture","dependencies":{"next":"15.5.0"}}\n');
    await writeFile(
      root,
      "src/app/api/webhook/route.ts",
      "export async function POST(request: Request) {\n  const event = await request.json();\n  await applyEvent(event);\n  return new Response('ok');\n}\n",
    );

    const report = await scanProject(root, checksForPacks(["secure-build"]));
    const webhookGap = report.gaps.find((candidate) => candidate.checkId === "secure.webhook-signature-verification");

    expect(webhookGap).toMatchObject({ area: "access-control", title: "Webhook verification could not be established" });
    expect(report.findings.some((candidate) => candidate.checkId === "secure.webhook-signature-verification")).toBe(false);
    expect(report.checks.find((check) => check.checkId === "secure.webhook-signature-verification")?.status).toBe("unverified");
  });

  it("recognises repository-visible webhook signature verification", async () => {
    const root = await temporaryDirectory();
    await writeFile(root, "package.json", '{"name":"fixture","dependencies":{"next":"15.5.0"}}\n');
    await writeFile(
      root,
      "src/app/api/webhook/route.ts",
      "export async function POST(request: Request) {\n  const body = await request.text();\n  const event = stripe.webhooks.constructEvent(body, request.headers.get('stripe-signature'), secret);\n  return Response.json(event);\n}\n",
    );

    const report = await scanProject(root, checksForPacks(["secure-build"]));
    expect(report.gaps.some((candidate) => candidate.checkId === "secure.webhook-signature-verification")).toBe(false);
  });

  it("records unverified auth for a repository-declared cron route and recognises a visible secret check", async () => {
    const root = await temporaryDirectory();
    await writeFile(root, "package.json", '{"name":"fixture","dependencies":{"next":"15.5.0"}}\n');
    await writeFile(root, "vercel.json", '{"crons":[{"path":"/api/cron","schedule":"0 * * * *"}]}\n');
    await writeFile(
      root,
      "src/app/api/cron/route.ts",
      "export async function GET() { await refresh(); return new Response('ok'); }\n",
    );

    const unguarded = await scanProject(root, checksForPacks(["secure-build"]));
    expect(unguarded.gaps.some((candidate) => candidate.checkId === "secure.vercel-cron-auth")).toBe(true);

    await writeFile(
      root,
      "src/app/api/cron/route.ts",
      "export async function GET(request: Request) {\n  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('no', { status: 401 });\n  await refresh();\n  return new Response('ok');\n}\n",
    );
    const guarded = await scanProject(root, checksForPacks(["secure-build"]));
    expect(guarded.gaps.some((candidate) => candidate.checkId === "secure.vercel-cron-auth")).toBe(false);
  });
});

describe("production-ready checks", () => {
  it("distinguishes an unlocked package graph from a locked one", async () => {
    const riskyReport = await scanProject(risky, checksForPacks(["production-ready"]));
    const safeReport = await scanProject(safe, checksForPacks(["production-ready"]));
    expect(riskyReport.findings.some((finding) => finding.checkId === "production.package-lock-discipline")).toBe(true);
    expect(safeReport.findings.some((finding) => finding.checkId === "production.package-lock-discipline")).toBe(false);
  });

  it("flags competing lock files separately from a missing lock file", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await fs.writeFile(path.join(root, "package-lock.json"), "{}\n");

    const report = await scanProject(root, checksForPacks(["production-ready"]));
    const finding = report.findings.find((candidate) => candidate.checkId === "production.package-lock-discipline");

    expect(finding).toMatchObject({ severity: "low", title: "Multiple dependency lock files found" });
  });

  it("records missing Next.js security-header evidence as unverified rather than a finding", async () => {
    const report = await scanProject(risky, checksForPacks(["production-ready"]));
    const finding = report.findings.find((candidate) => candidate.checkId === "production.next-security-headers");
    const headerGap = report.gaps.find((candidate) => candidate.checkId === "production.next-security-headers");
    const result = report.checks.find((candidate) => candidate.checkId === "production.next-security-headers");

    expect(finding).toBeUndefined();
    expect(headerGap).toMatchObject({ area: "configuration", title: "Security headers are not verified from repository evidence" });
    expect(result).toMatchObject({ status: "unverified", findingCount: 0, gapCount: 1 });
    expect(report.coverage.find((entry) => entry.area === "configuration")?.status).toBe("partial");
  });
});