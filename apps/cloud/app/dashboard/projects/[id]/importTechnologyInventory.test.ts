import { describe, expect, it } from "vitest";
import { importTechnologyInventory } from "./importTechnologyInventory";

describe("client-only technology inventory import", () => {
  it("imports Drupal composer.lock without unrelated dependencies", () => {
    const json=JSON.stringify({ packages: [
      {name:"drupal/core-recommended",version:"11.3.1"},
      {name:"drupal/token",version:"1.15.0"},
      {name:"symfony/http-kernel",version:"7.0.0"}
    ]});
    const rows=importTechnologyInventory(json);
    expect(rows).toEqual([
      {kind:"drupal-package",id:"drupal/core-recommended",version:"11.3.1",evidence:"source-declared"},
      {kind:"drupal-package",id:"drupal/token",version:"1.15.0",evidence:"source-declared"}
    ]);
  });
  it("imports WordPress CLI plugin JSON", () => {
    const rows=importTechnologyInventory(JSON.stringify([{name:"akismet",version:"5.4",status:"active"}]));
    expect(rows).toEqual([{kind:"wordpress-plugin",id:"akismet",version:"5.4",evidence:"source-declared"}]);
  });
  it("imports a minimal ship-check model inventory, no arbitrary fields retained", () => {
    const rows=importTechnologyInventory(JSON.stringify({
      schemaVersion:"ship-check-technology-inventory/0.1",
      components:[{kind:"ai-model",id:"gpt-5",version:null,secret:"must never be included"}]
    }));
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(rows[0]).toEqual({kind:"ai-model",id:"gpt-5",evidence:"source-declared"});
  });
  it("rejects arbitrary files, huge input and an empty discovered set", () => {
    expect(() => importTechnologyInventory('{"foo":"bar"}')).toThrow();
    expect(() => importTechnologyInventory("x".repeat(2000001))).toThrow();
    expect(() => importTechnologyInventory(JSON.stringify({packages:[{name:"not-a-drupal-package",version:"1"}]}))).toThrow();
  });
});
