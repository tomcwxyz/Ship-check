# Finding suppressions

Ship Check treats a suppression as an **accepted exception**, not as evidence that a concern disappeared.

Suppressions live in a tracked `.ship-check.json` file at the scanned repository root. They are deliberately narrow:

- an exact `findingId` is required;
- the exact `checkVersion` is required;
- a substantive `rationale` is required;
- suppressions apply to findings only, never to unverified controls or check errors;
- changing a check's rule version makes an older suppression stop matching automatically.

## Example

```json
{
  "schemaVersion": "0.1",
  "suppressions": [
    {
      "findingId": "cost.vercel-cron-frequency:0:/api/cron/heartbeat",
      "checkVersion": "2",
      "rationale": "This lightweight heartbeat is intentionally five-minute and invocation volume is measured."
    }
  ]
}
```

Run Ship Check without a suppression first. The CLI and desktop show the exact finding ID and rule version to use if the risk is consciously accepted.

## What a suppression changes

A matching finding moves from `findings` to `suppressedFindings` in the canonical report. Its check can have the `suppressed` status when no active finding or unverified control remains for that check.

The report keeps:

- the full original finding;
- the rule version;
- the rationale;
- the fact that the decision came from `.ship-check.json`.

Severity gates operate on active findings, so an explicitly suppressed finding does not fail the gate. RACK receives a warning that accepted exceptions exist, and Organisational OS summaries include a suppression count. The rationale and finding evidence are not copied into those metadata-only cross-product summaries.

## What a suppression does not change

A suppression does not:

- mark the underlying control verified;
- remove the finding from historical reasoning;
- silence unrelated findings from the same check;
- suppress an `unverified` evidence gap;
- survive a rule-version change without review;
- turn Ship Check into a security or compliance certification.

## Privacy and diagnostics

Desktop diagnostic history stores rule versions and suppression counts only. It does not retain suppression rationales, suppressed finding details, evidence paths/excerpts or source contents.

## Review discipline

Treat `.ship-check.json` like other repository policy. A useful rationale should explain why the exact risk is acceptable in this system now and, where relevant, what evidence or monitoring supports that decision. Avoid permanent blanket language such as `false positive` without an explanation: if the rule semantics improve, incrementing its version deliberately forces the exception to be reconsidered.
