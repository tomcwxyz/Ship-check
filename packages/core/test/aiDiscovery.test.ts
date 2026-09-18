import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverAIProject } from "../src/aiDiscovery.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverAIProject", () => {
  it("discovers AI boundaries without inventing organisational meaning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ship-check-ai-discovery-"));
    roots.push(root);
    await mkdir(path.join(root, "src", "lib", "providers", "llm"), { recursive: true });
    await mkdir(path.join(root, "src", "lib", "jobs"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { ai: "^6.0.0", "@ai-sdk/openai-compatible": "^2.0.0" } }));
    await writeFile(path.join(root, "src", "lib", "providers", "llm", "openai-compat.ts"), [
      "import { generateText } from 'ai';",
      "export interface LlmProvider { generateText(input: unknown): Promise<unknown> }",
      "export async function run(model: unknown, prompt: string) {",
      "  return generateText({ model, prompt });",
      "}",
    ].join("\n"));
    await writeFile(path.join(root, "src", "lib", "jobs", "extract.ts"), [
      "export const queueName = 'source.extract';",
      "export const label = 'extract recommendations';",
    ].join("\n"));

    const report = await discoverAIProject(root);
    expect(report.format).toBe("crux-discovery/0.1");
    expect(report.signals.some((signal) => signal.kind === "ai_sdk")).toBe(true);
    expect(report.signals.some((signal) => signal.kind === "model_call")).toBe(true);
    expect(report.signals.some((signal) => signal.workflow_hint === "source.extract")).toBe(true);
    expect((report as unknown as Record<string, unknown>).purpose).toBeUndefined();
    expect(report.signals.every((signal) => !("purpose" in signal))).toBe(true);
    expect(report.limitations.join(" ")).toContain("cannot establish organisational purpose");
  });

  it("discovers Python Anthropic workflows without app-specific meaning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ship-check-python-ai-discovery-"));
    roots.push(root);
    await mkdir(path.join(root, "server", "example", "ask"), { recursive: true });
    await writeFile(path.join(root, "server", "example", "ask", "orchestrator.py"), [
      "from anthropic import Anthropic",
      "class AskOrchestrator:",
      "    async def run(self):",
      "        client = Anthropic(api_key='x')",
      "        return client.messages.create(model='claude-sonnet', messages=[])",
    ].join("\n"));
    await writeFile(path.join(root, "server", "example", "ask", "test_orchestrator.py"), [
      "from anthropic import Anthropic",
      "client.messages.create(model='test', messages=[])",
    ].join("\n"));

    const report = await discoverAIProject(root);
    expect(report.signals.some((signal) =>
      signal.kind === "ai_provider" &&
      signal.technology === "anthropic" &&
      signal.workflow_hint === "ask"
    )).toBe(true);
    expect(report.signals.some((signal) =>
      signal.kind === "model_call" &&
      signal.technology === "anthropic" &&
      signal.workflow_hint === "ask"
    )).toBe(true);
    expect(report.signals.every((signal) =>
      signal.evidence.every((evidence) => !evidence.path?.includes("test_orchestrator.py"))
    )).toBe(true);
  });
});
