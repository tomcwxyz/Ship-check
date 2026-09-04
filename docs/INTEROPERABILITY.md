# RACK, TOPO and Organisational OS interoperability

Ship Check is useful by itself. Integration is through explicit contracts rather than shared UI code, shared databases or assumptions that the products release together.

## RACK

RACK consumes Ship Check as a **verification provider**. RACK remains responsible for deciding which checks a working practice requires; Ship Check remains responsible for repository inspection, deterministic evidence and findings.

The first executable boundary is process/JSON based. Ship Check exposes gate IDs:

- `ship-check` — everything included in the current scan;
- `ship-check-secure-build`;
- `ship-check-production-ready`;
- `ship-check-cost-aware`.

A gate maps the report into RACK's verification outcome vocabulary: `pass`, `fail`, `uncertain` or `incomplete`. Findings at or above the configured severity threshold fail the gate. A requested pack that was not run, or a relevant check error without stronger failing evidence, produces `incomplete` rather than a false pass.

Example:

```bash
ship-check scan ./work-project \
  --format rack \
  --gate ship-check-secure-build \
  --step-id release-security \
  --fail-on high
```

The resulting object contains the RACK step ID and outcome plus a bounded Ship Check provider result. The full report remains a separate artefact. RACK should not treat repair prompts as verification evidence.

The next RACK-side step is a trusted external-verifier executor: discover a locally installed Ship Check executable, show the exact pack/gate command before execution, require confirmation, run against the already-selected work-project folder and feed the result into the existing completion gate. It should not fetch or execute arbitrary verifier code declared by shared practice.

## TOPO

TOPO is not required to scan code. A person may optionally supply purpose-bound context such as known hosting controls, data sensitivity, organisational constraints or accepted risk decisions.

`@ship-check/adapters` can build a request matching TOPO's current `OosContextRequest` shape:

```ts
{
  subject,
  purpose,
  requestedBy,
  query?,
  categories?,
  keys?
}
```

The generated purpose explicitly says that context may inform interpretation but **must never override deterministic Ship Check evidence**. Ship Check should consume only a packet the person has authorised through TOPO's local sharing flow. Context belongs in a visually separate section in the desktop UI and must not silently turn a failed or incomplete check into a pass.

Ship Check does not write its scan findings into canonical TOPO memory by default. If we later support capture, it should be a separate proposal-first action with an explicit user decision.

## Organisational OS

The Organisational OS can aggregate Ship Check as technical assurance without receiving source code by default. The first adapter emits a metadata-only summary containing:

- provider and protocol;
- project reference;
- generated time;
- gate ID, outcome and threshold;
- finding counts by severity;
- check-error count.

This is deliberately less detailed than the Ship Check report. The Organisational OS may use it to compare declared organisational practice with operational assurance over time, but should not become a staff-surveillance surface or a repository-content store.

## Portable hand-off

Alpha report schema: `0.1`.

Alpha assurance-gate schema: `0.1`.

The complete JSON report is the primary evidence hand-off. Gate results are decisions over that report. Agent prompts are repair instructions, not evidence. A repair is only complete after the relevant deterministic check is rerun and the underlying evidence has changed.
