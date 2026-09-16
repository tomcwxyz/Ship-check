# Alpha.8 calibration record

This records the evidence used to tune Ship Check before the desktop alpha.8 build. It is a calibration record, not a security scorecard and not a claim that the sampled repositories are safe.

## Public corpus

The repeatable public sample currently scans:

- `tomcwxyz/glade`
- `tomcwxyz/Carry`
- `tomcwxyz/open-recs-local`
- `tomcwxyz/volunteering-mcp-server`

The public workflow uses the same pinned Gitleaks 8.30.1 secret scanner as the desktop build. It does **not** download or run OSV; networked dependency scanning remains opt-in.

The local `pnpm calibrate:alpha8` harness remains the route for the wider private Good Ship corpus.

## What the corpus changed

The first useful public pass showed that several heuristics were technically plausible but too noisy for a pre-ship review. The rules were narrowed only where a real repository demonstrated a concrete false-positive shape.

### Paid work: operations, not provider names

Early behaviour treated provider names and configuration as evidence of paid work. That produced false findings for:

- Glade's signed Stripe webhook;
- Carry's health endpoint because shared configuration referenced OpenAI/Stripe environment variables;
- Open Recs Local routes that imported provider types/configuration but did not execute paid work.

Alpha.8 now looks for executable paid or metered operations, including direct paid API calls and AI SDK generation calls. Bare provider names, environment configuration, interface declarations and provider URLs mentioned only in comments do not establish paid work. Signed webhook verification and recognised authentication/rate/bot controls count as visible boundaries.

**Calibration decision:** keep Carry `api/capture.ts` as a useful high-severity finding because it directly invokes the OpenAI transcription API without a recognised abuse-control boundary. Drop the configuration/type/webhook false positives.

### Polling: bind the interval to network work

Glade's observer view contains both:

- a one-second UI clock timer; and
- a three-second network refresh.

The earlier check associated both intervals with network work because they appeared in the same file. Alpha.8 now requires the interval callback itself to perform network work or call a same-file helper that does.

**Calibration decision:** keep the three-second Glade poll as a useful cost/performance review item; drop the unrelated one-second UI timer.

### Object authorisation: existing-object changes only

The first authorisation heuristic mixed together too many signals from a bounded import graph. Corpus review exposed three important failure modes:

1. authentication was being confused with object-level authorisation;
2. a request-supplied `userId` could look like ownership evidence;
3. unrelated methods such as `cipher.update(...)` could combine with database evidence elsewhere and look like a database mutation.

Alpha.8 now requires:

- a deployable API route, not a test/spec route;
- an existing-object request shape: `PUT`, `PATCH`, `DELETE`, or a dynamic-route `POST` such as `/cases/[id]/respond`;
- request-controlled input;
- a database-specific update/delete/upsert operation in the same traced source as database evidence;
- no recognised ownership/role/permission boundary.

Static `POST` create/upload endpoints are deliberately outside this bounded rule for alpha.8.

**Calibration decision:** keep Carry's `/cases/[id]`, `/cases/[id]/feedback` and `/cases/[id]/respond` questions as useful-to-verify object-authorisation boundaries. Drop Open Recs Local's `/api/sources` create/upload question and Carry's capture/create question.

### Variable outbound destinations: retain as a question

Open Recs Local intentionally supports configurable OpenAI-compatible provider URLs. Its provider-model discovery route is admin-gated, but an administrator can still choose the destination the server calls.

Authentication or an admin role does not by itself establish destination safety.

**Calibration decision:** retain the outbound-destination question as `useful-to-verify`. It should prompt review of host restrictions, private/internal destinations and redirect handling without claiming an SSRF vulnerability.

### Secret scanning: keep mature scanner evidence, improve context

With pinned Gitleaks enabled, Open Recs Local reports several secret-shaped values in tests and planning documentation. Inspection shows deliberately synthetic examples such as test auth secrets and fake encryption/API-key fixtures.

Ship Check does not automatically ignore or downgrade matches because they occur in tests or docs: real credentials are also sometimes copied into those places.

Instead, the desktop review now labels these as **secret-like values in test or example material**, explains that they may be synthetic, and asks someone to confirm that without exposing the value.

**Calibration decision:** preserve the Gitleaks findings and scanner severity; improve the human-facing interpretation rather than adding a path-based suppression.

### Non-Next behaviour

`tomcwxyz/volunteering-mcp-server` produces no findings or unanswered questions in the current sample. Importantly, Ship Check reports access control, database and runtime areas as not assessed where its current bounded checks do not apply.

**Calibration decision:** keep this as a framework-bias check. A quiet non-Next scan must remain honest about what Ship Check did not assess.

## Current public-corpus shape

After the corpus-driven calibrations:

| Repository | Findings | Unanswered questions | Notes |
| --- | ---: | ---: | --- |
| Glade | 1 | 0 | Three-second network polling remains; Stripe/config noise removed. |
| Carry | 3 | 4 | Paid transcription, cron cadence and missing lockfile remain; three object-authorisation questions plus cron-auth verification remain. |
| Open Recs Local | 6 | 2 | Six Gitleaks matches are synthetic test/doc examples in this repo; outbound provider destination and security-header evidence remain to verify. |
| Volunteering MCP Server | 0 | 0 | Useful non-Next check; unsupported areas remain explicitly not assessed. |

These counts are descriptive of this dated corpus, not quality scores for the repositories.

## Regression evidence added

The alpha.8 branch now has tests covering the corpus failure modes, including:

- provider configuration is not paid work;
- provider interfaces/type declarations are not paid work;
- provider URLs in comments are not paid work;
- signed Stripe webhooks are not treated as unprotected paid endpoints;
- test/spec routes are not deployable API surfaces;
- one UI timer plus one network poll yields only the network-poll finding;
- request-supplied ownership IDs do not establish authorisation;
- unrelated `cipher.update()` does not become a database mutation;
- static POST/create routes are outside the existing-object authorisation rule;
- dynamic `[id]` POST actions remain in scope;
- test/example secret findings receive contextual plain-language review copy without being silently dismissed.

## What is still required before alpha.8

The public corpus is useful calibration evidence, but it is not the full release gate. Before cutting the installer:

1. run the local harness against the private Good Ship corpus in `ALPHA_8_GATE.md` and review obvious noise/misses;
2. visually test the standard scan/review flow on Windows;
3. verify the advanced disclosure, keyboard interaction and explicit OSV consent in the packaged desktop build;
4. confirm final `Validate` and `Desktop validate` are green on the release head.

Database/RLS inspection and live runtime verification remain later roadmap work rather than prerequisites for alpha.8.
