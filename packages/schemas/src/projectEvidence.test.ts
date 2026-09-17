import { describe, expect, it } from "vitest";
import { ProjectEvidenceSourceSchema, ProjectSnapshotSchema } from "./index.js";

describe("ProjectEvidenceSourceSchema", () => {
  it("accepts a hosted-builder source without making the provider list closed", () => {
    const source = ProjectEvidenceSourceSchema.parse({
      schemaVersion: "0.1",
      id: "lovable:project-123",
      type: "source",
      provider: "lovable",
      label: "Community directory",
      acquisition: "remote-readonly",
      executionLocation: "external-platform",
      capabilities: ["source-files", "platform-metadata"],
      ephemeral: true,
      acquiredAt: "2026-09-17T20:00:00.000Z"
    });

    expect(source.provider).toBe("lovable");
    expect(source.capabilities).toContain("source-files");
  });

  it("rejects malformed provider IDs and empty capabilities", () => {
    expect(() => ProjectEvidenceSourceSchema.parse({
      schemaVersion: "0.1",
      id: "bad",
      type: "source",
      provider: "Not Valid",
      label: "Bad source",
      acquisition: "local",
      executionLocation: "user-device",
      capabilities: [],
      acquiredAt: "2026-09-17T20:00:00.000Z"
    })).toThrow();
  });
});

describe("ProjectSnapshotSchema", () => {
  it("keeps acquisition provenance separate from inventory metadata", () => {
    const snapshot = ProjectSnapshotSchema.parse({
      schemaVersion: "0.1",
      id: "4d4c819b-4bc0-4cc2-a10f-8e41698520b1",
      source: {
        schemaVersion: "0.1",
        id: "upload:community-directory",
        type: "source",
        provider: "upload",
        label: "community-directory.zip",
        acquisition: "uploaded-snapshot",
        executionLocation: "ship-check-managed",
        capabilities: ["source-files", "dependency-manifests"],
        ephemeral: true,
        acquiredAt: "2026-09-17T20:00:00.000Z"
      },
      inventory: {
        source: "filesystem",
        fileCount: 42
      }
    });

    expect(snapshot.source.acquisition).toBe("uploaded-snapshot");
    expect(snapshot.inventory.source).toBe("filesystem");
    expect(snapshot.inventory.fileCount).toBe(42);
  });
});
