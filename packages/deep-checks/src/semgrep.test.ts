import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseSemgrepReport,
  semgrepLocalCheck,
  semgrepVersionSupported
} from "./semgrep.js";
import {
  SEMGREP_RULESET_SHA256,
  SEMGREP_RULESET_VERSION,
  SEMGREP_RULESET_YAML
} from "./semgrepRules.js";

describe("local Semgrep ruleset provenance", () => {
  it("matches the pinned SHA-256 and rule version", () => {
    const actual = createHash("sha256").update(SEMGREP_RULESET_YAML, "utf8").digest("hex");
    expect(actual).toBe(SEMGREP_RULESET_SHA256);
    expect(semgrepLocalCheck.version).toBe(SEMGREP_RULESET_VERSION);
    expect(semgrepLocalCheck.id).toBe("secure.semgrep-local-rules");
  });

  it("accepts only the validated Semgrep 1.176 patch line", () => {
    expect(semgrepVersionSupported("1.176.0")).toBe(true);
    expect(semgrepVersionSupported("semgrep 1.176.4")).toBe(true);
    expect(semgrepVersionSupported("1.175.9")).toBe(false);
    expect(semgrepVersionSupported("1.177.0")).toBe(false);
    expect(semgrepVersionSupported("2.0.0")).toBe(false);
    expect(semgrepVersionSupported("unknown")).toBe(false);
  });
});

describe("Semgrep JSON report adapter", () => {
  it("creates canonical findings without retaining matched source text", () => {
    const mirror = "/tmp/ship-check-semgrep/source";
    const raw = {
      results: [
        {
          check_id: "ship-check.node.tls-verification-disabled",
          path: `${mirror}/lib/client.ts`,
          start: { line: 17, col: 5 },
          end: { line: 17, col: 34 },
          extra: {
            message: "TLS certificate verification is explicitly disabled.",
            severity: "ERROR",
            lines: "rejectUnauthorized: false"
          }
        },
        {
          check_id: "ship-check.node.jwt-expiry-verification-disabled",
          path: `${mirror}/lib/token.ts`,
          start: { line: 8, col: 3 },
          extra: {
            message: "JWT expiry verification is explicitly disabled.",
            severity: "ERROR",
            lines: "ignoreExpiration: true"
          }
        }
      ]
    };

    const findings = parseSemgrepReport(raw, mirror, "1.176.0");

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      checkId: "secure.semgrep-local-rules",
      severity: "high",
      title: "TLS certificate verification is disabled"
    });
    expect(findings[0]?.evidence[0]).toMatchObject({
      path: "lib/client.ts",
      line: 17
    });
    expect(findings[1]?.title).toBe("JWT expiry verification is disabled");
    const serialised = JSON.stringify(findings);
    expect(serialised).not.toContain("rejectUnauthorized: false");
    expect(serialised).not.toContain("ignoreExpiration: true");
    expect(serialised).toContain("matched source omitted");
    expect(serialised).toContain(SEMGREP_RULESET_SHA256.slice(0, 12));
  });

  it("ignores results that do not belong to the embedded Ship Check ruleset namespace", () => {
    const findings = parseSemgrepReport({
      results: [{
        check_id: "third-party.remote-rule",
        path: "/tmp/source/app.ts",
        start: { line: 1 },
        extra: { message: "Remote rule", severity: "ERROR" }
      }]
    }, "/tmp/source", "1.176.0");

    expect(findings).toEqual([]);
  });

  it("uses conservative severity mapping for Semgrep output", () => {
    const findings = parseSemgrepReport({
      results: [{
        check_id: "ship-check.unknown-local-rule",
        path: "/tmp/source/app.ts",
        start: { line: 3 },
        extra: { message: "Review this", severity: "WARNING" }
      }]
    }, "/tmp/source", "1.176.0");

    expect(findings[0]?.severity).toBe("medium");
  });
});
