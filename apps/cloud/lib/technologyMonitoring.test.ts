import { describe, expect, it } from "vitest";
import { parseComponents } from "./technologyMonitoring";

describe("explicit Cloud inventory consent", () => {
  it("accepts a bounded source-declared component", () => {
    expect(parseComponents([{ kind: "ai-model", id: "gpt-5" }])).toEqual([
      { kind: "ai-model", id: "gpt-5", evidence: "source-declared" }
    ]);
  });
  it("rejects impersonated runtime verification and arbitrary data", () => {
    expect(() => parseComponents([{ kind: "ai-model", id: "gpt-5", evidence: "runtime-verified" }])).toThrow();
    expect(() => parseComponents([{ kind: "ai-model", id: "gpt-5", apiKey: "secret" }])).toThrow();
    expect(() => parseComponents([{ kind: "ai-model", id: "gpt-5" }, { kind: "ai-model", id: "gpt-5" }])).toThrow();
    expect(() => parseComponents([])).toThrow();
    expect(() => parseComponents(Array.from({length: 51}, (_, i) => ({kind: "ai-model", id: "gpt-" + i})))).toThrow();
  });
});
