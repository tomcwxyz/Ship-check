import type { CheckDefinition, CheckExecution } from "@ship-check/core";
import type { AssessmentGap } from "@ship-check/schemas";

export const browserDataCheck: CheckDefinition = {
  id: "production.browser-data-boundaries",
  version: "1",
  pack: "production-ready",
  title: "Where browser data goes",
  description: "Identify browser database clients and potential mismatches between local-data promises and external lookups.",
  async run(context): Promise<CheckExecution> {
    const gaps: AssessmentGap[] = [];
    const observations: NonNullable<CheckExecution["observations"]> = [];
    for (const file of context.files.filter(file => /\.(?:jsx?|tsx?)$/.test(file) && !/(?:test|spec)\.[jt]sx?$/.test(file))) {
      const text = await context.readText(file);
      if (!text) continue;
      const evidence = [{ kind: "file-match" as const, path: file, detail: "Source markers identified; deployed behaviour and database policies have not been tested." }];
      if (/await\s+\w*(?:insert|save|upload)\w*\([^;]*\);\s*set\w+\(true\)/i.test(text) && /if\s*\(\s*\w*[Ee]rror\s*\)\s*\{[^}]*return\s*;/.test(text)) {
        gaps.push({ id: `${this.id}:save:${file}`, checkId: this.id, pack: this.pack, area: "runtime",
          title: "Check that a failed save cannot show a success message",
          summary: "This file sets a success state after waiting for a save and also contains an error path that returns without throwing. These patterns may be connected; the scan cannot prove the full call path.", evidence,
          verify: "Simulate a failed save in a test environment. Keep the entered data and show a clear error with a retry option. Only display success after the database confirms the save. Check that contribution buttons do not also submit their surrounding form." });
      }
      if (/from\s*['"]@supabase\/supabase-js['"]/.test(text) && /createClient\s*\(/.test(text) && /(?:anon|publishable)/i.test(text) && !/['"]use server['"]/.test(text)) {
        gaps.push({ id: `${this.id}:database:${file}`, checkId: this.id, pack: this.pack, area: "database",
          title: "Check who can access contributed data",
          summary: "A public Supabase client appears in this project. Public keys can be normal; this scan cannot establish which records visitors can read or change.", evidence,
          verify: "Ask your developer to inspect the deployed table grants and row-level security policies. In a test environment, verify allowed and denied reads, inserts, updates and deletes for visitors and signed-in users. Keep only the intended public data accessible; do not change or rotate a public key merely to silence this check." });
      }
      if (/fetch\s*\(\s*[`'"]https:\/\/api\.postcodes\.io\/postcodes\//.test(text)) {
        observations.push({ id: `${this.id}:postcode:${file}`, checkId: this.id, pack: this.pack, area: "runtime", kind: "inventory",
          title: "This code can send postcodes to a lookup service",
          summary: "A postcode lookup to postcodes.io appears in the source. Check when it runs and what people are told before using it.", evidence });
        if (/(?:doesn.t leave your browser|stays? in (?:your|the) browser)/i.test(text)) {
          gaps.push({ id: `${this.id}:promise:${file}`, checkId: this.id, pack: this.pack, area: "runtime",
            title: "Check the promise that data stays in the browser",
            summary: "This file contains both a local-data promise and an external postcode lookup. The scan cannot prove whether consent is obtained before the request.", evidence,
            verify: "Visualise a dummy CSV with external lookup disabled and inspect network requests. No postcode should leave the browser. If lookup is intended, explain the destination and data sent before offering an explicit choice. Add a test for the no-consent path." });
        }
      }
    }
    return { gaps, observations, coverage: [] };
  }
};
