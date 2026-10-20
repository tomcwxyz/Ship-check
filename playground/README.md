# Ship Check public playground

A deliberately separate, no-login Next.js app in the existing Ship-check repository. It does not modify Cloud R0's metadata-only storage or authenticate users.

## Behaviour

- Public GitHub repository `owner/repo` or a public HTTPS website.
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
- Three scans per visitor per 24-hour key TTL, server-enforced. IP identity is pseudonymised using SHA-256 before use as a Redis key; it is not an anonymity guarantee. Deploy upstream protection against proxies / distributed abuse before scaling.
- Target site validation rejects IP literals, local names, credentials, alternate ports and HTTP. DNS-based SSRF remains a review concern for the live-site flow: sandbox isolation limits reachability, but egress policy/DNS revalidation should be hardened before broad public launch.
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

Use an actual Upstash Redis REST database and Vercel Sandbox project identity before attempting a real scan. Set these values in Vercel project environment settings, never in client code:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
SHIP_CHECK_PLAYGROUND_SCANNER_VERSION=0.0.0-alpha.10
```

The pinned `@good-ship/ship-check` release must **already be published and validated**. Do not silently fall back to a different scanner or `latest`. If the package/version is not available, finish publication/testing before enabling scans.

On Vercel Sandbox, Vercel OIDC authenticates automatically to the linked Vercel project. For local sandbox calls, configure a development OIDC token using Vercel's documented workflow.

## Deploy

Create a **separate Vercel project** pointing to `tomcwxyz/Ship-check`, with Root Directory = `playground`, Framework = Next.js, Install Command = `npm ci` once an npm lockfile has been generated and committed. Until then, use `npm install` in preview only. Keep the existing `ship-check` Cloud R0 project untouched.

Before sharing a public link: ensure no deployment password/SSO for the playground hostname, configure rate limiting, verify the pinned CLI on a real public fixture and a live website, verify 429 response on a fourth request, verify no cloud retention of reports, test malicious inputs and redirects, and review Sandbox billing/quotas.

## Full desktop/CLI

Use the main repository for local/private/estate scans and additional evidence sources.
