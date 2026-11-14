import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  affectedByWordfenceRanges, parseWordfenceChange,
  verifyWordfenceSignature, wordfenceNoticeForComponent
} from "./cmsWordfence";

const now = "2026-11-13T12:00:00.000Z";
const advisoryId = "848ccbdc-c6f1-480f-a272-cd459e706713";
const payload = {
  vulnerabilities: {
    created: [{
      id: advisoryId, title: "Example plugin access bypass",
      published: "2026-11-12T10:00:00.000Z",
      software: [{
        type: "plugin",slug: "example-plugin",
        affected_versions: {
          "<= 1.2.3": {from_version:"*",from_inclusive:true,to_version:"1.2.3",to_inclusive:true}
        }
      }]
    }],
    replaced: [], deleted: []
  }
};

describe("Wordfence signed intelligence", () => {
  it("uses byte-exact HMAC and rejects tampered input", () => {
    const raw=JSON.stringify(payload), secret="a".repeat(40);
    const signature=createHmac("sha256",secret).update(raw).digest("hex");
    expect(verifyWordfenceSignature(raw,signature,secret)).toBe(true);
    expect(verifyWordfenceSignature(raw+" ",signature,secret)).toBe(false);
    expect(verifyWordfenceSignature(raw,signature,"short")).toBe(false);
    expect(verifyWordfenceSignature(raw,"bad",secret)).toBe(false);
  });
  it("normalises bounded, software-specific advisories without storing full vendor payload", () => {
    const change=parseWordfenceChange(payload,now);
    expect(change.upserts).toHaveLength(1);
    expect(change.upserts[0]).toMatchObject({
      advisoryId, componentKind:"wordpress-plugin", componentId:"example-plugin",
      sourceUrl:"https://www.wordfence.com/threat-intel/vulnerabilities/id/"+advisoryId
    });
    expect(JSON.stringify(change)).not.toContain("description");
  });
  it("uses exact numeric ranges and refuses uncertain prerelease comparison", () => {
    const range=parseWordfenceChange(payload,now).upserts[0]!.ranges;
    expect(affectedByWordfenceRanges("1.2.3",range)).toBe(true);
    expect(affectedByWordfenceRanges("1.2.4",range)).toBe(false);
    expect(affectedByWordfenceRanges("1.2.3-beta",range)).toBeNull();
    expect(affectedByWordfenceRanges(undefined,range)).toBeNull();
  });
  it("requires verification for unknown version and does not claim an unaffected version", () => {
    const record=parseWordfenceChange(payload,now).upserts[0]!;
    const base={kind:"wordpress-plugin" as const,id:"example-plugin",evidence:"source-declared" as const};
    expect(wordfenceNoticeForComponent(record,base,now)?.affectedVersions).toBeUndefined();
    expect(wordfenceNoticeForComponent(record,{...base,version:"1.2.3"},now)?.affectedVersions).toEqual(["1.2.3"]);
    expect(wordfenceNoticeForComponent(record,{...base,version:"1.2.4"},now)).toBeNull();
  });
  it("accepts authenticated deletion and rejects excessive payloads", () => {
    expect(parseWordfenceChange({vulnerabilities:{created:[],replaced:[],deleted:[advisoryId]}},now).deletions).toEqual([advisoryId]);
    expect(() => parseWordfenceChange({vulnerabilities:{created:Array(51).fill({}),replaced:[],deleted:[]}},now)).toThrow(/large/);
  });
});
