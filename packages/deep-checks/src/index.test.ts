import { describe, expect, it } from "vitest";
import { parseGitleaksReport, parseOsvReport } from "./index.js";

describe("Gitleaks adapter", () => {
  it("converts findings without carrying the matched secret into Ship Check evidence", () => {
    const secret = "super-secret-value-that-must-not-escape";
    const findings = parseGitleaksReport([
      {
        Description: "Generic API Key",
        StartLine: 14,
        File: "/tmp/ship-check/source/apps/api/config.ts",
        RuleID: "generic-api-key",
        Fingerprint: "fixture:apps/api/config.ts:generic-api-key:14",
        Secret: secret,
        Match: `token=${secret}`
      }
    ], "/tmp/ship-check/source", "8.30.1");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: "secure.secret-pattern",
      severity: "high",
      evidence: [{ path: "apps/api/config.ts", line: 14 }]
    });
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(JSON.stringify(findings)).toContain("generic-api-key");
  });
});

describe("OSV adapter", () => {
  it("groups known vulnerabilities by affected dependency without source content", () => {
    const findings = parseOsvReport({
      results: [{
        source: { path: "/tmp/ship-check/manifests/pnpm-lock.yaml", type: "lockfile" },
        packages: [{
          package: { name: "example-lib", version: "1.2.3", ecosystem: "npm" },
          vulnerabilities: [
            { id: "GHSA-example-1", aliases: ["CVE-2099-0001"], database_specific: { severity: "HIGH" } },
            { id: "GHSA-example-2", database_specific: { severity: "MODERATE" } }
          ]
        }]
      }]
    }, "/tmp/ship-check/manifests", "2.5.1");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: "production.osv-vulnerabilities",
      severity: "high",
      evidence: [{ path: "pnpm-lock.yaml" }]
    });
    expect(findings[0]?.summary).toContain("example-lib 1.2.3");
    expect(findings[0]?.summary).toContain("GHSA-example-1");
  });

  it("uses a conservative medium severity when upstream JSON has no explicit severity label", () => {
    const findings = parseOsvReport({
      results: [{
        source: { path: "package-lock.json" },
        packages: [{
          package: { name: "quiet-lib", version: "0.1.0", ecosystem: "npm" },
          vulnerabilities: [{ id: "OSV-UNKNOWN" }]
        }]
      }]
    }, "/tmp/manifests", "2.5.1");

    expect(findings[0]?.severity).toBe("medium");
  });
});
