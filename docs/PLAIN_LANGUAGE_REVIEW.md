# Plain-language review

Implemented after the Windows alpha.6 review of csv-viz on 14 September 2026.

## Changes

- The results screen leads with potential issues and unanswered questions. Cards explain consequences, next steps and verification; technical evidence and individual check statuses are expandable. Copy actions preserve source locations, rule identifiers and uncertainty.
- Framework-specific checks can declare applicability. Inapplicable checks contribute no coverage and report `not-applicable`, rather than `passed`. A gate with no applicable checks is incomplete.
- Selected Gitleaks JWT/generic-key matches are classified against local source. A literal Supabase public key directly passed to `createClient` becomes an observation. Privileged, malformed, ambiguous and unrelated matches remain findings. Decoding a token does not verify its signature or database permissions.
- Browser-data review identifies public Supabase clients, postcode-service calls beside browser-local data promises, and narrow save-success/error-return patterns. These produce questions to verify, not demonstrated vulnerability claims. There is no live network or database probing.
- Diagnostics retain the resolved Git commit when available and the Gitleaks version without copying key values or finding details. Local working trees may contain changes beyond HEAD: this commit is a reference, not a hash of all scanned content.
- Disabled optional analysis remains visible in the desktop overview. Schema additions are optional commit/scanner metadata and a new `not-applicable` check status. Consumers must not count that status as a pass.

## Boundaries

The browser-data rules are bounded source heuristics, not a general data-flow analyser. The first destination rule recognises postcodes.io. Other destinations, cross-file consent flows and more complex save paths remain follow-up work. Database grants and policies require deployment-side verification. A public-key observation never proves database safety.

Plain-language copy is reviewed deterministic content. Initial tailored copy covers access keys, paid endpoints and dependency lockfiles; other rules retain existing explanations within the simpler card structure. No source is sent to an LLM for explanation.

## Verification and release

Regression tests cover public versus privileged keys, unrelated rules, ambiguous source lines, applicability and coverage, browser-data questions, assurance gates, diagnostic provenance and repair instructions. Type checks, builds, engine tests and desktop JavaScript tests passed locally.

The three retrieved csv-viz files (`Form.js`, `AllData.js`, `supabaseClient.js`) produce the database, privacy-promise and save-success questions. The actual client key is recognised as public by the classifier. This is a targeted source regression, not a full live-site or database assessment.

Browser visual verification could not run locally: the Chrome download failed certificate verification. Before distribution, build a fresh installer and test layout, keyboard expansion, copy actions and scanning on Windows and macOS. Existing alpha.6 installers do not contain these changes.
