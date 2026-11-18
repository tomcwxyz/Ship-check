export type Finding = {
  id: string; title: string; summary: string; severity: string;
  confidence: string; checkId: string; evidence: Array<{ path?: string; line?: number; detail: string }>;
  remediation: { why: string; fix: string; verify: string; agentPrompt: string };
};
export type Gap = { id: string; title: string; summary: string; area: string; verify: string };
export type Coverage = { area: string; status: "assessed" | "partial" | "not-assessed"; detail: string };
export type ScanReport = {
  schemaVersion: "0.1";
  tool: { name: "ship-check"; version: string };
  project: { path: string; fileCount: number; snapshot?: { source: { executionLocation: string } } };
  findings: Finding[];
  gaps: Gap[];
  coverage: Coverage[];
  checks: Array<{ status: string }>;
  summary: { total: number; critical: number; high: number; medium: number; low: number; info: number };
  generatedAt: string;
  monitoringHandoff?: {schemaVersion:"ship-check-monitoring-handoff/0.1";metadata:unknown;inventory:{schemaVersion:"ship-check-technology-inventory/0.1";components:unknown[];sourceInventory:"complete"|"not-assessed";siteHints?:Array<{cms:"wordpress"|"drupal";confidence:"likely"|"possible"}>}};
};
