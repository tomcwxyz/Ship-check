# Architecture

Ship Check uses the same broad architectural rule as RACK and TOPO: **portable domain contracts first; interfaces are clients of those contracts**.

## Layers

`@ship-check/schemas` owns the stable interchange contract. A finding always carries a check ID, pack, severity, confidence, evidence, remediation and an agent-ready repair prompt. Reports are versioned independently from any desktop UI. The same package now owns the portable `ProjectEvidenceSource` and `ProjectSnapshot` contracts used to describe where project evidence came from and what it can establish.

`@ship-check/core` owns project inventory and orchestration. It knows how to establish the scanned source set, read bounded text safely, execute checks and assemble a validated report. It does not know about Tauri, RACK, TOPO or a hosted account. Materialised source from a local folder, transient checkout, upload, CI runner or future hosted-builder adapter therefore reaches the same checking engine.

`@ship-check/checks` owns deterministic checks. Checks should prefer direct evidence and should say when confidence is low because a control may live upstream. Model judgement is not part of the first alpha execution path. Checks may declare the evidence capabilities they require; if those capabilities are unavailable the check is `not-assessed`, never a pass.

`@ship-check/cli` is deliberately thin. It acquires/materialises a supported source, describes its provenance to the core and then invokes the same report contract used by desktop, CI and RACK verification plans.

## Project evidence model

A **project** is broader than a repository. Repository source is currently the richest implemented evidence source, but later project assurance can combine source, deployment/runtime, database, platform and CI evidence without pretending that one source establishes everything.

`ProjectEvidenceSource` records:

- evidence type (`source`, `deployment`, `database`, `platform`, `dependency` or `ci`);
- provider as an open stable identifier such as `local`, `github`, `upload` or `lovable`;
- how evidence was acquired, including local access, transient checkout, uploaded snapshot, read-only remote access, runtime probe or CI;
- where execution occurred: user device, CI runner, Ship Check managed infrastructure or an external platform;
- evidence capabilities such as `source-files`, `git-history`, `runtime-http`, `database-metadata` or `platform-metadata`;
- whether the materialised source is ephemeral, plus acquisition time and optional provider ref.

`ProjectSnapshot` binds that provenance to the concrete inventory Ship Check inspected. It deliberately does not contain source file contents. Scan reports retain the existing project fields for compatibility and add the snapshot as provenance.

The rule is **coverage follows evidence**. Existing repository checks default to requiring `source-files`. A future URL-only source can expose `runtime-http`; source checks then become `not-assessed` and assurance gates become `incomplete` rather than silently passing. Runtime checks will explicitly require runtime capabilities instead.

## Evidence rules

- Never echo detected credential values in findings.
- A check must return the concrete evidence that caused it to fire.
- Absence-of-evidence checks use lower confidence where configuration could plausibly live outside the inspected evidence source.
- A pass means only that the specific rule completed against evidence it was capable of assessing.
- Missing required evidence is `not-assessed`, not `passed` and not a fabricated finding.
- Evidence provenance remains distinct even when later source, runtime, database or platform evidence is correlated.
- Checks should be individually versionable later without breaking the report envelope.

## Local-first and cloud boundary

Local-first remains a product capability rather than a migration stage. An ordinary local scan records `local` acquisition on the user device; a GitHub CLI scan records a transient GitHub checkout on the user device. Neither requires a hosted Ship Check account.

Cloud Ship Check can build on the same contract without making hosted scanning mandatory. A cloud control plane may store permitted assurance metadata/history while execution happens locally or in CI. A later managed runner can materialise an ephemeral source and invoke the same engine while making the different execution and retention boundary explicit in provenance.

Source contents and detected secret values must not become persistent cloud report data merely because execution moves off-device.

## Desktop boundary

The desktop surface is a Tauri + React client, following the RACK/TOPO release family. It calls the same engine contract and presents evidence, repair prompts, accepted exceptions and re-check. We should not fork a second scanner implementation into the UI or create platform-specific scanner implementations for hosted builders.
