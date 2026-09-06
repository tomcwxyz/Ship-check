# Alpha 1.6 — regression-aware review

Alpha 1.6 should improve repeated Ship Check runs without changing the current Alpha 1.5 rule behaviour while corpus testing is in progress.

## Goal

Make the second scan more useful than the first.

The desktop should be able to say, for the same repository and pack selection:

- how many findings are new;
- how many have been resolved;
- how many are unchanged;
- whether the repository has regressed since its most recent clean comparable scan.

This is review state, not a second source of truth. The canonical scan report remains the deterministic engine output.

## Privacy boundary

Regression history must remain local and bounded. Do not store source contents, evidence excerpts, repair prompts, matched secret values or credentials.

Finding identity for local history is represented by an opaque fingerprint derived from stable non-secret finding metadata. Fingerprints are only for comparing runs; they are not assurance evidence and must not appear in RACK/OOS outputs.

## Comparable scans

Two scans are comparable when they have:

1. the same source kind and privacy-reduced source label;
2. the same Git ref when one is specified;
3. the same selected pack set.

A failed scan is never a comparison baseline.

The initial Alpha 1.6 implementation compares with the previous comparable completed scan. The next step is to additionally retain the most recent clean comparable scan as a named baseline so reintroduced findings can be labelled clearly as regressions.

## Rule changes

Before Alpha 1.6 is released, checks need independent metadata/versioning. A fingerprint match across materially different rule versions must not be presented as an unchanged product finding without qualification.

Proposed minimum metadata:

- `checkId`;
- `checkVersion`;
- pack;
- title/description;
- evidence boundary;
- introduced/changed note where useful.

## Suppression

Suppression comes after check versioning. A suppression must include:

- finding/check scope;
- human-readable rationale;
- who/what created it where that information exists locally;
- creation time;
- optional review/expiry time;
- the rule version it was reviewed against.

Suppressed findings remain countable/auditable and must never silently disappear from structured reports.

## Merge boundary during 1.5 testing

Safe to prepare now:

- fingerprint/delta helper;
- tests for comparison behaviour;
- docs and UI plumbing that do not alter current deterministic findings;
- version/suppression contracts behind non-default paths.

Hold until corpus testing is reviewed:

- changing existing check heuristics;
- changing severity/confidence calibration;
- enabling new checks by default;
- treating a suppression as a pass.
