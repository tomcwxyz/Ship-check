const COMPONENT_ID = /^[a-zA-Z0-9._/-]{1,160}$/;
const VERSION = /^[a-zA-Z0-9._+/-]{1,80}$/;
const MODEL = /^(?:gpt-|o[134](?:-|$)|claude-|gemini-|mistral-|codestral-|deepseek-|llama-|qwen-)/i;
const MODEL_OBS = "production.ai-model-lifecycle";
const CMS_OBS = "production.cms-component-inventory";

function entries(report, field) {
  return Array.isArray(report?.[field]) ? report[field] : [];
}
function parseVersion(summary) {
  const matched = typeof summary === "string"
    ? /\b(?:declares? version|version declared as)\s+([A-Za-z0-9._+/-]{1,80})\b/i.exec(summary)
    : null;
  return matched && VERSION.test(matched[1]) ? matched[1] : undefined;
}
function normalised(kind, id, version) {
  if (!COMPONENT_ID.test(id)) return null;
  if (version !== undefined && !VERSION.test(version)) return null;
  return { kind, id, ...(version ? { version } : {}), evidence: "source-declared" };
}
export function extractTechnologyInventory(report) {
  if (!report || typeof report !== "object") throw new Error("Full Ship Check JSON report is required.");
  const checks = entries(report, "checks");
  for (const checkId of [MODEL_OBS, CMS_OBS]) {
    const check = checks.find(x => x?.checkId === checkId);
    if (!check || ["error","not-assessed"].includes(check.status)) {
      throw new Error("Technology discovery check did not complete: " + checkId);
    }
  }
  // A partial scan can fail to see components that are still present.
  const completeness = report?.project?.snapshot?.inventory?.fingerprint?.completeness;
  if (completeness !== "complete") {
    throw new Error("Technology sync requires a complete source inventory.");
  }
  const unique = new Map();
  const add = candidate => {
    if (candidate) unique.set(candidate.kind + ":" + candidate.id, candidate);
  };
  for (const observation of entries(report,"observations")) {
    if (!observation || typeof observation !== "object") continue;
    if (observation.checkId === MODEL_OBS) {
      const match = /^Found ([a-zA-Z0-9._/-]{1,160}) in source;/.exec(observation.summary ?? "");
      if (match && MODEL.test(match[1])) add(normalised("ai-model",match[1]));
    } else if (observation.checkId === CMS_OBS) {
      const id = observation.id?.slice((CMS_OBS + ":").length);
      if (typeof id !== "string" || !observation.id.startsWith(CMS_OBS + ":")) continue;
      if (id === "wordpress-core") {
        add(normalised("wordpress-core","wordpress",parseVersion(observation.summary)));
      } else if (/^wordpress-(plugins|themes)\/[a-zA-Z0-9._-]{1,120}$/.test(id)) {
        const [type,slug] = id.slice("wordpress-".length).split("/");
        add(normalised(type === "plugins" ? "wordpress-plugin" : "wordpress-theme",slug,parseVersion(observation.summary)));
      } else if (/^drupal-drupal\/[a-zA-Z0-9_-]+$/.test(id)) {
        add(normalised("drupal-package",id.slice("drupal-".length),parseVersion(observation.summary)));
      }
    }
  }
  for (const finding of entries(report,"findings")) {
    if (finding?.checkId !== MODEL_OBS) continue;
    for (const evidence of Array.isArray(finding.evidence) ? finding.evidence : []) {
      const match = /^Declared model: ([A-Za-z0-9._/-]{1,160})$/.exec(evidence?.excerpt ?? "");
      if (match && MODEL.test(match[1])) add(normalised("ai-model",match[1]));
    }
  }
  if (unique.size > 50) throw new Error("More than 50 discovered components: refusing truncated sync.");
  return {
    schemaVersion: "ship-check-technology-inventory/0.1",
    components: [...unique.values()].sort((a,b) => (a.kind+":"+a.id).localeCompare(b.kind+":"+b.id))
  };
}
