# Review decisions and estate overview (Alpha 0.9 follow-on)

## What changed

A folder-of-projects scan is presented as an **action-oriented estate dashboard**. It keeps five mutually exclusive groupings:

- **Findings** — the project has scanner findings; severity only orders findings within this group.
- **To verify** — no scanner findings, but one or more unanswered controls or check errors.
- **Failed scans** — the project never produced a usable scan report.
- **Limited evidence** — no findings or questions but no assessed area could be established, because coverage is absent or entirely unassessed.
- **No findings in checked areas** — at least one area was assessed or partly assessed and no active concerns were reported. Other areas may still be unassessed; a coverage strip makes this explicit. This is not a safety claim.

Each project still shows its own coverage strip and details. The overview also counts projects with partly assessed or unassessed areas across **all** groups, including those that already have findings. No numeric estate safety score is created, and missing coverage is never interpreted as passed.

## Reviewer decisions

Every single-project and estate-project finding offers a local assessment:

| Decision | Meaning |
| --- | --- |
| Useful | The result is worth acting on or investigating. |
| Not relevant | A human judged this finding unhelpful in this context. |
| Fixed · recheck needed | The human believes the issue has been addressed; a new scan is required. |
| Risk accepted locally | The human has consciously accepted the risk and supplied a rationale of at least ten characters. |

**These are annotations, not facts about the application's safety.** Decisions never remove a finding, alter severity, change check results, or modify CI gates. In particular, “Risk accepted locally” is **not** the same as a tracked `.ship-check.json` suppression. Tracked suppressions are explicit, version-bound repository policy as described in [SUPPRESSIONS.md](SUPPRESSIONS.md).

Review decisions are stored in local desktop WebView storage under `ship-check.finding-reviews.v1`, not in report JSON, telemetry, Cloud, or the scanned project. Each record retains SHA-256 digests of the project identity, finding identity and exact rule/version; the non-sensitive rule ID; the decision; an optional reviewer-written rationale; and review/recheck timestamps. No scanned source, extracted credentials, evidence paths or excerpt values are automatically stored. Users should not paste secrets or personal data into a rationale. Decisions remain on this device and may be lost if its application storage is cleared; there is currently no sync or export.

Estate scans and direct local folder scans of the **same** directory share project identity. GitHub and site scans use distinct evidence-source identities. A rule-version change creates a new finding-review identity: a previous decision does not silently apply to a revised rule.

## What a recheck establishes

Following any new scan, review annotations update their **observed status**:

- **Still found** — the same finding or an explicitly suppressed matching finding remains in this scan.
- **Not detected by the same check** — the original finding is absent and that exact check/version completed in the latest scan.
- **Not rechecked** — the check/version was absent, inapplicable, not assessed, or failed.
- **Not rechecked yet** — the reviewer has saved a decision since the last scan.

“Not detected” is deliberately **not** “verified fixed”. The rule has a bounded assessment scope; broader app behaviour, runtime conditions and human intent may require further evidence. Historical decisions remain visible even when findings disappear and can be removed individually.

## Verification

- `node --test apps/desktop/ui/estate.test.mjs apps/desktop/ui/finding-reviews.test.mjs apps/desktop/ui/overview.test.mjs`
- `node --test apps/desktop/ui/*.test.mjs`
- `pnpm check && pnpm test && pnpm build`

Manual desktop coverage should include: project with a high finding and a missing coverage area; project with unanswered questions only; check error; wholly unassessed or absent coverage; a failed estate scan; saved review persistence after relaunch; a fixed finding still present on recheck; a fixed finding absent with the check completed; an unassessed/failed check; a rule version change; and removal of a review from history. Test keyboard navigation and both narrow and wide screens.
