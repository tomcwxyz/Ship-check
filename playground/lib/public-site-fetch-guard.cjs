"use strict";

/**
 * Node preloader for the public Playground's URL-only Ship Check scan.
 * Runs inside the already isolated Vercel Sandbox. The scanner's runtime GET
 * uses this guarded fetch: public IPv4 verified at socket connect, TLS
 * hostname verification retained, no off-origin redirect, no HTTP, no
 * credentials, no response body beyond a 32 KiB public HTML sample.
 *
 * The Vercel Sandbox SNI allowlist and private subnet denies remain separate
 * defence-in-depth. This preloader does not grant arbitrary outbound access.
 */
const https = require("node:https");
const dns = require("node:dns");
const { isIP } = require("node:net");

const MAX_BODY = 32 * 1024;
const MAX_HEADERS = 16 * 1024;
const TIMEOUT_MS = 10_000;

function publicIPv4(value) {
  if (isIP(value) !== 4) return false;
  const bytes = value.split(".").map(Number);
  const [a, b, c] = bytes;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function siteHostnames(configuredHost) {
  const host = configuredHost.toLowerCase();
  const alternative = host.startsWith("www.") ? host.slice(4) : "www." + host;
  return [host,alternative];
}

function allowedUrl(raw, configuredHost) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !siteHostnames(configuredHost).includes(url.hostname.toLowerCase()) ||
      isIP(url.hostname) || !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      url.pathname.length > 1024 || url.search.length > 160) {
    throw new Error("Public website scan blocked an unsafe URL or redirect.");
  }
  return url;
}

function selectAddress(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Website has no public IPv4 DNS address.");
  }
  // Any unsafe A/AAAA record is a reason to refuse this hostname. Never
  // opportunistically choose a public address from a mixed result.
  if (entries.some(entry => typeof entry.address !== "string" ||
       !((entry.family === 4 && publicIPv4(entry.address)) ||
         (entry.family === 6 && isIP(entry.address) === 6 &&
           !/^(?:::|fc|fd|fe[89ab]|ff)/i.test(entry.address))))) {
    throw new Error("Website DNS includes an internal or unsupported address.");
  }
  const selected = entries.find(entry => entry.family === 4 && publicIPv4(entry.address));
  if (!selected) throw new Error("Website needs a public IPv4 DNS address for this scan.");
  return selected.address;
}

function guardedLookup(host, options, callback) {
  dns.lookup(host, { all: true, verbatim: true }, (error, entries) => {
    if (error) return callback(new Error("Could not resolve public website DNS."));
    try {
      const address = selectAddress(entries);
      callback(null, address, 4);
    } catch (cause) {
      callback(cause);
    }
  });
}

function responseHeaders(raw) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

async function publicSiteFetch(input, init = {}, configuredHost) {
  const url = allowedUrl(input instanceof URL ? input.href : typeof input === "string" ? input : input.url, configuredHost);
  if ((init.method ?? "GET").toUpperCase() !== "GET" || init.redirect !== "manual") {
    throw new Error("Public website scan permits only a bounded GET with manual redirects.");
  }
  const permittedHeaders = {};
  const supplied = new Headers(init.headers ?? {});
  for (const name of ["accept", "origin", "user-agent"]) {
    const value = supplied.get(name);
    if (value) permittedHeaders[name] = value.slice(0, 250);
  }
  return new Promise((resolve, reject) => {
    let complete = false;
    let request;
    const finish = (error, response) => {
      if (complete) return;
      complete = true;
      init.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(response);
    };
    const abort = () => request?.destroy(new Error("Website request timed out or was cancelled."));
    try {
      request = https.request(url, {
        method:"GET", headers:permittedHeaders, lookup:guardedLookup,
        family:4, agent:false, maxHeaderSize:MAX_HEADERS,
        timeout:TIMEOUT_MS,
        rejectUnauthorized:true
      }, response => {
        const headers = responseHeaders(response.headers);
        const status = response.statusCode || 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          return finish(null, new Response(null, { status, headers }));
        }
        let size=0; const parts=[];
        response.on("data", part => {
          if (complete) return;
          const chunk=Buffer.from(part);
          const remaining=MAX_BODY-size;
          if (remaining>0) { parts.push(chunk.subarray(0,remaining)); size+=Math.min(remaining,chunk.length); }
          if (size>=MAX_BODY) {
            response.destroy();
            finish(null,new Response(Buffer.concat(parts),{status,headers}));
          }
        });
        response.on("end",()=>{if (!complete) finish(null,new Response(Buffer.concat(parts),{status,headers}));});
        response.on("error",error=>finish(error));
      });
      request.on("error",error=>finish(error));
      request.on("timeout",abort);
      init.signal?.addEventListener("abort",abort,{once:true});
      if (init.signal?.aborted) abort();
      else request.end();
    } catch (error) { finish(error); }
  });
}

if (process.env.SHIP_CHECK_SAFE_SITE_HOST) {
  const expected = process.env.SHIP_CHECK_SAFE_SITE_HOST.toLowerCase();
  if (!/^[a-z0-9.-]{4,253}$/.test(expected) || !expected.includes(".")) {
    throw new Error("Invalid public website scan boundary.");
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function siteRestrictedFetch(input, init) {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "registry.npmjs.org" && url.protocol === "https:") {
      return originalFetch(input,init);
    }
    return publicSiteFetch(input,init,expected);
  };
}
module.exports = { publicIPv4, allowedUrl, selectAddress, siteHostnames, publicSiteFetch };
