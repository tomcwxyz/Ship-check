import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SHIP_CHECK_SKILL_RELATIVE_PATH,
  installShipCheckSkill
} from "./skill.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true })
    )
  );
});

async function temporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-skill-test-"));
  temporaryRoots.push(root);
  return root;
}

describe("Ship Check Agent Skill installer", () => {
  it("installs the canonical skill and is idempotent", async () => {
    const root = await temporaryDirectory();

    const first = await installShipCheckSkill(root);
    expect(first.status).toBe("installed");

    const content = await fs.readFile(
      path.join(root, SHIP_CHECK_SKILL_RELATIVE_PATH),
      "utf8"
    );
    expect(content).toContain("name: ship-check");
    expect(content).toContain("deterministic evidence layer");

    const second = await installShipCheckSkill(root);
    expect(second.status).toBe("unchanged");
  });

  it("refuses to overwrite changed skill content unless force is explicit", async () => {
    const root = await temporaryDirectory();
    await installShipCheckSkill(root);

    const destination = path.join(root, SHIP_CHECK_SKILL_RELATIVE_PATH);
    await fs.writeFile(destination, "custom local skill\n", "utf8");

    await expect(installShipCheckSkill(root)).rejects.toThrow("--force");

    const replaced = await installShipCheckSkill(root, { force: true });
    expect(replaced.status).toBe("replaced");
    expect(await fs.readFile(destination, "utf8")).toContain("name: ship-check");
  });
});
