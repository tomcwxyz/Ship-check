# Ship Check public playground

A deliberately separate, no-login Next.js app in the existing Ship-check repository. It does not modify Cloud R0's metadata-only storage or authenticate users.

## Behaviour

- Public GitHub repository `owner/repo`. Website scanning is temporarily disabled pending further DNS/IPv6 egress controls.
- Runs the **published, pinned canonical Ship Check CLI** in an ephemeral Vercel Sandbox, not a parallel implementation of the scanner.
- Captures an original `ScanReport/0.1` JSON result for findings, unverified controls, and coverage.
- Gives an illustrated example (explicitly marked **not a real scan**) without consuming credits.
- Retains no source, reports, or scan history; sandbox destroyed in `finally`.
- Downloads JSON and Markdown locally from the user's browser.

## Limitations and safety

- No local folders, private repositories, database credentials, ZIP upload, or historical git-secret scanning.
- Vercel Sandbox isolates the scanned project from app secrets. Only the fixed, published CLI is executed. User input is passed as argument data, never a shell string.
- Public GitHub size is checked against the GitHub repository API before scan (20,000 KiB upper bound). GitHub's reported size is not a decompression limit, so runner CPU/memory/timeouts are also required.
- Anonymous scans require a Vercel-injected real client IP and durable Upstash Redis rate limiting. Without either, scans are **disabled** rather than unmetered.
- Three scans per visitor per 24-hour key TTL, server-enforced. IP identity is pseudonymised using a keyed HMAC-SHA-256 before use as a Redis key; it is not an anonymity guarantee. Deploy upstream protection against proxies / distributed abuse before scaling.
- The sandbox egress allow-list is limited to `registry.npmjs.org` and `github.com`, with explicit IPv4 private/link-local CIDR denies. Vercel Sandbox rejects IPv6 CIDRs such as `::1/128` at creation; website scanning is disabled until we can robustly reject IPv6 private targets and DNS rebinding. GitHub checks only permit the fixed `github.com` domain.
- Report returned only to the requesting browser with no-store cache headers. Avoid server logging raw report content. The originating repository may remain publicly available at GitHub.
- Scans use the canonical engine's bounded, non-mutating checks; this is **not** a security certificate or penetration test.
- Host limit: 180 seconds; sandbox limit: 150 seconds. Run-time GitHub API, npm or sandbox availability can cause a graceful error.

## Local development

```bash
cd playground
npm install
npm test
npm run check
npm run dev
```

Use a connected Vercel KV (Upstash-backed) database, which supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN` to preview and production; the same code also supports `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` if provisioned directly with Upstash. Both sets are server-side only. A Vercel Sandbox project identity is required for real scans.

The canonical scanner is pinned to `0.0.0-alpha.11` by default. Set `SHIP_CHECK_PLAYGROUND_SCANNER_VERSION` only for a published and verified alternative release.

The pinned `@good-ship/ship-check@0.0.0-alpha.9` release has been smoke-tested in a Vercel Sandbox against a real public GitHub repository (20 October 2026). The repository's newer alpha.10 has not yet been published. Managed scan provenance is corrected in the hosted wrapper until the next CLI release supports that execution boundary natively. Do not silently fall back to a different scanner or `latest`. If the package/version is not available, finish publication/testing before enabling scans.

On Vercel Sandbox, Vercel OIDC authenticates automatically to the linked Vercel project. For local sandbox calls, configure a development OIDC token using Vercel's documented workflow.

## Deploy

Create a **separate Vercel project** linked to the [canonical source repository](https://check.good-ship.co.uk/source), with Root Directory = `playground`, Framework = Next.js, Install Command = `npm ci` once an npm lockfile has been generated and committed. Until then, use `npm install` in preview only. The app pins Next.js 15.5.28 and overrides its vulnerable PostCSS transitive dependency to 8.5.31; the combination passed the runtime npm audit, unit tests and Next.js build in an isolated test sandbox. Keep the existing `ship-check` Cloud R0 project untouched.

Before sharing a public link: ensure no deployment password/SSO for the playground hostname, configure rate limiting, verify the pinned CLI on a real public GitHub fixture, verify 429 response on a fourth request, verify no cloud retention of reports, test malicious inputs, and review Sandbox billing/quotas.

## Full desktop/CLI

Use the main repository for local/private/estate scans and additional evidence sources.
