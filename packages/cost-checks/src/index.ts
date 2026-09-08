import type { TracedSource } from "@ship-check/checks/surface";
import { traceLocalImports } from "@ship-check/checks/surface";
import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { Finding, Severity } from "@ship-check/schemas";

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function finding(input: {
  checkId: string;
  suffix: string;
  title: string;
  summary: string;
  severity: Severity;
  confidence?: Finding["confidence"];
  evidence: Finding["evidence"];
  why: string;
  fix: string;
  verify: string;
  agentPrompt: string;
}): Finding {
  return {
    id: `${input.checkId}:${input.suffix}`,
    checkId: input.checkId,
    pack: "cost-aware",
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    confidence: input.confidence ?? "high",
    evidence: input.evidence,
    remediation: {
      why: input.why,
      fix: input.fix,
      verify: input.verify,
      agentPrompt: input.agentPrompt
    }
  };
}

function cronIntervalMinutes(schedule: string): number | null {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return null;

  if (minute === "*" && hour === "*") return 1;
  const minuteStep = /^\*\/(\d+)$/.exec(minute);
  if (minuteStep && hour === "*") return Number(minuteStep[1]);

  const minuteList = /^\d+(?:,\d+)+$/.exec(minute);
  if (minuteList && hour === "*") {
    const values = minute.split(",").map(Number).sort((a, b) => a - b);
    const gaps = values.map((value, index) => {
      const next = values[(index + 1) % values.length];
      return index === values.length - 1 ? 60 - value + next : next - value;
    });
    return Math.min(...gaps);
  }

  if (/^\d+$/.test(minute) && hour === "*") return 60;
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (/^\d+$/.test(minute) && hourStep) return Number(hourStep[1]) * 60;
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeForCronPath(files: string[], cronPath: string): string | undefined {
  const normalised = cronPath.replace(/^\/+|\/+$/g, "");
  if (!normalised.startsWith("api/")) return undefined;
  const escaped = escapeRegExp(normalised);
  const pattern = new RegExp(
    `(^|/)(?:app/${escaped}/route|pages/${escaped}(?:/index)?)\\.(?:js|jsx|ts|tsx)$`,
    "i"
  );
  return files.find((file) => pattern.test(file));
}

type WorkMarker = {
  key: "model" | "paid-provider" | "database" | "fan-out" | "network";
  label: string;
  weight: number;
  pattern: RegExp;
};

const workMarkers: WorkMarker[] = [
  {
    key: "model",
    label: "AI/model work",
    weight: 3,
    pattern: /\b(?:OpenAI|Anthropic|generateText|generateObject|streamText|chat\.completions|responses\.create|messages\.create)\b/i
  },
  {
    key: "paid-provider",
    label: "paid provider work",
    weight: 2,
    pattern: /\b(?:Resend|Firecrawl|Stripe|emails\.send|firecrawl|stripe\.)\b/i
  },
  {
    key: "database",
    label: "database work",
    weight: 2,
    pattern: /\b(?:PrismaClient|drizzle\s*\(|createServerClient|DATABASE_URL|POSTGRES_URL|neon\s*\(|SUPABASE_SERVICE_ROLE_KEY)|@(?:prisma\/client|neondatabase\/serverless|supabase\/supabase-js)|drizzle-orm|\b(?:db|database)\.(?:query|insert|update|delete|select)\b/i
  },
  {
    key: "fan-out",
    label: "fan-out/concurrent work",
    weight: 2,
    pattern: /\bPromise\.(?:all|allSettled)\s*\(|\.map\s*\(\s*async\b|\.flatMap\s*\(\s*async\b/i
  },
  {
    key: "network",
    label: "network work",
    weight: 1,
    pattern: /\b(?:fetch\s*\(|axios\.|got\s*\(|ky\s*\()/i
  }
];

type WorkComposition = {
  score: number;
  labels: string[];
  evidencePaths: string[];
};

function workComposition(sources: TracedSource[]): WorkComposition {
  const matched = new Map<WorkMarker["key"], { marker: WorkMarker; path: string }>();
  for (const source of sources) {
    for (const marker of workMarkers) {
      if (matched.has(marker.key)) continue;
      marker.pattern.lastIndex = 0;
      if (marker.pattern.test(source.text)) matched.set(marker.key, { marker, path: source.file });
    }
  }
  const values = [...matched.values()];
  return {
    score: values.reduce((sum, item) => sum + item.marker.weight, 0),
    labels: values.map((item) => item.marker.label),
    evidencePaths: [...new Set(values.map((item) => item.path))]
  };
}

function severityForCron(minutes: number, composition: WorkComposition): Severity {
  if (composition.score >= 3) {
    if (minutes <= 15) return "high";
    return "medium";
  }
  if (composition.score >= 2) {
    if (minutes <= 5) return "high";
    if (minutes <= 30) return "medium";
    return "low";
  }
  if (composition.score >= 1) {
    if (minutes <= 15) return "medium";
    return "low";
  }
  return minutes <= 5 ? "medium" : "low";
}

const vercelCronFrequencyCheck: CheckDefinition = {
  id: "cost.vercel-cron-frequency",
  version: "2",
  pack: "cost-aware",
  title: "Frequent Vercel cron work",
  description: "Combine repository-declared Vercel cron cadence with bounded evidence about the work reached by the scheduled route.",
  async run(context) {
    const text = await context.readText("vercel.json");
    if (!text) return [];

    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      return [];
    }

    if (!config || typeof config !== "object") return [];
    const crons = (config as { crons?: unknown }).crons;
    if (!Array.isArray(crons)) return [];

    const findings: Finding[] = [];
    for (const [index, item] of crons.entries()) {
      if (!item || typeof item !== "object") continue;
      const cronPath = (item as { path?: unknown }).path;
      const schedule = (item as { schedule?: unknown }).schedule;
      if (typeof cronPath !== "string" || typeof schedule !== "string") continue;
      const minutes = cronIntervalMinutes(schedule);
      if (minutes === null || minutes >= 60) continue;

      const route = routeForCronPath(context.files, cronPath);
      const sources = route ? await traceLocalImports(context, route) : [];
      const composition = workComposition(sources);
      const severity = severityForCron(minutes, composition);
      const workDescription = composition.labels.length > 0
        ? ` Ship Check traced ${composition.labels.join(", ")} through ${route ?? "the scheduled route"} and bounded local helpers.`
        : route
          ? ` Ship Check resolved ${route}, but did not find a recognised model, paid-provider, database, fan-out or network marker in the bounded local call graph.`
          : " Ship Check could not map the schedule to a recognised Next.js route, so work composition was not established.";

      findings.push(
        finding({
          checkId: this.id,
          suffix: `${index}:${cronPath}`,
          title: composition.score >= 2
            ? "Frequent scheduled work reaches cost-bearing operations"
            : "Scheduled server work runs more often than hourly",
          summary: `${cronPath} is scheduled approximately every ${minutes} minute${minutes === 1 ? "" : "s"}.${workDescription}`,
          severity,
          confidence: composition.labels.length > 0 ? "medium" : "high",
          evidence: [
            {
              kind: "configuration",
              path: "vercel.json",
              excerpt: `${cronPath} → ${schedule}`,
              detail: "The Vercel configuration declares a more-than-hourly cron schedule."
            },
            ...composition.evidencePaths.slice(0, 4).map((evidencePath) => ({
              kind: "file-match" as const,
              path: evidencePath,
              detail: "The bounded scheduled-route call graph contains a recognised cost-bearing work marker."
            }))
          ],
          why: composition.score >= 2
            ? "Frequent schedules compound model, paid-provider, database or fan-out work continuously. Cadence and work composition together are stronger cost evidence than cadence alone."
            : "Frequent scheduled functions consume compute continuously even when nobody is using the product. The current source evidence does not show obviously expensive work, so Ship Check keeps the concern lower than a frequent cost-bearing route.",
          fix: composition.score >= 2
            ? "Confirm both the cadence and the amount of work are genuinely required. Prefer event-driven/on-demand execution, batch or cache repeated work, and reduce the schedule to the lowest useful frequency without changing required user workflows."
            : "Confirm the cadence is genuinely required. Prefer event-driven/on-demand execution or reduce scheduled execution to the lowest useful frequency; avoid adding complexity solely to silence the check.",
          verify: "Measure function invocations and relevant downstream usage after the change, confirm required behaviour still occurs on time, then rerun Ship Check and compare the cadence/work evidence.",
          agentPrompt: `Review the Vercel cron ${cronPath} (${schedule}), mapped route ${route ?? "unresolved"}. Ship Check observed ${composition.labels.join(", ") || "no recognised cost-bearing work markers"} in the bounded call graph. Determine the lowest useful cadence and whether work can be event-driven, batched or cached. Preserve required behaviour, avoid speculative optimisation, and add instrumentation or a regression test for invocation frequency.`
        })
      );
    }
    return {
      findings,
      coverage: [{ area: "cost", status: "partial" }]
    };
  }
};

const networkUsePattern = /\b(?:fetch\s*\(|axios\.|\.refetch\s*\(|mutateAsync\s*\()/;
const setIntervalPattern = /setInterval\s*\([\s\S]{0,1200}?,\s*(\d[\d_]*)\s*\)/g;
const refetchIntervalPattern = /refetchInterval\s*:\s*(\d[\d_]*)/g;

function intervalFindings(
  context: ProjectContext,
  file: string,
  text: string,
  checkId: string
): Finding[] {
  if (!networkUsePattern.test(text)) return [];
  const findings: Finding[] = [];

  const candidates: Array<{ index: number; milliseconds: number; source: string }> = [];
  for (const pattern of [setIntervalPattern, refetchIntervalPattern]) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const milliseconds = Number(match[1].replaceAll("_", ""));
      if (Number.isFinite(milliseconds)) {
        candidates.push({ index: match.index, milliseconds, source: match[0].slice(0, 120) });
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate.milliseconds < 1_000 || candidate.milliseconds > 300_000) continue;
    const seconds = Math.round(candidate.milliseconds / 1000);
    const severity: Severity = candidate.milliseconds <= 60_000 ? "high" : "medium";
    findings.push(
      finding({
        checkId,
        suffix: `${file}:${lineNumber(text, candidate.index)}`,
        title: "Frequent network polling may create continuous compute",
        summary: `${file} contains network activity alongside a repeating interval of about ${seconds} seconds.`,
        severity,
        evidence: [{
          kind: "file-match",
          path: file,
          line: lineNumber(text, candidate.index),
          excerpt: `Repeating network-related interval: ~${seconds}s`,
          detail: "A bounded source heuristic found frequent polling in code that also performs network requests."
        }],
        why: "Short polling intervals can keep serverless functions, databases and paid APIs busy all day, even when the underlying state rarely changes.",
        fix: "Prefer on-demand refresh, push/event-driven updates or a substantially longer interval. If frequent polling is intentional, document the expected invocation and cost envelope.",
        verify: "Measure request/function invocation volume before and after the change and confirm the product still updates within the required latency.",
        agentPrompt: `Review the polling in ${file} around line ${lineNumber(text, candidate.index)}. It repeats roughly every ${seconds} seconds and the file performs network work. Replace it with event-driven/on-demand refresh or the lowest useful cadence, unless the latency requirement clearly justifies polling. Preserve UX behaviour and add a regression test or instrumentation for request frequency.`
      })
    );
  }

  return findings;
}

const frequentPollingCheck: CheckDefinition = {
  id: "cost.frequent-network-polling",
  pack: "cost-aware",
  title: "Frequent network polling",
  description: "Find short recurring polling intervals in source that also performs network work.",
  async run(context) {
    const findings: Finding[] = [];
    const files = context.files.filter(
      (file) => /\.(?:js|jsx|ts|tsx)$/i.test(file) && !/(?:^|\/).*(?:test|spec)\.(?:js|jsx|ts|tsx)$/i.test(file)
    );
    if (files.length === 0) return [];
    for (const file of files) {
      const text = await context.readText(file);
      if (!text) continue;
      findings.push(...intervalFindings(context, file, text, this.id));
    }
    return {
      findings,
      coverage: [{ area: "cost", status: "partial" }]
    };
  }
};

export const costAwareChecks: CheckDefinition[] = [
  vercelCronFrequencyCheck,
  frequentPollingCheck
];
