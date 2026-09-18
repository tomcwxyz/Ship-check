import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseGithubRepository,
  prepareRepositorySource,
  sourceExecutionContextFromEnvironment
} from "./repositorySource.js";

describe("parseGithubRepository", () => {
  it("accepts owner/repository shorthand", () => {
    expect(parseGithubRepository("openai/openai")).toEqual({
      cloneUrl: "https://github.com/openai/openai.git",
      displayName: "https://github.com/openai/openai",
    });
  });

  it("accepts an https GitHub repository URL", () => {
    expect(parseGithubRepository("https://github.com/openai/openai.git")).toEqual({
      cloneUrl: "https://github.com/openai/openai.git",
      displayName: "https://github.com/openai/openai",
    });
  });

  it("accepts the common GitHub SSH form", () => {
    expect(parseGithubRepository("git@github.com:openai/openai.git")).toEqual({
      cloneUrl: "git@github.com:openai/openai.git",
      displayName: "https://github.com/openai/openai",
    });
  });

  it("does not treat another host as a GitHub source", () => {
    expect(parseGithubRepository("https://example.com/openai/openai")).toBeNull();
  });

  it("rejects credentials embedded in an https URL", () => {
    expect(() =>
      parseGithubRepository("https://token@github.com/openai/openai"),
    ).toThrow(/credentials or access tokens/i);
  });

  it("rejects non-repository GitHub paths", () => {
    expect(() =>
      parseGithubRepository("https://github.com/openai/openai/tree/main"),
    ).toThrow(/repository URL/i);
  });
});


describe("CI source provenance", () => {
  it("reads an explicit CI execution context without GitHub-specific inference", () => {
    expect(sourceExecutionContextFromEnvironment({
      SHIP_CHECK_EXECUTION_LOCATION: "ci-runner",
      SHIP_CHECK_SOURCE_ID: "github:good-ship/example",
      SHIP_CHECK_SOURCE_PROVIDER: "github",
      SHIP_CHECK_SOURCE_LABEL: "good-ship/example",
      SHIP_CHECK_SOURCE_REF: "feature/example"
    })).toEqual({
      id: "github:good-ship/example",
      provider: "github",
      label: "good-ship/example",
      ref: "feature/example"
    });
  });

  it("leaves ordinary local execution unchanged", () => {
    expect(sourceExecutionContextFromEnvironment({})).toBeUndefined();
  });

  it("rejects incomplete CI provenance rather than guessing", () => {
    expect(() => sourceExecutionContextFromEnvironment({
      SHIP_CHECK_EXECUTION_LOCATION: "ci-runner",
      SHIP_CHECK_SOURCE_PROVIDER: "github"
    })).toThrow(/requires SHIP_CHECK_SOURCE_PROVIDER and SHIP_CHECK_SOURCE_LABEL/);
  });

  it("records a checked-out workspace as CI evidence when context is supplied", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ship-check-ci-source-"));
    try {
      const source = await prepareRepositorySource(root, {
        executionContext: {
          id: "github:good-ship/example",
          provider: "github",
          label: "good-ship/example",
          ref: "main"
        }
      });
      expect(source.kind).toBe("local");
      expect(source.displayName).toBe("good-ship/example");
      expect(source.sourceInput).toMatchObject({
        id: "github:good-ship/example",
        type: "source",
        provider: "github",
        label: "good-ship/example",
        acquisition: "ci",
        executionLocation: "ci-runner",
        capabilities: ["source-files", "ci-context"],
        ephemeral: true,
        ref: "main"
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
