import type { CheckDefinition, ProjectContext } from "@ship-check/core";
import type { AssessmentGap } from "@ship-check/schemas";
import { supabaseSignals } from "./supabase.js";

const sourceTextPattern = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/i;
const requestSurfacePathPattern = /(?:^|\/)(?:app|src\/app)\/api\/.+\/route\.(?:js|jsx|ts|tsx)$|(?:^|\/)(?:pages|src\/pages)\/api\/.+\.(?:js|jsx|ts|tsx)$|(?:^|\/)(?:api|functions)\/.+\.(?:js|jsx|ts|tsx)$|(?:^|\/)supabase\/functions\/.+\.(?:js|jsx|ts|tsx)$/i;
const requestHandlerPattern = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)|\bfetch\s*\(|["']use server["']/;
const privilegedSecretNamePattern = /\b(?:SUPABASE_SECRET_KEY|SUPABASE_SECRET_KEYS)\b/g;

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function gap(input: {
  id: string;
  checkId: string;
  title: string;
  summary: string;
  evidence: AssessmentGap["evidence"];
  verify: string;
}): AssessmentGap {
  return {
    id: input.id,
    checkId: input.checkId,
    pack: "secure-build",
    area: "database",
    title: input.title,
    summary: input.summary,
    evidence: input.evidence,
    verify: input.verify
  };
}

export const supabasePrivilegedKeyBoundaryCheck: CheckDefinition = {
  id: "database.supabase-secret-key-boundary",
  version: "1",
  pack: "secure-build",
  title: "Supabase privileged secret-key boundaries",
  description: "Identifies request-handling code that directly reads the current Supabase secret-key environment variables, then asks for caller and RLS-bypass verification.",
  principles: ["practice.preserve-safety"],
  coverage: [{ area: "database", status: "partial" }, { area: "access-control", status: "partial" }],
  async appliesTo(context) {
    if ((await supabaseSignals(context)).length === 0) return false;
    return context.files.some((file) => sourceTextPattern.test(file));
  },
  async run(context) {
    const gaps: AssessmentGap[] = [];

    for (const file of context.files.filter((candidate) => sourceTextPattern.test(candidate))) {
      const text = await context.readText(file);
      if (!text) continue;
      const requestSurface = requestSurfacePathPattern.test(file) || requestHandlerPattern.test(text);
      if (!requestSurface) continue;

      privilegedSecretNamePattern.lastIndex = 0;
      let match = privilegedSecretNamePattern.exec(text);
      while (match) {
        const credentialName = match[0];
        gaps.push(gap({
          id: `${this.id}:${file}:${credentialName}`,
          checkId: this.id,
          title: "Request path reads a Supabase key that bypasses RLS",
          summary: `${file} references ${credentialName} in request-handling code. Current Supabase secret keys have privileged data access and bypass Row Level Security, but source alone cannot establish who may reach this path or whether the privileged scope is necessary.`,
          evidence: [{
            kind: "file-match",
            path: file,
            line: lineNumber(text, match.index),
            excerpt: `${credentialName} reference`,
            detail: "Only the environment-variable name is retained; Ship Check does not read or report the key value."
          }],
          verify: "Verify the authentication/authorisation boundary before this request path, confirm the privileged Supabase client is only used server-side for operations that genuinely require RLS bypass, and prefer a user-scoped/publishable client where the caller's RLS policies should apply."
        }));
        match = privilegedSecretNamePattern.exec(text);
      }
    }

    return { gaps };
  }
};

export const supabaseKeySourceChecks: CheckDefinition[] = [supabasePrivilegedKeyBoundaryCheck];
