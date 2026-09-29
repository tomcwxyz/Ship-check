import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SHIP_CHECK_SKILL_RELATIVE_PATH = path.join(
  ".claude",
  "skills",
  "ship-check",
  "SKILL.md"
);

export type SkillInstallResult = {
  path: string;
  status: "installed" | "unchanged" | "replaced";
};

function skillSourceCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(moduleDir, "skill", "SKILL.md"),
    path.resolve(moduleDir, "../../../.claude/skills/ship-check/SKILL.md")
  ];
}

export async function loadShipCheckSkillMarkdown(): Promise<string> {
  for (const candidate of skillSourceCandidates()) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  throw new Error(
    "This Ship Check distribution does not include the Agent Skill asset. Use the npm package or a repository checkout that includes .claude/skills/ship-check/SKILL.md."
  );
}

export async function installShipCheckSkill(
  targetRoot: string,
  options: { force?: boolean } = {}
): Promise<SkillInstallResult> {
  const root = path.resolve(targetRoot);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new Error(`Agent Skill target does not exist: ${root}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Agent Skill target must be a directory: ${root}`);
  }

  const markdown = await loadShipCheckSkillMarkdown();
  const destination = path.join(root, SHIP_CHECK_SKILL_RELATIVE_PATH);

  let existing: string | null = null;
  try {
    existing = await fs.readFile(destination, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (existing === markdown) {
    return { path: destination, status: "unchanged" };
  }
  if (existing !== null && !options.force) {
    throw new Error(
      `Ship Check Agent Skill already exists at ${destination} with different content. Re-run with --force to replace it.`
    );
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, markdown, "utf8");
  return {
    path: destination,
    status: existing === null ? "installed" : "replaced"
  };
}
