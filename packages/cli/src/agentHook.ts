import { promises as fs } from "node:fs";
import path from "node:path";

export type HookInstallResult = {
  path: string;
  status: "installed" | "unchanged" | "updated";
};

type Hook = { type: "command"; command: string; timeout: number };
type HookGroup = { matcher: string; hooks: Hook[] };

const TARGET = path.join(".claude", "settings.local.json");

/**
 * Explicit user action only. Never edit team-shared settings or silently enable a network scan.
 * Claude Code requires a separate trust/review step for local hook changes.
 */
export async function installAgentSessionHook(
  projectRoot: string,
  networked: boolean
): Promise<HookInstallResult> {
  const root = await fs.realpath(path.resolve(projectRoot));
  if (!(await fs.stat(root)).isDirectory()) throw new Error("Agent hook target must be a directory.");
  const destination = path.join(root, TARGET);
  let parsed: Record<string, unknown> = {};
  try {
    const content = await fs.readFile(destination, "utf8");
    const loaded: unknown = JSON.parse(content);
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      throw new Error("Existing Claude settings are not a JSON object.");
    }
    parsed = loaded as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const existingHooks = parsed.hooks;
  if (existingHooks !== undefined && (!existingHooks || typeof existingHooks !== "object" || Array.isArray(existingHooks))) {
    throw new Error("Existing Claude hook configuration is malformed; no changes made.");
  }
  const hooks = (existingHooks ?? {}) as Record<string, unknown>;
  const existingGroups = hooks.SessionStart ?? [];
  if (!Array.isArray(existingGroups)) {
    throw new Error("Existing SessionStart hooks are not an array; no changes made.");
  }

  const command = `ship-check agent-check .${networked ? " --networked-dependency-scan" : ""}`;
  const groups = structuredClone(existingGroups) as HookGroup[];
  let located = false;
  let changed = false;
  for (const group of groups) {
    if (!group || !Array.isArray(group.hooks)) {
      throw new Error("Existing SessionStart hook group is malformed; no changes made.");
    }
    for (const hook of group.hooks) {
      if (hook?.type !== "command" || typeof hook.command !== "string") continue;
      if (hook.command.startsWith("ship-check agent-check .")) {
        if (located) throw new Error("Multiple Ship Check hooks exist; review them manually.");
        located = true;
        if (hook.command !== command) {
          hook.command = command;
          changed = true;
        }
      }
    }
  }
  if (!located) {
    groups.push({ matcher: "startup|resume", hooks: [{
      type: "command", command, timeout: 60
    }] });
    changed = true;
  }
  if (!changed) return { path: destination, status: "unchanged" };
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const updated = { ...parsed, hooks: { ...hooks, SessionStart: groups } };
  await fs.writeFile(destination, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
  return { path: destination, status: located ? "updated" : "installed" };
}
