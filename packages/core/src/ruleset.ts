import { createHash } from "node:crypto";
import {
  RulesetProvenanceSchema,
  type CheckPack,
  type CheckVersion,
  type RulesetProvenance
} from "@ship-check/schemas";

const DEFAULT_CHECK_VERSION: CheckVersion = "1";

export type RulesetCheckDescriptor = {
  id: string;
  version?: CheckVersion;
  pack: CheckPack;
};

export function createRulesetProvenance(
  checks: RulesetCheckDescriptor[]
): RulesetProvenance {
  const descriptors = checks
    .map((check) => ({
      checkId: check.id,
      checkVersion: check.version ?? DEFAULT_CHECK_VERSION,
      pack: check.pack
    }))
    .sort((left, right) =>
      `${left.checkId}@${left.checkVersion}:${left.pack}`.localeCompare(
        `${right.checkId}@${right.checkVersion}:${right.pack}`
      )
    );

  return RulesetProvenanceSchema.parse({
    algorithm: "sha256",
    scope: "check-ruleset-v1",
    value: createHash("sha256")
      .update(JSON.stringify(descriptors))
      .digest("hex"),
    checkCount: descriptors.length
  });
}
