import { createHash } from "node:crypto";
import { createProjectContext } from "@ship-check/core";
import type { MigrationFramework } from "@ship-check/schemas/databaseEvidence";

export type MigrationManifest = {
  framework: MigrationFramework;
  status: "complete" | "absent" | "ambiguous" | "invalid";
  entries: Array<{ identifier: string; checksum?: string; path: string }>;
};

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export async function loadMigrationManifest(
  sourceDirectory: string,
  framework: MigrationFramework
): Promise<MigrationManifest> {
  const context = await createProjectContext(sourceDirectory);
  const result: MigrationManifest = { framework, status: "absent", entries: [] };
  const entries: MigrationManifest["entries"] = [];
  if (framework === "drizzle") {
    const journals = context.files.filter((path) => /(?:^|\/)drizzle\/(?:meta|_meta)\/_journal\.json$/.test(path));
    if (journals.length > 1) return { ...result, status: "ambiguous" };
    if (journals.length === 0) return result;
    const journalPath = journals[0]!;
    const text = await context.readText(journalPath);
    if (!text) return { ...result, status: "invalid" };
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ...result, status: "invalid" }; }
    if (!parsed || typeof parsed !== "object" || !("entries" in parsed) ||
      !Array.isArray((parsed as { entries: unknown }).entries)) return { ...result, status: "invalid" };
    const root = journalPath.replace(/\/(?:meta|_meta)\/_journal\.json$/, "");
    const rows = (parsed as { entries: unknown[] }).entries;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !("when" in row) || !("tag" in row) ||
        typeof row.when !== "number" || !Number.isSafeInteger(row.when) || typeof row.tag !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(row.tag)) {
        return { ...result, status: "invalid" };
      }
      const path = root + "/" + row.tag + ".sql";
      const sql = await context.readText(path);
      if (sql === null) return { ...result, status: "invalid" };
      entries.push({ identifier: String(row.when), checksum: sha256(sql), path });
    }
  } else if (framework === "prisma") {
    const files = context.files.filter((path) => /(?:^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/.test(path));
    const roots = new Set(files.map((path) => path.slice(0, path.indexOf("prisma/migrations/"))));
    if (roots.size > 1) return { ...result, status: "ambiguous" };
    for (const path of files) {
      const sql = await context.readText(path);
      if (sql === null) return { ...result, status: "invalid" };
      entries.push({ identifier: path.match(/prisma\/migrations\/([^/]+)\/migration\.sql$/)![1]!, checksum: sha256(sql), path });
    }
  } else {
    const files = context.files.filter((path) => /(?:^|\/)supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(path));
    const roots = new Set(files.map((path) => path.slice(0, path.indexOf("supabase/migrations/"))));
    if (roots.size > 1) return { ...result, status: "ambiguous" };
    for (const path of files) {
      entries.push({ identifier: path.match(/supabase\/migrations\/(\d{14})_[^/]+\.sql$/)![1]!, path });
    }
  }
  if (entries.length === 0) return result;
  if (entries.length > 1000) return { ...result, status: "ambiguous" };
  if (new Set(entries.map((entry) => entry.identifier)).size !== entries.length) return { ...result, status: "invalid" };
  return { framework, status: "complete", entries };
}
