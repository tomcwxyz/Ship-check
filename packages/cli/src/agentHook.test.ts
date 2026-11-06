import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installAgentSessionHook } from "./agentHook.js";

describe("explicit agent session hook", () => {
  it("preserves existing Claude settings and only adds an opt-in local hook", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-agent-hook-"));
    try {
      await fs.mkdir(path.join(root, ".claude"));
      const target = path.join(root, ".claude", "settings.local.json");
      await fs.writeFile(target, JSON.stringify({ theme: "custom", hooks: {
        SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hello" }] }]
      } }));
      const first = await installAgentSessionHook(root, false);
      const second = await installAgentSessionHook(root, false);
      const third = await installAgentSessionHook(root, true);
      expect([first.status, second.status, third.status]).toEqual(["installed", "unchanged", "updated"]);
      const settings = JSON.parse(await fs.readFile(target, "utf8"));
      expect(settings.theme).toBe("custom");
      expect(settings.hooks.SessionStart).toHaveLength(2);
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo hello");
      expect(settings.hooks.SessionStart[1].hooks[0].command).toContain("--networked-dependency-scan");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects broken existing settings instead of overwriting them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-hook-invalid-"));
    try {
      await fs.mkdir(path.join(root, ".claude"));
      await fs.writeFile(path.join(root, ".claude", "settings.local.json"), "{broken");
      await expect(installAgentSessionHook(root, false)).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
