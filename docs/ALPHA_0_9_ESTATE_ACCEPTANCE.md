# Alpha 0.9 estate acceptance protocol

Alpha 0.9 is not accepted because it finds a large number of issues. The estate test is about whether Ship Check can turn a real development directory into bounded, attributable evidence and a usable repair programme without inventing a portfolio score.

The primary reference corpus is the development directory containing roughly 70 project folders.

## Run the local acceptance pass

From the Ship Check repository:

```bash
node scripts/alpha9-estate-acceptance.mjs /path/to/Code --max-depth 3 --git-history-secrets
```

This runs all three standard packs. Git-history credential checking stays local and is explicit in the command above. OSV remains opt-in because it crosses a network boundary:

```bash
node scripts/alpha9-estate-acceptance.mjs /path/to/Code \
  --max-depth 3 \
  --git-history-secrets \
  --networked-dependency-scan
```

Request the pinned local Semgrep boundary separately when a compatible local CLI is available:

```bash
node scripts/alpha9-estate-acceptance.mjs /path/to/Code \
  --max-depth 3 \
  --git-history-secrets \
  --local-semgrep-scan
```

Use `--skip-build` only for repeated local runs after the workspace has already been built.

## Privacy boundary

The runner writes to `.ship-check-alpha9/<timestamp>/` and that directory is ignored by Git. It is deliberately **not** a GitHub Actions workflow.

The folder contains the complete estate JSON and canonical Markdown review. Those artefacts can include local paths and bounded evidence locations. Keep them local unless there is a specific reason to share a redacted extract.

## What the runner checks automatically

The acceptance runner verifies bounded invariants that should not require human judgement:

- aggregate project counts agree with the actual project records;
- discovered roots are unique;
- common dependency/build folders were not treated as project roots;
- every completed project retains its own findings, gaps, checks and coverage arrays;
- unavailable requested scanners get a dedicated aggregate section;
- project ordering in the hand-off is neutral/alphabetical rather than a hidden priority score;
- the estate JSON exposes no score/rank/weight field;
- recognisable credential material is not echoed in credential-finding evidence excerpts;
- every project with an active finding or unanswered control can produce the canonical focused **FIX** or **VERIFY** action.

A failed machine check makes the runner exit non-zero.

## What remains a human acceptance decision

The generated `ACCEPTANCE.md` contains the manual part of the gate. Review:

1. **Discovery completeness.** Tick off the discovered roots against the projects you expected. Automation cannot detect a project it never discovered.
2. **Usefulness/noise.** Sample findings and unanswered controls, especially high/medium items. Record false positives, low-value truths and obvious manual misses.
3. **Dependency consolidation.** When OSV is enabled, check that package/version units remain the primary issue and advisory aliases do not inflate the apparent problem count.
4. **Credential history.** Sample current and historical credential findings. Values must stay redacted, and deletion must not be described as revocation.
5. **Repair loop.** Take at least one focused FIX and one VERIFY action through investigate/change/test/rerun. Compare before and after without treating disappearance alone as proof of remediation.

## Acceptance output

Each run produces:

- `estate-report.json` — complete aggregate JSON;
- `estate-review.md` — canonical human/agent hand-off;
- `ACCEPTANCE.md` — machine checks plus the manual review worksheet;
- `manifest.json` — run options and machine-check results.

The output has no estate score. A machine PASS means only that the stated bounded invariants held.
