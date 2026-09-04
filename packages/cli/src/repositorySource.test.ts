import { describe, expect, it } from "vitest";
import { parseGithubRepository } from "./repositorySource.js";

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
