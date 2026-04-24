# Family Hypothesis Card

- familyId: `F123`
- baselineRunId: `c3_canary_phase6_f123agfallback_tracefix_20260311_182900`
- hypothesisKey: `f123_shadow_reject_precision_guard`
- status: `validated_keeper`

## Direct Bottleneck

- Primary gate being targeted:
  - `AGREEMENT_CONSENSUS_LOW`
- Why this patch touches that gate directly:
  - After the agreement-fallback keeper, F123 still carried `20` eval picked days with:
    - `selectionPolicy.mode = EXPLOIT`
    - `gateReason = AGREEMENT_CONSENSUS_LOW`
    - `agreementFallbackApplied = false`
  - Those days were all zero-hit.
  - The patch blocks only that shadow-kept path instead of reopening score thresholds.

## Expected Upside

- Maximum visible upside from preflight:
  - remove `20` zero-hit eval picks from the denominator
  - preserve the `AGREEMENT_FALLBACK` lift that already created the real hits
- Why that upside is large enough to matter:
  - the remaining misses were concentrated in one policy path
  - sentinels did not show the same risky surface in preflight

## Fast Falsifier

- What result would prove this idea is wrong after one replay:
  - F123 `pickedDaysEval` does not drop materially
  - or `targetHitRateEval` / `executedTargetHitRateEval` stay near-flat
  - or sentinel replay regresses `F008` or `F175`

## Blast Radius

- Expected local effect:
  - only `shadow` agreement rejects with no passing fallback and `EXPLOIT` selection are blocked
- Expected sentinel risk for `F008`:
  - low
  - preflight did not show the same risky picked-day surface
- Expected sentinel risk for `F175`:
  - low
  - F175 remains dominated by deep score failure, not this shadow agreement path

## Validation Ladder

1. Read-only preflight on the Phase 6 keeper
2. One local Step-D precision guard patch
3. F123 single-family replay
4. `F008`,`F175` sentinel replay
5. Keep only if the triplet replay stays clean

## Decision

- Keep if:
  - F123 improves `targetHitRateEval` and `executedTargetHitRateEval`
  - while `F008` and `F175` stay at baseline behavior
- Drop if:
  - the patch only lowers coverage with no precision lift
  - or sentinel replay regresses
- Notes:
  - this card does not try to fix the remaining `selectionHitAt1Eval` gap
  - it only removes the bad shadow-kept tail after agreement reject

## Observed Result

- F123 single-family replay `c3_canary_phase7_f123_shadowblock_20260311_182811` validated the idea:
  - `pickedDaysEval: 37 -> 28`
  - `targetHitRateEval: 0.05405405405405406 -> 0.17857142857142858`
  - `executedTargetHitRateEval: 0.10526315789473684 -> 0.2`
  - `primaryGateReasonEval: AGREEMENT_CONSENSUS_LOW -> AGREEMENT_FALLBACK_PASS`
  - reject reason moved to `LOW_SELECTION_HIT_AT_1_EVAL`
- Wider triplet replay `c3_canary_phase7_shadowblock_triplet_20260311_182811` stayed clean:
  - `F008 targetHitRateEval = 0.2`
  - `F175 targetHitRateEval = 0`
- Remaining gap:
  - `selectionHitAt1Eval` stayed at `0.07407407407407407`
  - the next branch should address top1 metric / precision semantics above the fallback keeper
