# Desktop alpha.8 quality gate

Alpha.8 is a calibration and product-coherence release, not the start of Database Ready or runtime verification.

Its purpose is to make the current repository review broader, more understandable, more defensible and more recognisably Ship Check before the next installer is cut.

## What alpha.8 should establish

A normal user should be able to:

1. choose a local folder or GitHub repository;
2. run the recommended review without understanding packs or scanner names;
3. see confirmed concerns before technical detail;
4. see unanswered questions separately from confirmed findings;
5. understand what Ship Check looked at and what it did not assess;
6. hand a precise repair or verification instruction to a developer or AI tool.

The evidence contract remains:

- **Finding** — repository evidence supports a concrete concern.
- **Observed** — useful repository-visible context was discovered; this is not a safety claim.
- **Unverified** — a relevant boundary exists but source evidence is not enough to establish it.
- **Coverage** — the bounded areas Ship Check did or did not assess.

## Breadth added before alpha.8

### Object-level authorisation

`secure.mutating-object-authorisation` looks for a deliberately narrow shape:

- mutating Next.js/API request handler affecting an existing object;
- request-controlled input;
- repository-visible database update/delete in the same bounded traced source;
- no recognised explicit permission/role boundary and no paired authenticated-identity + object-scope evidence.

Static create/upload POST endpoints are deliberately out of scope for this alpha unless the route itself identifies an existing object (for example a dynamic `[id]` action). This trades some recall for a more useful, defensible review question.

A match is an **unverified question**, not a broken-access-control finding. Verification should use at least two ordinary accounts with different records and should include attempts to change another user's object by changing identifiers.

### Outbound request destinations

`secure.outbound-request-boundary` looks for request-controlled server paths that reach a URL-like variable outbound destination without a recognised host allow-list marker.

A match is an **unverified question**, not an SSRF vulnerability claim. Verification should establish destination construction, host restrictions, redirect handling and rejection of internal/private destinations.

### GitHub Actions supply-chain boundaries

`production.github-actions-supply-chain` currently makes concrete findings only for two explicit repository-visible patterns:

- `permissions: write-all`;
- external actions following branch-like moving references such as `@main`, `@master` or `@latest`.

It deliberately does **not** flag every semver action tag in this release. That broader policy may be useful later, but it should be corpus-calibrated before generating more workflow noise.

## Language and UI gate

Before alpha.8 is built:

- the standard all-pack local review is the obvious default path;
- pack selection and optional Semgrep/OSV controls are secondary/advanced;
- result summaries never imply that zero findings means safe;
- the main finding families have reviewed plain-language titles, consequence, next-step and verification guidance;
- technical rule IDs, confidence and raw evidence remain available but secondary;
- unanswered questions explicitly say that they are not confirmed defects;
- coverage remains categorical (`assessed`, `partial`, `not-assessed`) rather than a score or percentage.

## Visual identity gate

Alpha.8 introduces a distinct Ship Check identity documented in `docs/SHIP_CHECK_BRAND.md`.

The desktop should feel like an **inspection instrument** rather than a generic rounded dashboard or a cyber-security console:

- abstract survey-ring mark rather than a literal tick/checkmark;
- graphite/salt surfaces with signal orange used sparingly as the product accent;
- harder 2–4px radii and technical plates instead of soft floating cards;
- system sans-serif for explanation and monospace for evidence/status metadata;
- finding severity shown as evidence rails rather than large alarm-coloured surfaces;
- no visual device that implies certification, a percentage-safe score or whole-product pass/fail.

The same survey-ring geometry is now used for the in-app mark and packaged desktop icon. The asset generator validates the 128×128 PNG source and creates a simplified 32×32 Windows ICO with a transparent gutter for taskbar legibility. The packaged Windows pass must still check the mark and icon at real OS sizes, alongside contrast, focus states, status colours and responsive layout.

## Corpus pass

Run the branch/build against at least:

| Repository | Focus |
| --- | --- |
| `tomcwxyz/attention-agent-pilot` | auth/agent/scheduled work, Neon, outbound integrations |
| `tomcwxyz/glade` | paid endpoints, auth, Stripe/Resend, rate limiting |
| `tomcwxyz/Event` | quiet modern repo and false-positive rate |
| `tomcwxyz/Trader` | scheduled/data work and cost calibration |
| `tomcwxyz/the-list` | older Supabase/Resend/Vercel patterns |
| one small non-Next repository | framework-bias check |

The repeatable local harness is:

```bash
pnpm calibrate:alpha8
```

It builds the CLI once, scans the default corpus using the machine's existing Git credentials, continues if an individual repository cannot be reached, and writes a git-ignored calibration bundle under `.ship-check-alpha8/`. Each run contains:

- `CALIBRATION.md` — a worksheet with every active finding and unanswered question plus classification/notes columns;
- `reports/*.json` — redacted calibration records containing rule/check metadata and evidence locations, not source contents or matched secret values;
- `manifest.json` — the sources and completion/failure counts for the run.

Pass repositories explicitly to use a different corpus:

```bash
pnpm calibrate:alpha8 -- tomcwxyz/glade tomcwxyz/Carry ./path/to/local-project
```

A non-gating `Alpha 8 public corpus` workflow also exercises a small public sample on relevant pull-request changes. It installs the pinned checksum-verified Gitleaks binary so the secret-scanning environment is comparable with desktop, but deliberately does not download or run OSV. It exists to catch obvious calibration regressions early; the local harness remains authoritative for the private Good Ship corpus.

For each finding classify `useful`, `true-but-low-value`, `false-positive` or `uncertain`.

For each unverified question classify `useful-to-verify`, `already-protected-elsewhere`, `heuristic-missed-local-evidence` or `not-useful`.

Record important manual misses as well as noisy matches.

## Specific alpha.8 calibration questions

- Does the authorisation question appear only where there is a real object-level review task?
- Does common ownership scoping suppress it without letting input-provided `userId` fields create a false sense of verification?
- Does the outbound-request question identify genuinely variable destinations without flagging normal fixed provider calls?
- Are GitHub Actions findings useful at current severity, or do they need to move to lower severity/observation?
- Do any existing findings still fall back to unnecessarily technical front-of-card copy?
- Is the advanced-check disclosure understandable without hiding the OSV network-consent boundary?
- Does the default review remain useful on a zero-finding repository?
- Does the distinct inspection-instrument identity remain calm and legible when findings/questions are present, rather than becoming alarmist?
- Does the survey-ring icon remain distinct and readable in the installer/taskbar at 16–32px rather than collapsing into a generic coloured block?

## Build gate

Do not create the next desktop alpha until:

- `Validate` and `Desktop validate` pass;
- the new breadth tests pass;
- the desktop review tests pass;
- the standard local scan flow is visually checked on Windows;
- the Ship Check visual identity is checked in the packaged app, including focus/contrast and real window sizes;
- the packaged survey-ring icon is checked in the installer/taskbar at real OS sizes;
- at least the first representative corpus pass has been reviewed for obvious noise/misses;
- no new breadth rule is being interpreted as broader assurance than its evidence supports.

Database permissions/RLS inspection remains the next **Database Ready** roadmap line. Live deployment checks remain the later **runtime verification** line.
