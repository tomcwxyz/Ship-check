import { describe, expect, it } from "vitest";
import { matchIntelligenceNotices, type IntelligenceNotice } from "./intelligence.js";

const now = "2026-11-12T10:00:00.000Z";
const modelNotice: IntelligenceNotice = {
  id: "anthropic-sonnet-45-2026-09-30",
  kind: "retirement",
  componentKind: "ai-model",
  componentId: "claude-sonnet-4-5-20250929",
  effectiveDate: "2026-11-30",
  publishedAt: "2026-09-30T12:00:00.000Z",
  fetchedAt: now,
  sourceUrl: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  summary: "Anthropic has scheduled retirement of Sonnet 4.5.",
  replacement: "claude-sonnet-5-5"
};

describe("Cloud intelligence matching", () => {
  it("creates a deduplicated upcoming model notice without claiming runtime use", () => {
    const input = {
      projectIdentity: "opaque-project-1",
      components: [{ kind: "ai-model" as const, id: "claude-sonnet-4-5-20250929", evidence: "source-declared" as const }],
      notices: [modelNotice, modelNotice],
      now
    };
    const matches = matchIntelligenceNotices(input);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      status: "urgent",
      scope: "source-only",
      daysRemaining: 18,
      freshness: "current",
      replacement: "claude-sonnet-5-5"
    });
    expect(matchIntelligenceNotices(input)[0]?.identity).toEqual(matches[0]?.identity);
    expect(matchIntelligenceNotices({ ...input, now: "2026-12-01T10:00:00Z" })[0]?.status).toBe("past-due");
  });

  it("distinguishes vulnerable exact CMS versions from unknown and unaffected versions", () => {
    const notice: IntelligenceNotice = {
      id: "WP-1234",
      kind: "vulnerability",
      componentKind: "wordpress-plugin",
      componentId: "example",
      affectedVersions: ["1.0.0", "1.0.1"],
      publishedAt: "2026-11-10T09:00:00Z",
      fetchedAt: now,
      sourceUrl: "https://example.org/security/WP-1234",
      summary: "Example plugin issue."
    };
    const components = [
      { kind: "wordpress-plugin" as const, id: "example", version: "1.0.1", evidence: "runtime-verified" as const },
      { kind: "wordpress-plugin" as const, id: "example", version: "1.0.2", evidence: "runtime-verified" as const },
      { kind: "wordpress-plugin" as const, id: "example", evidence: "source-declared" as const }
    ];
    const results = matchIntelligenceNotices({ projectIdentity: "p", components, notices: [notice], now });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status)).toContain("urgent");
    expect(results.map((r) => r.status)).toContain("needs-verification");
    expect(results.find((r) => r.status === "urgent")?.scope).toBe("runtime-confirmed");
  });

  it("keeps stale feeds explicitly stale and ignores future notices and unrelated components", () => {
    const matches = matchIntelligenceNotices({
      projectIdentity: "p",
      components: [{ kind: "ai-model", id: "claude-sonnet-4-5-20250929", evidence: "source-declared" }],
      notices: [
        { ...modelNotice, fetchedAt: "2026-10-01T00:00:00Z" },
        { ...modelNotice, id: "future", publishedAt: "2026-12-01T00:00:00Z" },
        { ...modelNotice, id: "other", componentId: "claude-sonnet-5-5" }
      ],
      now
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.freshness).toBe("stale");
  });

  it("does not match unknown semantic-version ranges as exact versions", () => {
    const results = matchIntelligenceNotices({
      projectIdentity: "p",
      components: [{ kind: "drupal-package", id: "drupal/token", version: "1.15.0", evidence: "source-declared" }],
      notices: [{
        id: "SA-CONTRIB-000",
        kind: "vulnerability",
        componentKind: "drupal-package",
        componentId: "drupal/token",
        affectedVersions: ["<1.16.0"],
        publishedAt: now,
        fetchedAt: now,
        sourceUrl: "https://www.drupal.org/security",
        summary: "Example affected version range."
      }],
      now
    });
    expect(results).toEqual([]);
  });
});
