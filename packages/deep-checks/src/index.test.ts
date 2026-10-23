import { describe, expect, it } from "vitest";
import { cvssV3Score, parseGitleaksHistoryReport, parseGitleaksReport, parseOsvReport } from "./index.js";

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


  it("keeps Git-history exposure separate and never carries the secret value", () => {
    const secret = "history-secret-that-must-not-escape";
    const findings = parseGitleaksHistoryReport([
      {
        Description: "OpenAI API Key",
        StartLine: 7,
        File: "src/old-config.ts",
        RuleID: "openai-api-key",
        Fingerprint: "abc123:src/old-config.ts:openai-api-key:7",
        Commit: "0123456789abcdef0123456789abcdef01234567",
        Secret: secret,
        Match: `key=${secret}`
      }
    ], "8.30.1");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: "secure.secret-history",
      severity: "high",
      evidence: [{ path: "src/old-config.ts", line: 7 }]
    });
    expect(JSON.stringify(findings)).toContain("0123456789ab");
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(findings[0]?.remediation.verify).toContain("revoked");
  });
});

describe("OSV adapter", () => {
  it("prioritises explicit MAL advisory IDs as malicious-package findings", () => {
    const findings = parseOsvReport({ results: [{
      source: { path: "package-lock.json" },
      packages: [{ package: { name: "untrusted-example", version: "1.0.0", ecosystem: "npm" },
        vulnerabilities: [{ id: "MAL-2026-12345" }] }]
    }] }, "/tmp/manifests", "2.5.1");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain("malicious");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.remediation.fix).toContain("isolate");
    expect(findings[0]?.remediation.verify).toContain("does not prove");
  });
  it("does not call an unknown advisory malicious without an explicit MAL identifier", () => {
    const findings = parseOsvReport({ results: [{
      source: { path: "pnpm-lock.yaml" },
      packages: [{ package: { name: "unknown-example", version: "1.0.0", ecosystem: "npm" },
        vulnerabilities: [{ id: "GHSA-example-2026" }] }]
    }] }, "/tmp/manifests", "2.5.1");
    expect(findings[0]?.title).toContain("vulnerable");
    expect(findings[0]?.severity).toBe("info");
  });

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

  it("consolidates the same affected package/version across manifests and advisory aliases", () => {
    const findings = parseOsvReport({
      results: [
        {
          source: { path: "/tmp/manifests/package-lock.json" },
          packages: [{
            package: { name: "shared-lib", version: "4.5.6", ecosystem: "npm" },
            vulnerabilities: [{
              id: "GHSA-shared-1",
              aliases: ["CVE-2099-1234"],
              database_specific: { severity: "HIGH" }
            }]
          }]
        },
        {
          source: { path: "/tmp/manifests/pnpm-lock.yaml" },
          packages: [{
            package: { name: "shared-lib", version: "4.5.6", ecosystem: "npm" },
            vulnerabilities: [{
              id: "GHSA-shared-1",
              aliases: ["CVE-2099-1234"],
              database_specific: { severity: "HIGH" }
            }]
          }]
        }
      ]
    }, "/tmp/manifests", "2.5.1");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.map((item) => item.path)).toEqual([
      "package-lock.json",
      "pnpm-lock.yaml"
    ]);
    expect(findings[0]?.summary).toContain("one affected package/version");
    expect(findings[0]?.summary).toContain("1 distinct OSV vulnerability record");
  });

  it("leaves unknown upstream severity unrated instead of manufacturing a medium risk", () => {
    const findings = parseOsvReport({
      results: [{
        source: { path: "package-lock.json" },
        packages: [{
          package: { name: "quiet-lib", version: "0.1.0", ecosystem: "npm" },
          vulnerabilities: [{ id: "OSV-UNKNOWN" }]
        }]
      }]
    }, "/tmp/manifests", "2.5.1");

    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.summary).toContain("could not be established");
  });
  it("derives a high CVSS 3.1 rating from the advisory vector", () => {
    expect(cvssV3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    const findings = parseOsvReport({
      results: [{
        source: { path: "pnpm-lock.yaml" },
        packages: [{
          package: { name: "risky-dependency", version: "2.0.0", ecosystem: "npm" },
          vulnerabilities: [{
            id: "GHSA-example-3",
            severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
            affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "2.0.1" }] }] }]
          }]
        }]
      }]
    }, "/tmp/manifests", "2.5.1");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.summary).toContain("2.0.1");
    expect(findings[0]?.remediation.fix).toContain("2.0.1");
  });

});
