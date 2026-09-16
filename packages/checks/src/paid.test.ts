import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { calibratedPaidEndpointCheck } from "./paid.js";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-paid-"));
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

describe("calibrated paid endpoint detection", () => {
  it("does not treat provider configuration as paid work", async () => {
    const root = await fixture({
      "app/api/health/route.ts": [
        'import { config } from "@/lib/env";',
        'export function GET() { return Response.json({ openai: Boolean(config.openaiKey) }); }'
      ].join("\n"),
      "lib/env.ts": 'export const config = { openaiKey: process.env.OPENAI_API_KEY, stripeKey: process.env.STRIPE_SECRET_KEY };'
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("does not treat a provider interface method declaration as paid work", async () => {
    const root = await fixture({
      "app/api/search/route.ts": 'import type { LlmProvider } from "@/lib/types"; export async function GET() { return Response.json({ ok: true }); }',
      "lib/types.ts": 'export interface LlmProvider { generateText(input: { prompt: string }): Promise<{ text: string }>; }'
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("does not treat provider URLs mentioned only in comments as paid work", async () => {
    const root = await fixture({
      "app/api/models/route.ts": 'import { listModels } from "@/lib/discover"; export async function GET() { return listModels("http://localhost:11434/v1"); }',
      "lib/discover.ts": [
        '/** OpenAI-compatible example: https://api.openai.com/v1/models */',
        'export async function listModels(baseUrl) { return fetch(`${baseUrl}/models`); }'
      ].join("\n")
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("does not scan test files as deployable API handlers", async () => {
    const root = await fixture({
      "app/api/models/route.test.ts": 'export async function POST() { return fetch("https://api.openai.com/v1/responses"); }'
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
    expect(report.checks[0]?.status).toBe("not-applicable");
  });

  it("does not treat a signed Stripe webhook as an unprotected paid endpoint", async () => {
    const root = await fixture({
      "app/api/webhooks/stripe/route.ts": [
        'import Stripe from "stripe";',
        'export async function POST(request) {',
        '  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);',
        '  const body = await request.text();',
        '  const event = stripe.webhooks.constructEvent(body, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);',
        '  if (event.type === "checkout.session.completed") await stripe.subscriptions.retrieve(event.data.object.subscription);',
        '  return Response.json({ ok: true });',
        '}'
      ].join("\n")
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("flags a direct OpenAI HTTP operation without a visible abuse control", async () => {
    const root = await fixture({
      "api/capture.ts": [
        'export async function POST(request) {',
        '  const body = await request.formData();',
        '  return fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", body });',
        '}'
      ].join("\n")
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      checkId: "secure.paid-endpoint-abuse-control",
      severity: "high"
    });
  });

  it("finds Vercel AI SDK work through a local helper", async () => {
    const root = await fixture({
      "app/api/ask/route.ts": 'import { ask } from "@/lib/ai"; export async function POST() { return ask(); }',
      "lib/ai.ts": 'export async function ask() { return generateText({ model: "example", prompt: "hello" }); }'
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.evidence.some((item) => item.path === "lib/ai.ts")).toBe(true);
  });

  it("accepts a visible authentication boundary before paid work", async () => {
    const root = await fixture({
      "app/api/ask/route.ts": [
        'import { requireUser } from "@/lib/auth";',
        'import { ask } from "@/lib/ai";',
        'export async function POST() { await requireUser(); return ask(); }'
      ].join("\n"),
      "lib/auth.ts": 'export async function requireUser() { return auth(); }',
      "lib/ai.ts": 'export async function ask() { return generateText({ model: "example", prompt: "hello" }); }'
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
  });

  it("accepts a provider auth context as a visible request boundary", async () => {
    const root = await fixture({
      "app/api/search/route.ts": [
        'import { providers } from "@/lib/providers";',
        'import { ask } from "@/lib/ai";',
        'export async function GET(req) { await providers.auth.getContext(req); return ask(); }'
      ].join("\n"),
      "lib/providers.ts": 'export const providers = { auth: { getContext: async () => ({ user: { id: "1" } }) } };',
      "lib/ai.ts": 'export async function ask() { return generateText({ model: "example", prompt: "hello" }); }'
    });
    const report = await scanProject(root, [calibratedPaidEndpointCheck]);
    expect(report.findings).toHaveLength(0);
  });
});
