import { isIP } from "node:net";

const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const DENIED_SUFFIXES = [".localhost", ".local", ".internal", ".test", ".invalid", ".home", ".lan"];

export function parseSource(raw, kind) {
  if (typeof raw !== "string" || raw.length > 500) throw new Error("Enter a shorter public URL.");
  const value = raw.trim();
  if (kind === "github") {
    let slug = value;
    if (value.startsWith("https://")) {
      let url;
      try { url = new URL(value); } catch { throw new Error("Enter a public GitHub repository URL."); }
      if (url.hostname !== "github.com" || url.username || url.password || url.port ||
          url.search || url.hash) throw new Error("Use a plain github.com/owner/repository URL.");
      slug = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    }
    const parts = slug.replace(/\.git$/, "").split("/");
    if (parts.length !== 2 || !parts.every(p => REPO_PART.test(p) && p !== "." && p !== ".."))
      throw new Error("Use a public repository in the form owner/repository.");
    return { kind: "github", label: parts.join("/"), target: "https://github.com/" + parts.join("/") };
  }
  if (kind === "site") {
    let url;
    try { url = new URL(value); } catch { throw new Error("Enter a full HTTPS website URL."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.hostname.length > 253 || !url.hostname.includes(".") ||
        url.hostname === "localhost" || isIP(url.hostname) !== 0 ||
        DENIED_SUFFIXES.some(s => url.hostname.endsWith(s)) ||
        !/^[a-z0-9.-]+$/i.test(url.hostname))
      throw new Error("Only public HTTPS hostnames without custom ports are supported.");
    if (url.pathname.length > 160 || url.search.length > 160)
      throw new Error("Use a shorter public website address.");
    url.hash = "";
    return { kind: "site", label: url.hostname, target: url.toString() };
  }
  throw new Error("Choose GitHub repository or live website.");
}
