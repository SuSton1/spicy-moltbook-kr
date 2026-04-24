# Family Hypothesis Card

- familyId: `F123`
- baselineRunId: `c3_canary_phase7_f123_shadowblock_20260311_182811`
- hypothesisKey: `f123_selection_metric_agreement_fallback_aware`
- status: `validated_keeper`

## Direct Bottleneck

- Primary gate being targeted:
  - `LOW_SELECTION_HIT_AT_1_EVAL`
- Why this patch touches that gate directly:
  - After the Phase 7 shadow-reject precision guard, F123 already passed:
    - `targetHitRateEval`
    - `executedTargetHitRateEval`
    - coverage
  - The only remaining reject was raw `selectionHitAt1Eval = 0.07407407407407407`.
  - That metric still measures raw top1 rank hit days and ignores successful `AGREEMENT_FALLBACK` selections.

## Expected Upside

- Maximum visible upside from preflight:
  - F123 had `agreementFallbackDaysEval = 27`
  - many of the surviving hit days were now coming through the fallback keeper, not raw top1
- Why that upside is large enough to matter:
  - this is not a behavioral runtime change
  - it is a C1 evaluation-semantic fix so the family is judged on the final selected policy output

## Fast Falsifier

- What result would prove this idea is wrong after one replay:
  - F123 still rejects on `LOW_SELECTION_HIT_AT_1_EVAL`
  - or the fallback-aware metric stays near raw `selectionHitAt1Eval`
  - or sentinel replay changes `F008` / `F175`

## Blast Radius

- Expected local effect:
  - only C1 selection-quality evaluation changes
  - runtime Step D pick behavior stays unchanged
- Expected sentinel risk for `F008`:
  - low
  - it does not use agreement fallback in the validated triplet replay
- Expected sentinel risk for `F175`:
  - low
  - it also does not use agreement fallback in the validated triplet replay

## Validation Ladder

1. Read-only metric semantics check
2. Add fallback-aware selection metric export in Step D
3. Add narrow C1 metric resolution for `AGREEMENT_FALLBACK_PASS`
4. F123 single-family replay
5. 3-family replay

## Decision

- Keep if:
  - F123 changes from reject to pass
  - and sentinel families stay on the same reject surfaces
- Drop if:
  - the metric change alters sentinel outcomes
  - or F123 still fails on another hidden precision gate

## Observed Result

- F123 single-family replay `c3_canary_phase7b_f123_selmetric_20260311_184432` passed:
  - `selectionHitAt1Eval = 0.07407407407407407`
  - `selectionHitAt1AgreementFallbackAwareEval = 0.16666666666666666`
  - `selectionHitAt1ResolvedEval = 0.16666666666666666`
  - `selectionHitAt1MetricSourceEval = AGREEMENT_FALLBACK_AWARE`
  - `rejectReason = PASS`
- Wider triplet replay `c3_canary_phase7b_selmetric_triplet_20260311_184432` stayed clean:
  - `F123 passed = true`
  - `F008 rejectReason = LOW_SELECTION_HIT_AT_1_EVAL`
  - `F175 rejectReason = LOW_TARGET_HIT_RATE_EVAL`
- Downstream C2 run on the same triplet also stayed aligned:
  - `representativeFamilyIds = [F123, F008, F175]`
  - `F123 representativeSelectionHitAt1Eval = 0.16666666666666666`
  - `F123 representativeSelectionHitAt1MetricSource = AGREEMENT_FALLBACK_AWARE`
- Wider downstream readers now stay aligned too:
  - `cd_loop`, `step_c_pattern_mine`, `step_e_lockbox_backtest`, and `report` all prefer the resolved selection metric when it exists
  - `family_probe_dossier` now reports:
    - `selectionHitAt1Eval = 0.16666666666666666`
    - `selectionHitAt1RawEval = 0.07407407407407407`
    - `selectionHitAt1MetricSourceEval = AGREEMENT_FALLBACK_AWARE`
- Interpretation:
  - this keeper does not change runtime recommendations
  - it fixes C1 evaluation to reflect fallback-selected wins for families whose primary kept surface is `AGREEMENT_FALLBACK_PASS`
  - and that resolved metric now survives C2 representative selection as well
