import { randomUUID } from "node:crypto";
import {
  ProjectEvidenceSourceSchema,
  ProjectSnapshotSchema,
  type InventorySource,
  type ProjectEvidenceCapability,
  type ProjectEvidenceSource,
  type ProjectEvidenceSourceInput,
  type ProjectSnapshot
} from "@ship-check/schemas";

function uniqueCapabilities(capabilities: ProjectEvidenceCapability[]): ProjectEvidenceCapability[] {
  return [...new Set(capabilities)];
}

export function resolveProjectEvidenceSource(options: {
  root: string;
  gitRepository: boolean;
  input?: ProjectEvidenceSourceInput;
}): ProjectEvidenceSource {
  const { root, gitRepository, input = {} } = options;
  const capabilities = uniqueCapabilities([
    ...(input.capabilities ?? ["source-files"]),
    ...(gitRepository ? (["git-history"] as const) : [])
  ]);

  return ProjectEvidenceSourceSchema.parse({
    schemaVersion: "0.1",
    id: input.id ?? `${input.provider ?? "local"}:${input.label ?? root}`,
    type: input.type ?? "source",
    provider: input.provider ?? "local",
    label: input.label ?? root,
    acquisition: input.acquisition ?? "local",
    executionLocation: input.executionLocation ?? "user-device",
    capabilities,
    ephemeral: input.ephemeral ?? false,
    acquiredAt: input.acquiredAt ?? new Date().toISOString(),
    ...(input.ref ? { ref: input.ref } : {})
  });
}

export function createProjectSnapshot(options: {
  source: ProjectEvidenceSource;
  inventorySource: InventorySource;
  fileCount: number;
  commit?: string;
}): ProjectSnapshot {
  return ProjectSnapshotSchema.parse({
    schemaVersion: "0.1",
    id: randomUUID(),
    source: options.source,
    inventory: {
      source: options.inventorySource,
      fileCount: options.fileCount,
      ...(options.commit ? { commit: options.commit } : {})
    }
  });
}
