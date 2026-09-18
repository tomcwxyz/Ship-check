import { createHash } from "node:crypto";
import path from "node:path";
import type { ProjectEvidenceSourceInput } from "@ship-check/schemas";
import { createProjectContext } from "./index.js";

export type CruxDiscoverySignalKind =
  | "ai_sdk"
  | "ai_provider"
  | "provider_configuration"
  | "model_call"
  | "workflow_job"
  | "human_review_surface"
  | "decision_surface"
  | "action_surface"
  | "tool_boundary"
  | "runtime_observation";

export type CruxDiscoverySignal = {
  id: string;
  kind: CruxDiscoverySignalKind;
  label: string;
  confidence: "high" | "medium" | "low";
  technology?: string;
  workflow_hint?: string;
  candidate_label?: string;
  evidence: Array<{
    path?: string;
    line?: number;
    symbol?: string;
    detail: string;
  }>;
};

export type CruxDiscoveryReport = {
  format: "crux-discovery/0.1";
  generated_at: string;
  source: {
    kind: "source_code";
    provider: "ship-check";
    label: string;
    external_ref?: string;
  };
  signals: CruxDiscoverySignal[];
  limitations: string[];
};

const sourceFile = /\.(?:[cm]?[jt]sx?|json|ya?ml)$/i;
const modelCallPatterns: Array<{ regex: RegExp; label: string; technology: string }> = [
  { regex: /\bgenerateText\s*\(/, label: "Vercel AI SDK text generation", technology: "ai" },
  { regex: /\bgenerateObject\s*\(/, label: "Vercel AI SDK structured generation", technology: "ai" },
  { regex: /\bstreamText\s*\(/, label: "Vercel AI SDK streaming generation", technology: "ai" },
  { regex: /\.chat\.completions\.create\s*\(/, label: "OpenAI-compatible chat completion", technology: "openai-compatible" },
  { regex: /\.responses\.create\s*\(/, label: "OpenAI responses call", technology: "openai" },
  { regex: /\.messages\.create\s*\(/, label: "Anthropic messages call", technology: "anthropic" },
  { regex: /\.llm\.generateStructured\s*\(/, label: "Structured generation through the project LLM provider", technology: "llm-provider" },
  { regex: /\.llm\.generateText\s*\(/, label: "Text generation through the project LLM provider", technology: "llm-provider" },
];

const lineNumber = (text: string, offset: number) => text.slice(0, offset).split("\n").length;
const idFor = (kind: string, file: string, line = 0) =>
  `signal:${kind}:${createHash("sha1").update(`${file}:${line}`).digest("hex").slice(0, 12)}`;

const pushUnique = (signals: CruxDiscoverySignal[], signal: CruxDiscoverySignal) => {
  if (!signals.some((existing) => existing.id === signal.id)) signals.push(signal);
};

const workflowFromEvidence = (
  file: string,
  text: string,
): { hint: string; label: string; offset: number } | null => {
  const exact = /\bsource\.extract\b/.exec(text);
  if (exact) return { hint: "source.extract", label: "Recommendation extraction", offset: exact.index };

  const recommendation = /\b(?:recommendations?\.extract|extract\.recommendations?)\b/i.exec(text);
  if (recommendation) return { hint: "recommendation.extract", label: "Recommendation extraction", offset: recommendation.index };

  if (/\/api\/chat-search\/route\.[cm]?[jt]sx?$/i.test(file)) {
    return { hint: "chat.search", label: "Chat search", offset: 0 };
  }

  return null;
};

export async function discoverAIProject(
  projectPath: string,
  sourceInput?: ProjectEvidenceSourceInput,
): Promise<CruxDiscoveryReport> {
  const context = await createProjectContext(projectPath, sourceInput);
  const signals: CruxDiscoverySignal[] = [];
  const packageText = context.hasFile("package.json") ? await context.readText("package.json") : null;

  if (packageText) {
    const packageSignals = [
      { token: '"ai"', label: "Vercel AI SDK dependency", technology: "ai" },
      { token: '"@ai-sdk/openai-compatible"', label: "OpenAI-compatible AI SDK adapter", technology: "openai-compatible" },
      { token: '"openai"', label: "OpenAI SDK dependency", technology: "openai" },
      { token: '"@anthropic-ai/sdk"', label: "Anthropic SDK dependency", technology: "anthropic" },
      { token: '"@google/generative-ai"', label: "Google Generative AI dependency", technology: "google" },
    ];
    for (const item of packageSignals) {
      const offset = packageText.indexOf(item.token);
      if (offset < 0) continue;
      const line = lineNumber(packageText, offset);
      pushUnique(signals, {
        id: idFor("ai-sdk", "package.json", line),
        kind: "ai_sdk",
        label: item.label,
        confidence: "high",
        technology: item.technology,
        evidence: [{ path: "package.json", line, detail: `${item.label} is declared in project dependencies.` }],
      });
    }
  }

  for (const file of context.files.filter((item) => sourceFile.test(item))) {
    const text = await context.readText(file);
    if (!text) continue;

    const workflow = workflowFromEvidence(file, text);
    if (workflow) {
      const line = lineNumber(text, workflow.offset);
      pushUnique(signals, {
        id: idFor("workflow", file, line),
        kind: "workflow_job",
        label: workflow.hint,
        confidence: "high",
        workflow_hint: workflow.hint,
        candidate_label: workflow.label,
        evidence: [{ path: file, line, detail: `A named workflow/job boundary ${workflow.hint} is present in source evidence.` }],
      });
    }

    const providerMatch = /\b(?:interface\s+LlmProvider|LLM_PROVIDER|createOpenAICompatible|createOpenAICompatLlm)\b/.exec(text);
    if (providerMatch) {
      const line = lineNumber(text, providerMatch.index);
      pushUnique(signals, {
        id: idFor("provider", file, line),
        kind: "provider_configuration",
        label: "Configurable LLM provider boundary",
        confidence: "high",
        ...(/OpenAICompatible|OpenAICompat/.test(providerMatch[0]) ? { technology: "openai-compatible" } : {}),
        evidence: [{ path: file, line, detail: "Source contains a configurable LLM/provider boundary." }],
      });
    }

    for (const pattern of modelCallPatterns) {
      const match = pattern.regex.exec(text);
      if (!match) continue;
      const line = lineNumber(text, match.index);
      const localWorkflow = workflowFromEvidence(file, text);
      pushUnique(signals, {
        id: idFor("model-call", file, line),
        kind: "model_call",
        label: pattern.label,
        confidence: "high",
        technology: pattern.technology,
        ...(localWorkflow
          ? { workflow_hint: localWorkflow.hint, candidate_label: localWorkflow.label }
          : {}),
        evidence: [{ path: file, line, detail: `${pattern.label} call site detected. Prompt and response content are not included.` }],
      });
    }

    const reviewMatch = /\b(?:human[_ -]?review|reviewBeforeEffect|approveRecommendation|reviewRecommendation)\b/i.exec(text);
    if (reviewMatch) {
      const line = lineNumber(text, reviewMatch.index);
      pushUnique(signals, {
        id: idFor("human-review", file, line),
        kind: "human_review_surface",
        label: "Human review surface",
        confidence: "medium",
        ...(workflow ? { workflow_hint: workflow.hint, candidate_label: workflow.label } : {}),
        evidence: [{ path: file, line, detail: "Source contains an explicit human-review or approval marker." }],
      });
    }
  }

  return {
    format: "crux-discovery/0.1",
    generated_at: new Date().toISOString(),
    source: {
      kind: "source_code",
      provider: "ship-check",
      label: context.source.label || path.basename(context.root),
      ...(context.source.provider === "github" ? { external_ref: context.source.label } : {}),
    },
    signals,
    limitations: [
      "Static source inspection can identify technical AI and workflow signals, but cannot establish organisational purpose, affected people, decision authority or whether a candidate represents one coherent AI use.",
      "No prompt, response, source-document or application-record content is included in this discovery report.",
      "Absence of a discovery signal does not establish absence of AI use.",
    ],
  };
}
