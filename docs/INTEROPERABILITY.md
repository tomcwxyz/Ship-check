# RACK, TOPO and Organisational OS interoperability

Ship Check is useful by itself. Integration is through explicit contracts rather than shared UI code or hidden databases.

## RACK

RACK should consume Ship Check as a **verification provider**. A RACK Verification Plan can request one or more Ship Check packs, run them against the selected work-project folder, retain the structured report as deterministic evidence, and use `--fail-on` semantics for an explicit gate. RACK remains responsible for deciding which checks are required by a working practice; Ship Check remains responsible for evidence and findings.

The first bridge should be process/JSON based so the products stay independently releasable. A later library adapter is acceptable only if the schema package remains the contract boundary.

## TOPO

TOPO is not required to scan code. Later, a person may choose to supply purpose-bound context such as preferred hosting, known upstream controls or organisational constraints. That context must remain separate from repository evidence and must never silently convert an inference into a passed check.

## Organisational OS

The Organisational OS can eventually aggregate Ship Check reports as technical assurance signals: what was checked, when, which evidence-backed risks remain, and whether declared organisational practice matches deployed reality. It should not receive source code by default and should not turn Ship Check into staff surveillance.

## Portable hand-off

Alpha report schema: `0.1`.

The JSON report is the primary hand-off surface. Agent prompts are repair instructions, not evidence. A repair is only complete after the relevant deterministic check is rerun and the underlying evidence has changed.
