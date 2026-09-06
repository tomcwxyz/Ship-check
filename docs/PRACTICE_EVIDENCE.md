# Practice evidence loop

Ship Check can now attach stable `practice.*` principle identifiers to deterministic checks and carry bounded evidence through the existing RACK gate result.

This is deliberately not a general code-quality score. A principle may be broader than the deterministic checks currently attached to it, so absence of findings does **not** create a principle-level pass claim.

## Initial shared vocabulary

- `practice.minimum-useful-change`
- `practice.reuse-before-new-code`
- `practice.dependency-restraint`
- `practice.fix-causes`
- `practice.context-economy`
- `practice.concise-handoff`
- `practice.preserve-safety`
- `practice.meaningful-verification`
- `practice.cost-discipline`

Honey for Devs is provenance/inspiration for several of these principles in RACK. The IDs themselves are neutral so Ship Check, RACK and future tools can remain independently installable.

## First contract test

The automated adapter test proves that a deterministic Ship Check finding linked to `practice.preserve-safety` survives into a RACK step result as `providerResult.practiceEvidence`.

## First manual cross-repository test

1. In RACK, choose the `Lean agentic coding · Honey` Starter template.
2. Confirm its Honey guardrail maps to `practice.preserve-safety`.
3. Run Ship Check against `test-fixtures/risky-next` using RACK output:

```bash
pnpm ship-check -- scan ./test-fixtures/risky-next \
  --format rack \
  --gate ship-check \
  --step-id practice-loop \
  --fail-on high
```

4. Inspect `providerResult.practiceEvidence` and confirm a safety-related deterministic finding carries `practice.preserve-safety`.
5. Repeat against one real Good Ship repository.
6. Record false positives, missing links and whether the principle-level evidence makes the repair decision clearer.

## Optional TOPO test later

TOPO may provide reviewed project context such as stage, expected lifetime, cost sensitivity or security sensitivity. Repeat the same Ship Check with and without that context and confirm the raw deterministic finding does not change. TOPO may improve interpretation; it must not rewrite evidence.
