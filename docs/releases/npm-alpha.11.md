# Ship-check npm alpha.11

**Version:** `0.0.0-alpha.11`  
**Channel:** `alpha` — prerelease, not `latest`  
**Scope:** Published CLI (`@good-ship/ship-check`) and six optional pinned scanner packages for Windows x64, Linux x64 and macOS arm64.

## What's included

- **More useful `npx` onboarding** — improved CLI `--help`, generated npm README and a practical [CLI guide](../CLI_GUIDE.md). The help explains that reports print to stdout by default and that redirecting output saves them to a file. This release does **not** introduce a `--output` flag.
- **Richer evidence-led Markdown** — adds bounded observations, information about separately acquired evidence sources, questions answered by additional sources, and a suggested `--deployment-url` verification step when Next.js security-header evidence is incomplete.
- **Calibrated paid endpoint check** — recognises a narrow, fail-closed conditional bearer-token/401 denial before metered work, reducing false positive high-severity findings such as Bearing's classifier evaluation endpoint. This is pattern-based bounded evidence, **not** proof of full endpoint security.
- **Dynamic Next.js cron route matching** — resolves paths such as `/api/admin/benchmark-refresh/lmarena-text` to `src/app/api/admin/benchmark-refresh/[source]/route.ts` for the cron authentication and cost assessments.
- Regression fixtures cover protected and unprotected paid endpoints, parameterised cron handlers, and source/deployment evidence reporting.

Relevant merged PRs: [#70](https://github.com/tomcwxyz/Ship-check/pull/70), [#71](https://github.com/tomcwxyz/Ship-check/pull/71), [#72](https://github.com/tomcwxyz/Ship-check/pull/72).

## Known limits

- A live deployment may be running a different revision from the local source checkout. Ship-check displays evidence provenance, but matching these revisions is still the user's responsibility.
- The Bearing outbound-request URL question needs more precise data-flow analysis; the alpha.11 changes do not purport to fix or suppress it.
- Legitimate recurring provider work may still generate a cost-review prompt; it is not a measurement of wasted spend.
- Missing live browser security headers remain actionable until fixed on the deployed application.
- Source-only, runtime-only and database opt-in checks have different evidence boundaries; no clean report is a security guarantee.
- This is an **npm CLI release**. It does not imply new signed desktop installers or a desktop release.

## Publication

The existing [npm alpha publishing workflow](https://github.com/tomcwxyz/Ship-check/actions/workflows/npm-alpha-publish.yml) uses trusted publishing with GitHub OIDC and produces npm provenance. After tests and package staging pass, dispatch the workflow on **main** with:

- `version = 0.0.0-alpha.11`
- `confirm = PUBLISH_ALPHA`

Its preflight runs the type checks and tests, stages the package and performs `npm pack --dry-run`. The publication matrix sends Gitleaks/OSV optional packages for Windows, Linux and macOS, then publishes the main package after the scanner jobs. It skips any individual package version already published, allowing a failed publication to be retried.

## Acceptance tests after publication

On Windows Git Bash in a project such as Bearing:

~~~bash
npx --yes @good-ship/ship-check@0.0.0-alpha.11 --version

mkdir -p ~/ship-check-reports
npx --yes @good-ship/ship-check@0.0.0-alpha.11 scan . \
  --deployment-url https://findbearing.org \
  --format markdown | tee ~/ship-check-reports/bearing-alpha11.md
~~~

Review outcomes rather than relying on a particular expected number of findings:

1. The protected classifier evaluation endpoint should not be labelled unprotected solely because its auth control uses a conditional bearer/401 guard.
2. The four benchmark schedule paths should resolve to the `[source]` route rather than reporting `missing-route`.
3. Markdown should include existing positive observations and evidence provenance.
4. The security header and legitimate recurring-work findings should still be considered independently.
5. The unresolved provider catalogue URL data-flow question may remain until a separate calibration change.

Further check the package registry for all **seven** `0.0.0-alpha.11` packages and validate npm provenance before announcing the prerelease.
