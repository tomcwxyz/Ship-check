# Architecture

Ship Check uses the same broad architectural rule as RACK and TOPO: **portable domain contracts first; interfaces are clients of those contracts**.

## Layers

`@ship-check/schemas` owns the stable interchange contract. A finding always carries a check ID, pack, severity, confidence, evidence, remediation and an agent-ready repair prompt. Reports are versioned independently from any desktop UI.

`@ship-check/core` owns repository inventory and orchestration. It knows how to establish the scanned source set, read bounded text safely, execute checks and assemble a validated report. It does not know about Tauri, RACK, TOPO or a hosted account.

`@ship-check/checks` owns deterministic checks. Checks should prefer direct repository evidence and should say when confidence is low because a control may live upstream. Model judgement is not part of the first alpha execution path.

`@ship-check/cli` is deliberately thin. The same report object must be usable by the future desktop application and by RACK verification plans.

## Evidence rules

- Never echo detected credential values in findings.
- A check must return the concrete evidence that caused it to fire.
- Absence-of-evidence checks use lower confidence where configuration could plausibly live outside the repository.
- A pass means only that the specific rule did not fire against the inspected source set.
- Checks should be individually versionable later without breaking the report envelope.

## Local-first boundary

The alpha performs no network calls and requires no model provider. A future managed explanation/judgement layer must be optional and must not be required to produce the deterministic report.

## Desktop boundary

The desktop surface will be a Tauri + React client, following the RACK/TOPO release family. It should call the same engine contract and present one finding at a time with evidence, repair prompt, dismiss/accept state and re-check. We should not fork a second scanner implementation into the UI.
