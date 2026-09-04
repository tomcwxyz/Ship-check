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
    confidence: "high",
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

function severityForMinutes(minutes: number): Severity {
  if (minutes <= 5) return "high";
  if (minutes <= 15) return "medium";
  return "low";
}

const vercelCronFrequencyCheck: CheckDefinition = {
  id: "cost.vercel-cron-frequency",
  pack: "cost-aware",
  title: "Frequent Vercel cron work",
  description: "Flag repository-declared Vercel cron jobs that run more often than hourly.",
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
      const path = (item as { path?: unknown }).path;
      const schedule = (item as { schedule?: unknown }).schedule;
      if (typeof path !== "string" || typeof schedule !== "string") continue;
      const minutes = cronIntervalMinutes(schedule);
      if (minutes === null || minutes >= 60) continue;

      findings.push(
        finding({
          checkId: this.id,
          suffix: `${index}:${path}`,
          title: "Scheduled server work runs more often than hourly",
          summary: `${path} is scheduled approximately every ${minutes} minute${minutes === 1 ? "" : "s"}.`,
          severity: severityForMinutes(minutes),
          evidence: [{
            kind: "configuration",
            path: "vercel.json",
            excerpt: `${path} → ${schedule}`,
            detail: "The Vercel configuration declares a high-frequency cron schedule."
          }],
          why: "Frequent scheduled functions can consume compute continuously even when nobody is using the product, and can multiply downstream API or model costs.",
          fix: "Confirm the cadence is genuinely required. Prefer event-driven or on-demand work, or reduce scheduled execution to the lowest useful frequency. Keep user-configured daily workflows separate from background polling.",
          verify: "Check Vercel function invocations and downstream usage after changing the schedule, then rerun Ship Check.",
          agentPrompt: `Review the Vercel cron ${path} (${schedule}). Determine what it does, whether it needs to run every ${minutes} minutes, and change it to event-driven/on-demand execution or the lowest useful cadence. Preserve required user-scheduled workflows and add a test for the new scheduling boundary.`
        })
      );
    }
    return findings;
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
    for (const file of files) {
      const text = await context.readText(file);
      if (!text) continue;
      findings.push(...intervalFindings(context, file, text, this.id));
    }
    return findings;
  }
};

export const costAwareChecks: CheckDefinition[] = [
  vercelCronFrequencyCheck,
  frequentPollingCheck
];
