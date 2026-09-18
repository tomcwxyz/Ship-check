# Ship Check in the Organisational OS runtime experiment

Date: 2026-09-18  
Status: architectural record / experiment

The canonical cross-project decision is recorded in `tomcwxyz/Organisational-OS` RFC 0002: **AI runtime interoperability and the Orbital experiment**.

## Role

Ship Check is an independent implementation inspector.

Its question is:

> What can we inspect and verify about this project, build or implementation?

Ship Check is not the execution runtime, the canonical practice store, durable organisational memory or the long-term evidence system.

## Relationship to the Orbital fork

`tomcwxyz/Orbital` is being used as a reference runtime/proving ground.

Orbital may run Ship Check as part of a task, completion check or release workflow. Ship Check should still operate exactly as a standalone tool: the runtime is merely one caller.

Conceptually:

~~~text
Orbital task/run
      │
      ├──► build / project / artefact
      │
      └──► Ship Check
               │
               ▼
        inspection findings
               │
               ▼
             CRUX
        correlated evidence
~~~

## Relationship to RACK

RACK expresses practice such as secure-build, production-ready or cost-aware expectations.

Ship Check may provide observable evidence relevant to those practices, but a scan result is not the practice itself and must not redefine it.

A useful lineage is:

~~~text
RACK practice/version
      │
      ▼
Orbital execution
      │
      ▼
project / artefact
      │
      ▼
Ship Check inspection
      │
      ▼
CRUX evidence / receipt
~~~

## Relationship to CRUX

CRUX is the evidence plane. Ship Check is one evidence producer among potentially many scanners, eval systems, CI jobs and human reviews.

The preferred integration is a small adapter/exporter that maps a Ship Check result to a CRUX-compatible evidence envelope while preserving:

- Ship Check version;
- scan/source identity;
- time;
- pack/check identifiers;
- severity/status;
- relevant artefact/project/run correlation;
- limits and uncertainty in what was inspected.

CRUX should not need to reproduce Ship Check's scanning logic, and Ship Check should not need CRUX in order to run.

## Relationship to TOPO

Ship Check findings may become useful source evidence for durable learning, but should not silently become TOPO memory.

If a finding leads to a durable conclusion or decision, it should flow through the normal TOPO source/review path.

## Organisational OS semantics

Ship Check participates primarily through:

- **Event** — a scan/check completed or a material finding changed;
- **Object** — report, finding, inspected artefact/project reference;
- **Context** — answer bounded inspection questions where an adapter exposes them;
- **Action** — explicitly authorised scan/check requests.

## First experiment

1. Run Ship Check against a repository or artefact involved in a real Orbital task.
2. Preserve the runtime task/run identifier externally rather than changing Ship Check's canonical scan model unnecessarily.
3. Export the result as CRUX-compatible evidence.
4. Correlate the finding with any RACK practice/version that motivated the check.
5. Verify that Ship Check remains fully useful with CRUX, RACK and Orbital absent.

## Invariants

1. Ship Check remains an independent inspector.
2. A finding is evidence with provenance, not automatically organisational truth.
3. The scanner does not become the canonical RACK practice store.
4. The scanner does not become CRUX's evidence database.
5. Integration should prefer adapters/exporters over hard dependencies.
6. Findings should identify what was and was not inspected so downstream systems do not overclaim assurance.
7. Runtime correlation must not require storing private TOPO context in Ship Check.
