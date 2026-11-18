import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "./validation.mjs";

test("accepts only plain public GitHub repository URLs", () => {
  assert.equal(parseSource("tomcwxyz/Ship-check", "github").target, "https://github.com/tomcwxyz/Ship-check");
  assert.equal(parseSource("https://github.com/tomcwxyz/Ship-check", "github").label, "tomcwxyz/Ship-check");
  for (const source of ["git@github.com:owner/repo", "https://evil.test/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b?token=secret", "https://github.com/a/../b"]) {
    assert.throws(() => parseSource(source, "github"));
  }
});
test("rejects internal website and unsafe schemes", () => {
  for (const source of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://service.internal", "https://example.com:8443", "https://user:pass@example.com"]) {
    assert.throws(() => parseSource(source, "site"), source);
  }
  assert.equal(parseSource("https://example.org/", "site").target, "https://example.org/");
  for(const url of ["https://169.254.169.254/","https://[::1]/","https://example.internal/","https://metadata.google.internal/","https://example.org:8443/","ftp://example.org"]) assert.throws(()=>parseSource(url,"site"));
});
