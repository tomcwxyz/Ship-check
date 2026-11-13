import { describe, expect, it } from "vitest";
import { parseDrupalRss, fetchDrupalFeeds } from "./cmsFeeds";

const now = "2026-11-13T12:00:00.000Z";
const entry = (title: string, slug: string, url: string) =>
  "<item><title>" + title + "</title><link>" + url + "</link><pubDate>Wed, 28 Oct 2026 12:00:00 GMT</pubDate>" +
  "<description><![CDATA[<p>Project machine name: <code>" + slug + "</code></p>]]></description></item>";
const rss = (...items: string[]) => '<?xml version="1.0"?><rss version="2.0"><channel><title>Drupal</title>' + items.join("") + "</channel></rss>";

describe("Drupal official security feeds", () => {
  it("uses exact contributed package machine names and keeps impact unverified", () => {
    const xml = rss(entry("Some Name - Critical - SA-CONTRIB-2026-292", "unusual_machine_name", "https://www.drupal.org/sa-contrib-2026-292"));
    const notes = parseDrupalRss(xml, now);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: "drupal:SA-CONTRIB-2026-292",
      componentId: "drupal/unusual_machine_name",
      componentKind: "drupal-package"
    });
    expect(notes[0]?.affectedVersions).toBeUndefined();
  });
  it("includes both core Composer package IDs but never guesses module names", () => {
    const xml = rss(
      entry("Drupal core - SA-CORE-2026-016", "drupal", "https://www.drupal.org/sa-core-2026-016"),
      "<item><title>Fancy module - SA-CONTRIB-2026-123</title><link>https://www.drupal.org/sa-contrib-2026-123</link><description>no machine name</description></item>"
    );
    const notes = parseDrupalRss(xml, now);
    expect(notes.map(n => n.componentId).sort()).toEqual(["drupal/core", "drupal/core-recommended"]);
  });
  it("rejects spoofed domains and broken RSS instead of reporting a healthy feed", () => {
    expect(() => parseDrupalRss(rss(entry("Fake SA-CONTRIB-2026-010","x","https://evil.example/x")), now)).toThrow();
    expect(() => parseDrupalRss("<html>Not an XML feed</html>", now)).toThrow();
  });
  it("fails the combined refresh if one feed is unavailable", async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url=String(input);
      if (url.includes("contrib")) {
        return new Response(rss(entry("Some module SA-CONTRIB-2026-292","some_module","https://www.drupal.org/sa-contrib-2026-292")), { status: 200 });
      }
      return new Response("blocked", { status: 403 });
    };
    await expect(fetchDrupalFeeds(now,fetcher as typeof fetch)).rejects.toThrow(/incomplete/);
  });
});
