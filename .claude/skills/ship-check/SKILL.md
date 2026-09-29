---
name: ship-check
description: Run an evidence-led pre-ship review with Ship Check, interpret its deterministic findings and unanswered controls without overstating assurance, make narrowly scoped repairs when asked, and rerun the checks. Use when a user asks whether software is ready to ship/deploy/release, asks for a Ship Check, wants to review a folder of projects, or wants to repair and verify Ship Check findings.
---

# Ship Check

Use Ship Check as the deterministic evidence layer. Your role is to orchestrate the scan, investigate context, help repair confirmed problems, and rerun the evidence.

## Core rules

Keep these states distinct:

- **Finding** — deterministic evidence supports a concrete concern.
- **Unverified** — a question that needs investigation. It is not a confirmed defect.
- **Observed** — project context discovered by the scanner. It is not assurance.
- **Coverage / not assessed** — Ship Check did not establish that area.
- **Agent assessment** — your contextual interpretation. Never present it as a Ship Check result.

Never say a project is safe merely because a scan is quiet.

Never reveal, repeat, or paste secret values found by a scanner.

Do not silently suppress a finding because it looks like a test fixture, fork, example, deprecated project or false positive. Explain your assessment separately and verify it where possible.

## Choose the scan

For one local project, prefer the canonical JSON report:

```bash
ship-check scan . --format json
```

When working inside the Ship Check repository itself, the local development command is:

```bash
pnpm ship-check -- scan . --format json
```

For a directory containing multiple projects:

```bash
ship-check scan-dir <directory> --format json
```

Use Markdown output when the user wants a portable hand-off:

```bash
ship-check scan . --format markdown
ship-check scan-dir <directory> --format markdown
```

Do not enable networked dependency scanning unless the user has asked for it or clearly authorised that network boundary:

```bash
ship-check scan . --networked-dependency-scan --format json
```

## Scanner availability

If Ship Check says a requested scanner is unavailable, treat that as missing evidence, not a pass.

If the user has asked for a comprehensive review and an approved complementary scanner is already installed, you may run it directly to investigate the gap. Keep its output clearly labelled as **external/agent-collected evidence**, not a Ship Check finding.

Do not install system-wide tools without the user's permission. Prefer local/project-scoped tooling.

## Project context

If the report contains declared project context from `.ship-check.json`, such as:

- `live | staging | development | deprecated`
- `owned | fork | upstream`

use it when organising attention. Treat it as user-declared context, not an inference.

Do not invent those labels when they are absent.

## Review workflow

1. Run Ship Check.
2. Confirm which checks completed and which evidence could not be collected.
3. Review confirmed findings before unanswered controls.
4. For credential findings, inspect only enough surrounding context to determine whether the match is plausibly live, synthetic, documentation, test data or upstream material. Do not print the matched value.
5. Investigate **unverified** controls before changing code.
6. Distinguish your contextual assessment from deterministic scanner state.
7. If the user asks for fixes, make the smallest useful change that addresses the verified issue and preserve intended behaviour.
8. Run the relevant project tests/build/type checks after code changes.
9. Rerun Ship Check.
10. Report what is resolved, what persists, what is newly introduced, and what still could not be assessed.

## Estate review

For a multi-project directory:

- keep project evidence boundaries separate;
- do not invent a portfolio safety score;
- do not prioritise by raw finding count alone;
- surface failed scans and unavailable scanners prominently;
- use declared live/deprecated and owned/fork/upstream context when present;
- distinguish current source evidence from historical exposure when Ship Check provides both;
- consolidate duplicated advisory aliases around the affected package/version where possible.

When prioritising for the user, explain the basis: severity, live/deployed context, ownership, missing evidence, or a verified exposure. Do not imply that this ordering changes the underlying Ship Check severity.

## Repair hand-off

When repairing a confirmed finding, use its exact finding ID, rule/check ID, evidence location, fix guidance and verification instruction.

When investigating an unanswered control, explicitly state that you are verifying a question rather than repairing a confirmed defect.

After repairs, rerun Ship Check rather than declaring the issue fixed from code inspection alone.

## Final response

Summarise:

- confirmed concerns addressed or still active;
- unanswered controls verified or still unresolved;
- scanner/check failures;
- tests run;
- rerun result;
- any agent-only contextual judgement, clearly labelled as such.

Preserve uncertainty where the evidence remains incomplete.
