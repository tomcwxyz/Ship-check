import type { ScanReport } from "@ship-check/schemas";
import { toProjectHistoryMetadata } from "./history.js";

export type DiscoveredTechnology = {
  kind: "ai-model" | "wordpress-core" | "wordpress-plugin" | "wordpress-theme" | "drupal-package";
  id: string;
  version?: string;
  evidence: "source-declared";
};
export type SiteHint = { cms: "wordpress" | "drupal"; confidence: "likely" | "possible" };
export type TechnologyInventory = {
  schemaVersion: "ship-check-technology-inventory/0.1";
  components: DiscoveredTechnology[];
  siteHints?: SiteHint[];
  sourceInventory: "complete" | "not-assessed";
};

const MODEL_CHECK = "production.ai-model-lifecycle";
const CMS_CHECK = "production.cms-component-inventory";
const RUNTIME_CHECK = "runtime.cms-fingerprint";
const ID = /^[a-zA-Z0-9._/-]{1,160}$/;
const VERSION = /^[a-zA-Z0-9._+/-]{1,80}$/;
const MODEL = /^(?:gpt-|o[134](?:-|$)|claude-|gemini-|mistral-|codestral-|deepseek-|llama-|qwen-)/i;

function versionFrom(text: string): string | undefined {
  const v = /\b(?:declares? version|version declared as)\s+([A-Za-z0-9._+/-]{1,80})\b/i.exec(text)?.[1];
  return v && VERSION.test(v) ? v : undefined;
}

/** Extracts identifiers from the scanner's structured, bounded observations.
 * Never copies file paths, evidence excerpts, URLs, source or full reports to Cloud.
 * A partial source scan cannot replace a previously correct inventory.
 */
export function extractTechnologyInventory(report: ScanReport): TechnologyInventory {
  if (report.tool?.name !== "ship-check") throw new Error("A Ship Check report is required.");
  const checks = new Map(report.checks.map(check => [check.checkId, check]));
  const sourceComplete = report.project.snapshot?.inventory.fingerprint?.completeness === "complete";
  const sourceEvidence = report.checks.some(check => check.checkId === MODEL_CHECK || check.checkId === CMS_CHECK);
  const runtimeCheck = checks.get(RUNTIME_CHECK);
  if (sourceEvidence && !sourceComplete) {
    // URL-only scans list source checks as not-assessed; that isn't a partial source scan.
    const sourceAssessable = [MODEL_CHECK,CMS_CHECK].some(id => {
      const check = checks.get(id);
      return check && check.status !== "not-assessed";
    });
    if (sourceAssessable) throw new Error("Technology sync requires a complete source inventory.");
  }
  if (sourceComplete) {
    for (const id of [MODEL_CHECK, CMS_CHECK]) {
      const check = checks.get(id);
      if (!check || ["error","not-assessed"].includes(check.status)) {
        throw new Error("Technology discovery check did not complete: " + id);
      }
    }
  }
  if (runtimeCheck && runtimeCheck.status === "error") throw new Error("Runtime CMS discovery failed.");
  if (!sourceComplete && !runtimeCheck) throw new Error("No completed source or runtime discovery check was found.");

  const found = new Map<string, DiscoveredTechnology>();
  const add = (kind: DiscoveredTechnology["kind"], id: string, version?: string) => {
    if (!ID.test(id) || (version && !VERSION.test(version))) return;
    const item: DiscoveredTechnology = {kind,id,...(version ? {version} : {}),evidence:"source-declared"};
    found.set(kind+":"+id,item);
  };
  if (sourceComplete) {
    for (const item of report.observations) {
      if (item.checkId === MODEL_CHECK) {
        const model = /^Found ([A-Za-z0-9._/-]{1,160}) in source;/.exec(item.summary)?.[1];
        if (model && MODEL.test(model)) add("ai-model",model);
      } else if (item.checkId === CMS_CHECK && item.id.startsWith(CMS_CHECK+":")) {
        const suffix = item.id.slice(CMS_CHECK.length+1);
        if (suffix === "wordpress-core") add("wordpress-core","wordpress",versionFrom(item.summary));
        else {
          const wp = /^wordpress-(plugins|themes)\/([A-Za-z0-9._-]{1,120})$/.exec(suffix);
          const drupal = /^drupal-(drupal\/[A-Za-z0-9_-]{1,120})$/.exec(suffix);
          if (wp) add(wp[1]==="plugins"?"wordpress-plugin":"wordpress-theme",wp[2]!,versionFrom(item.summary));
          if (drupal) add("drupal-package",drupal[1]!,versionFrom(item.summary));
        }
      }
    }
    for (const finding of report.findings) {
      if (finding.checkId !== MODEL_CHECK) continue;
      for (const evidence of finding.evidence) {
        const model = /^Declared model: ([A-Za-z0-9._/-]{1,160})$/.exec(evidence.excerpt??"")?.[1];
        if (model && MODEL.test(model)) add("ai-model",model);
      }
    }
  }
  if (found.size>50) throw new Error("More than 50 technologies found; refusing to truncate the inventory.");
  const siteHints: SiteHint[] = [];
  if (runtimeCheck && runtimeCheck.status !== "not-assessed") {
    for (const item of report.observations) {
      if (item.checkId !== RUNTIME_CHECK) continue;
      const m = /^runtime\.cms-fingerprint:(wordpress|drupal)$/.exec(item.id);
      if (m && !siteHints.some(h=>h.cms===m[1])) {
        siteHints.push({cms:m[1] as SiteHint["cms"],confidence:item.summary.startsWith("Likely")?"likely":"possible"});
      }
    }
  }
  return {
    schemaVersion: "ship-check-technology-inventory/0.1",
    components:[...found.values()].sort((a,b)=>(a.kind+":"+a.id).localeCompare(b.kind+":"+b.id)),
    sourceInventory:sourceComplete?"complete":"not-assessed",
    ...(siteHints.length ? {siteHints} : {})
  };
}

/** The browser handoff contains only pseudonymous project/scan metadata,
 * recognised component identifiers and public CMS hints. Never the report.
 */
export function buildMonitoringHandoff(report: ScanReport) {
  const inventory=extractTechnologyInventory(report);
  return {
    schemaVersion: "ship-check-monitoring-handoff/0.1" as const,
    metadata: toProjectHistoryMetadata(report),
    inventory
  };
}
