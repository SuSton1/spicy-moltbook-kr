# Family Hypothesis Card

- familyId: `F123`
- baselineRunId: `c3_canary_phase02_fix_20260311_112500`
- hypothesisKey: `f123_local_precision_before_agreement`
- status: `discarded`

## Direct Bottleneck

- Primary gate being targeted:
  - `AGREEMENT_CONSENSUS_LOW`
- Why this patch touches that gate directly:
  - F123 is not mainly failing on missing score threshold.
  - The family is repeatedly sending a weak top1 into the agreement check.
  - The next patch must improve the top1 candidate quality before agreement is evaluated.

## Expected Upside

- Maximum visible upside from dossier:
  - agreement-only unblock upside is small
  - score-loosening upside is unsafe because it regresses `F008`
- Why that upside is large enough to matter:
  - The useful upside is not “let rejected top1 through”.
  - The useful upside is “change which candidate becomes top1”.
  - If top1 precision rises above the current `7.41%` selection-hit level, F123 can move without opening a global escape hatch.

## Fast Falsifier

- What result would prove this idea is wrong after one replay:
  - `primaryGateReasonEval` stays `AGREEMENT_CONSENSUS_LOW`
  - and `selectionHitAt1Eval` does not improve
  - and `targetHitRateEval` stays flat or near-flat

## Preflight Result

- This card was rejected before a new replay.
- The strict rerank path does touch the ordering surface, but the current score surface blocks it.
- New dossier evidence:
  - `fallbackPassDaysIfDropBlockedTop1Eval = 0`
  - `altTradeHitDaysEval = 17`
  - alternative trade-hit candidate max score `0.5651325601650122 < minFinalScore 0.58`
- Conclusion:
  - F123 does have better agreement-clean alternatives on some days.
  - But they still die below the score floor.
  - So a strict pre-agreement rerank-only patch is not worth the replay budget.

## Blast Radius

- Expected local effect:
  - small change to top1 ordering quality for agreement-sensitive families
- Expected sentinel risk for `F008`:
  - medium
  - F008 is precision-fragile, so broad ranking shifts can hurt it
- Expected sentinel risk for `F175`:
  - low to medium
  - F175 is still dominated by deep score failure, so agreement-side effects should be smaller

## Validation Ladder

1. Read-only dossier review
2. One local ranking/agreement-quality patch
3. F123 single-family replay
4. `F008`,`F175` sentinel replay
5. Larger run only if sentinel replay stays clean

## Decision

- Keep if:
  - F123 improves `selectionHitAt1Eval` and `targetHitRateEval`
  - while `F008` and `F175` stay at or above accepted baseline behavior
- Drop if:
  - the patch only increases picked days
  - or F123 still dies on the same agreement surface with no precision lift
  - or `F008` regresses again
- Notes:
  - Do not use global score loosening for this card.
  - This card is closed.
  - The next active card should move to score-construction / debias, not rerank-only precision.
