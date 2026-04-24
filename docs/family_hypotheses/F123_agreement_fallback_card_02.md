# Family Hypothesis Card

- familyId: `F123`
- baselineRunId: `c3_canary_phase02_fix_20260311_112500`
- hypothesisKey: `f123_agreement_fallback_after_blocked_top1`
- status: `validated_keeper`

## Direct Bottleneck

- Primary gate being targeted:
  - `AGREEMENT_CONSENSUS_LOW`
- Why this patch touches that gate directly:
  - F123 has many eval days where top1 is blocked by agreement.
  - On those days, the current system clears the pick entirely instead of retrying the remaining pool.
  - Preflight shows that removing the blocked top1 and re-evaluating the remaining pool would already create legal fallback picks.

## Expected Upside

- Maximum visible upside from dossier:
  - `fallbackPassDaysIfDropBlockedTop1Eval = 34`
  - `fallbackHitDaysIfDropBlockedTop1Eval = 7`
  - `altTradeHitDaysEval = 26`
- Why that upside is large enough to matter:
  - This is not a tiny one-day edge case.
  - The family already contains recoverable alternative picks under the current score gate.
  - The missing piece is the fallback selection policy after an agreement-blocked top1.

## Fast Falsifier

- What result would prove this idea is wrong after one replay:
  - F123 still shows `AGREEMENT_CONSENSUS_LOW` as the main eval gate
  - and `pickedDaysEval` / `targetHitRateEval` do not move
  - and fallback selections do not appear in the ordering / selection trace

## Blast Radius

- Expected local effect:
  - only agreement-blocked top1 days should try an alternative candidate
- Expected sentinel risk for `F008`:
  - medium
  - F008 is precision-fragile, so a bad fallback can hurt it
- Expected sentinel risk for `F175`:
  - low to medium
  - F175 is still more dominated by deep score failure than agreement blocking

## Validation Ladder

1. Read-only dossier review
2. One local agreement-fallback patch
3. F123 single-family replay
4. `F008`,`F175` sentinel replay
5. Larger run only if sentinel replay stays clean

## Decision

- Keep if:
  - F123 improves `pickedDaysEval`, `selectionHitAt1Eval`, and `targetHitRateEval`
  - while `F008` and `F175` stay at or above accepted baseline behavior
- Drop if:
  - the patch only creates extra picks with no hit-rate lift
  - or the fallback path is almost never used in replay
  - or `F008` regresses again
- Notes:
  - Do not reopen broad `scoreRecovery` or global threshold loosening for this card.
  - Start with `AGREEMENT_CONSENSUS_LOW` only.

## Observed Result

- First replay failed because the implementation was tied to the currently selected row instead of the blocked top1.
- Corrected replay `c3_canary_phase6_f123agfallback_keeptrace3_20260311_181500` produced a real lift:
  - `targetHitRateEval: 0 -> 0.05405405405405406`
  - `executedTargetHitRateEval: 0 -> 0.10526315789473684`
  - `selectionPolicy.mode = AGREEMENT_FALLBACK` on `38` days
- Sentinel replay `c3_canary_phase6_agfallback_sentinels_20260311_181900` stayed clean:
  - `F008 targetHitRateEval = 0.2` unchanged
  - `F175 targetHitRateEval = 0` unchanged
- Remaining gap:
  - `selectionHitAt1Eval` did not move because it still reflects the original top1 candidate

## Trace Follow-up

- Replay `c3_canary_phase6_f123agfallback_tracefix_20260311_182900` kept the same behavior and fixed the missing export path.
- D1 / D2 audit rows now flatten:
  - `agreementFallbackApplied`
  - `agreementFallbackReason`
  - `agreementFallbackChosenRank`
  - `agreementFallbackBlockedSymbol`
- Step D summary now exposes fallback-specific counters, so the card is observable without custom log parsing.

## Wider Validation

- 3-family replay `c3_canary_phase6_agfallback_triplet_20260311_183800` kept the same F123 lift.
- Sentinel behavior remained clean in that replay:
  - `F008 targetHitRateEval = 0.2`
  - `F175 targetHitRateEval = 0`
- Current interpretation:
  - this card is safe enough to keep
  - the next branch should not re-prove the fallback itself
  - the next branch should attack the remaining precision gap beyond fallback
