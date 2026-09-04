import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanProject } from "@ship-check/core";
import { checksForPacks } from "../src/index.js";

const risky = fileURLToPath(new URL("../../../test-fixtures/risky-next/", import.meta.url));
const safe = fileURLToPath(new URL("../../../test-fixtures/safe-next/", import.meta.url));

describe("built-in secure-build checks", () => {
  it("finds concrete alpha risks in the risky fixture", async () => {
    const report = await scanProject(risky, checksForPacks(["secure-build"]));
    const ids = report.findings.map((finding) => finding.checkId);
    expect(ids).toContain("secure.tracked-env-file");
    expect(ids).toContain("secure.paid-endpoint-abuse-control");
    expect(ids).toContain("secure.wildcard-cors");
    expect(ids).toContain("secure.public-secret-env-name");
  });

  it("does not invent the risky fixture findings for the guarded fixture", async () => {
    const report = await scanProject(safe, checksForPacks(["secure-build"]));
    const ids = report.findings.map((finding) => finding.checkId);
    expect(ids).not.toContain("secure.paid-endpoint-abuse-control");
    expect(ids).not.toContain("secure.wildcard-cors");
    expect(ids).not.toContain("secure.public-secret-env-name");
  });
});

describe("production-ready checks", () => {
  it("distinguishes an unlocked package graph from a locked one", async () => {
    const riskyReport = await scanProject(risky, checksForPacks(["production-ready"]));
    const safeReport = await scanProject(safe, checksForPacks(["production-ready"]));
    expect(riskyReport.findings.some((finding) => finding.checkId === "production.package-lock-discipline")).toBe(true);
    expect(safeReport.findings.some((finding) => finding.checkId === "production.package-lock-discipline")).toBe(false);
  });
});
