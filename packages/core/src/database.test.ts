import { describe, expect, it } from "vitest";
import { scanDatabaseMetadata, type DatabaseCheckDefinition } from "./database.js";
import { DatabaseMetadataSnapshotSchema } from "@ship-check/schemas/databaseEvidence";

const snapshot = DatabaseMetadataSnapshotSchema.parse({
  schemaVersion: "0.1",
  source: {
    schemaVersion: "0.1",
    id: "database:example",
    type: "database",
    provider: "postgres",
    label: "Postgres database",
    acquisition: "remote-readonly",
    executionLocation: "user-device",
    capabilities: ["database-metadata"],
    ephemeral: true,
    acquiredAt: "2026-09-18T14:30:00.000Z"
  },
  engine: "postgres",
  platform: "postgres",
  inspection: {
    readOnlyTransaction: true,
    fixedMetadataQueriesOnly: true,
    rowDataRead: false,
    tableLimit: 1000,
    tablesTruncated: false,
    inspectorSuperuser: false,
    inspectorBypassRls: false
  },
  tables: [{
    schema: "public",
    name: "sensitive_case_notes",
    rlsEnabled: true,
    forceRls: false,
    policyCount: 2,
    grants: []
  }],
  acquiredAt: "2026-09-18T14:30:00.000Z"
});

describe("database metadata scan runner", () => {
  it("marks source checks not assessed and runs database-metadata checks", async () => {
    const check: DatabaseCheckDefinition = {
      id: "database.test-metadata",
      pack: "production-ready",
      title: "test",
      description: "test",
      coverage: [{ area: "database", status: "assessed" }],
      async run() {
        return {
          observations: [{
            id: "database.test-metadata:verified",
            checkId: "database.test-metadata",
            pack: "production-ready",
            area: "database",
            kind: "verified-control",
            title: "Metadata available",
            summary: "Bounded metadata was available.",
            evidence: [{ kind: "configuration", detail: "Metadata contract verified." }]
          }]
        };
      }
    };

    const report = await scanDatabaseMetadata(
      snapshot,
      [{ id: "production.source-only", pack: "production-ready" }],
      [check],
      "0.0.0-test"
    );

    expect(report.project.snapshot?.source.type).toBe("database");
    expect(report.ruleset).toMatchObject({
      algorithm: "sha256",
      scope: "check-ruleset-v1",
      checkCount: 2
    });
    expect(report.checks.find((item) => item.checkId === "production.source-only")).toMatchObject({
      status: "not-assessed",
      missingEvidence: ["source-files"]
    });
    expect(report.checks.find((item) => item.checkId === "database.test-metadata")?.status).toBe("passed");
    expect(report.coverage.find((item) => item.area === "database")?.status).toBe("assessed");
  });

  it("does not persist the raw database metadata snapshot in the report", async () => {
    const check: DatabaseCheckDefinition = {
      id: "database.metadata-boundary",
      pack: "production-ready",
      title: "test",
      description: "test",
      async run() {
        return [];
      }
    };

    const report = await scanDatabaseMetadata(snapshot, [], [check], "0.0.0-test");
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("sensitive_case_notes");
    expect(serialized).not.toContain("policyCount");
    expect(serialized).not.toContain("grants");
    expect(serialized).not.toContain("tableLimit");
    expect(serialized).not.toContain("inspectorSuperuser");
  });

  it("rejects a metadata snapshot that does not carry a database evidence source", () => {
    expect(() => DatabaseMetadataSnapshotSchema.parse({
      ...snapshot,
      source: {
        ...snapshot.source,
        type: "source",
        capabilities: ["source-files"]
      }
    })).toThrow(/database evidence source|database-metadata/);
  });

  it("rejects table metadata that exceeds its declared bounded inventory", () => {
    expect(() => DatabaseMetadataSnapshotSchema.parse({
      ...snapshot,
      inspection: { ...snapshot.inspection, tableLimit: 1 },
      tables: [snapshot.tables[0], { ...snapshot.tables[0], name: "another_table" }]
    })).toThrow(/declared inspection limit/);
  });
});
