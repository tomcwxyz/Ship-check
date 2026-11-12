import { describe, expect, it } from "vitest";
import { parseAnthropicTable, parseOpenAIModels, fetchOpenAIFeed } from "./technologyFeeds";

describe("provider-specific model retirement feeds", () => {
  it("matches only exact shutdown_date model records", () => {
    const notes = parseOpenAIModels({data: [
      {id: "gpt-5", shutdown_date: "2026-12-11"},
      {id: "gpt-6", shutdown_date: null},
      {id: "gpt-invalid", shutdown_date: "tomorrow"}
    ]}, "2026-11-12T20:00:00Z");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ componentId: "gpt-5", effectiveDate: "2026-12-11" });
  });

  it("does not falsely treat Anthropic active support floors as retirement dates", () => {
    const html = '<table><tr><td>claude-sonnet-4-5-20250929</td><td>Active</td><td>N/A</td><td>Not sooner than September 29, 2026</td></tr>' +
      '<tr><td><code>claude-opus-4-1-20250805</code></td><td>Retired</td><td>June 5, 2026</td><td>August 5, 2026</td></tr>' +
      '<tr><td>claude-opus-4-8</td><td>Active</td><td>N/A</td><td>Not sooner than May 28, 2027</td></tr></table>';
    const notes = parseAnthropicTable(html, "2026-11-12T20:00:00Z");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.componentId).toBe("claude-opus-4-1-20250805");
  });

  it("fails closed on upstream markup changes", () => {
    expect(() => parseAnthropicTable("<main>rendered without a table</main>", "2026-11-12T20:00:00Z")).toThrow(/layout/);
  });

  it("never includes the API key in a model notice or error", async () => {
    const key = "test-key-do-not-log";
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer " + key);
      return Response.json({ data: [{ id: "gpt-5", shutdown_date: "2026-12-11" }] });
    };
    const feed = await fetchOpenAIFeed(key, "2026-11-12T20:00:00Z", fetcher as typeof fetch);
    expect(JSON.stringify(feed)).not.toContain(key);
  });
});
