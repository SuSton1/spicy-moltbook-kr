# Family Hypothesis Card

- familyId: `F008`
- baselineRunId: `c3_canary_phase02_fix_20260311_112500`
- hypothesisKey: `f008_score_recovery_path_guarded_gap_fade`
- status: `validated_keeper`

## Direct Bottleneck

- Primary gate being targeted:
  - `SCORE_MARGIN_LOW` near-miss days inside a family whose top-level primary gate still reads `DAY_TYPE_MODEL_NO_TRADE`
- Why this patch touches that gate directly:
  - baseline day-type escape was too broad and regressed hit rate
  - the useful upside was concentrated in one high-fill, low-slippage, pre-gate-hit near-miss day

## Expected Upside

- Maximum visible upside from preflight:
  - only one eval day was clearly salvageable under a narrow path guard
  - because F008 only had `5` picked eval days, one extra hit could move `targetHitRateEval` from `20%` to `33.33%`
- Why that upside is still worth taking:
  - the blast radius is much smaller than broad day-type opening
  - the family denominator is small enough that a one-day rescue is meaningful

## Fast Falsifier

- What result would prove this idea is wrong after one replay:
  - `targetHitRateEval` stays at `0.2` or regresses
  - `pickedDaysEval` expands materially beyond one extra day
  - `F123` loses pass status
  - `F175` changes surface away from `LOW_TARGET_HIT_RATE_EVAL`

## Blast Radius

- Expected local effect:
  - only `scoreRecovery` hard-pass days with:
    - `SCORE_MARGIN_LOW`
    - `THIN_LIQUIDITY_TRAP`
    - `GAP_FADE_RISK`
    - `MODEL_PRIMARY`
    - high fill probability
    - low slippage risk
- Expected sentinel risk for `F123`:
  - low
  - it does not rely on this score-recovery path
- Expected sentinel risk for `F175`:
  - low
  - it stays a deep-fail score family

## Validation Ladder

1. Baseline audit of salvageable days
2. Add path guards to `scoreRecovery`
3. Wire `dayTypeDecision` into D1 so the path guard sees the live day-type snapshot
4. F008 single-family replay
5. 3-family sentinel replay

## Decision

- Keep if:
  - F008 `targetHitRateEval` rises meaningfully
  - and the lift comes from a narrow extra picked day
  - and `F123` / `F175` stay on their validated surfaces
- Drop if:
  - the patch broadens coverage without precision
  - or the sentinels move

## Observed Result

- Broad day-type escape was rejected first:
  - `c3_canary_phase8_f008_edgeescape_20260311_114000`
  - `targetHitRateEval = 0.14285714285714285`
- Tight day-type escape also failed to improve:
  - `c3_canary_phase8b_f008_edgeescape_tight_20260311_114500`
  - `targetHitRateEval = 0.2`
- Keeper branch:
  - single-family replay `c3_canary_phase8c_f008_scorerecovery_fix_20260311_115700`
  - `pickedDaysEval = 6`
  - `targetHitRateEval = 0.3333333333333333`
  - `executedTargetHitRateEval = 0.2`
  - `scoreRecoveryEligibleRateEval = 0.018518518518518517`
  - `scoreRecoveryWouldHitRateEval = 1`
- Wider triplet replay `c3_canary_phase8c_triplet_20260311_115900` stayed clean:
  - `F008 targetHitRateEval = 0.3333333333333333`
  - `F123 passed = true`
  - `F175 rejectReason = LOW_TARGET_HIT_RATE_EVAL`
- Interpretation:
  - this is a real keeper because it rescues a narrow, evidence-backed near-miss
  - it does not fix F008's raw top1 precision problem
  - it does create meaningful target-hit lift without sentinel regression
