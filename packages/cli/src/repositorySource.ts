import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PreparedRepositorySource = {
  kind: "local" | "github";
  projectPath: string;
  displayName: string;
  cleanup: () => Promise<void>;
};

type ParsedGithubRepository = {
  cloneUrl: string;
  displayName: string;
};

const githubSlugPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const githubSshPattern = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

function normaliseSlug(owner: string, repository: string): ParsedGithubRepository {
  const repo = repository.replace(/\.git$/i, "");
  if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new Error("GitHub repository names must use owner/repository.");
  }
  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    displayName: `https://github.com/${owner}/${repo}`,
  };
}

export function parseGithubRepository(value: string): ParsedGithubRepository | null {
  const input = value.trim();
  if (!input) return null;

  const sshMatch = input.match(githubSshPattern);
  if (sshMatch) {
    return {
      cloneUrl: `git@github.com:${sshMatch[1]}/${sshMatch[2]}.git`,
      displayName: `https://github.com/${sshMatch[1]}/${sshMatch[2]}`,
    };
  }

  if (githubSlugPattern.test(input) && !input.startsWith("./") && !input.startsWith("../")) {
    const [owner, repository] = input.split("/");
    return normaliseSlug(owner!, repository!);
  }

  if (!input.startsWith("https://") && !input.startsWith("ssh://")) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase() !== "github.com") return null;
  if (url.password || (url.username && !(url.protocol === "ssh:" && url.username === "git"))) {
    throw new Error("Do not put credentials or access tokens in a GitHub repository URL.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("Use a GitHub repository URL such as https://github.com/owner/repository.");
  }

  const parsed = normaliseSlug(parts[0]!, parts[1]!);
  if (url.protocol === "ssh:") {
    parsed.cloneUrl = `ssh://git@github.com/${parts[0]}/${parts[1]!.replace(/\.git$/i, "")}.git`;
  }
  return parsed;
}

function validateRef(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const value = ref.trim();
  if (!value) return undefined;
  if (value.length > 200 || value.startsWith("-") || /[\r\n\0]/.test(value)) {
    throw new Error("The Git ref is not safe to pass to git.");
  }
  return value;
}

async function localDirectory(value: string): Promise<string | null> {
  try {
    const stat = await fs.stat(value);
    return stat.isDirectory() ? path.resolve(value) : null;
  } catch {
    return null;
  }
}

export async function prepareRepositorySource(
  input: string,
  options: { ref?: string } = {},
): Promise<PreparedRepositorySource> {
  const local = await localDirectory(input);
  if (local) {
    return {
      kind: "local",
      projectPath: local,
      displayName: local,
      cleanup: async () => {},
    };
  }

  const github = parseGithubRepository(input);
  if (!github) {
    throw new Error(
      `Could not find '${input}' as a local folder or GitHub repository. Use a folder path, owner/repository, or a github.com repository URL.`,
    );
  }

  const ref = validateRef(options.ref);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-repo-"));
  const checkoutPath = path.join(temporaryRoot, "repository");
  const args = ["clone", "--depth", "1", "--single-branch"];
  if (ref) args.push("--branch", ref);
  args.push(github.cloneUrl, checkoutPath);

  try {
    await execFileAsync("git", args, {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not clone ${github.displayName}${ref ? ` at ${ref}` : ""}. Make sure git can access the repository on this machine. ${message}`,
    );
  }

  let cleaned = false;
  return {
    kind: "github",
    projectPath: checkoutPath,
    displayName: `${github.displayName}${ref ? `#${ref}` : ""}`,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}
