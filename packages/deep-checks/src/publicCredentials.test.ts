import { describe, expect, it } from "vitest";
import { isPublicSupabaseMatch } from "./publicCredentials.js";

const token = (role: string) => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url")}.testsignature`;
const source = (value: string) => `import { createClient } from '@supabase/supabase-js';\nconst url = 'https://example.supabase.co';\nconst key = '${value}';\nexport const client = createClient(url, key);`;
describe("public key classification", () => {
  it("recognises a directly used anonymous client key without trusting its variable name", () => {
    expect(isPublicSupabaseMatch(source(token("anon")), 3, "jwt")).toBe(true);
  });
  it("keeps privileged and unknown credentials flagged", () => {
    for (const value of [token("service_role"), token("authenticated"), "sb_secret_test", "invalid"]) {
      expect(isPublicSupabaseMatch(source(value), 3, "jwt")).toBe(false);
    }
  });
  it("does not suppress another rule or a match on another line", () => {
    expect(isPublicSupabaseMatch(source(token("anon")), 3, "private-key")).toBe(false);
    expect(isPublicSupabaseMatch(source(token("anon")), 2, "jwt")).toBe(false);
    expect(isPublicSupabaseMatch(source(token("anon")).replace("createClient(url, key)", "createClient(url, other)"), 3, "jwt")).toBe(false);
  });
  it("recognises publishable keys but rejects mixed assignments", () => {
    expect(isPublicSupabaseMatch(source("sb_publishable_test"), 3, "generic-api-key")).toBe(true);
    expect(isPublicSupabaseMatch(source(token("anon")).replace("const key =", "const other = 'private'; const key ="), 3, "jwt")).toBe(false);
  });
});
