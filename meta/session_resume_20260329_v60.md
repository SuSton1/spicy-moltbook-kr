# 2026-03-29 Session Resume For Next Chat

## Read This First
- `/home/saida/code/stockdesk-lab-lite/meta/active_research_contract.json`
- `/home/saida/code/stockdesk-lab-lite/meta/active_research_handoff.md`
- `/home/saida/code/stockdesk-lab-lite/meta/live_priority_ops_contract.md`
- `/home/saida/code/stockdesk-lab-lite/meta/experiment_patch_memory.json`
- `/home/saida/code/stockdesk-lab-lite/meta/experiment_registry.jsonl`

Before any new target-first experiment:
- `bash tools/bootstrap_target_first_session.sh --scope=target_first_v2`
- `bash tools/check_duplicate_experiment.sh --patch-key=<INTENDED_PATCH_KEY>`

## Current State
- Latest local `npm run verify`: passed on `2026-03-29`
- Latest server `npm run verify`: passed on `2026-03-29`
- Latest registered experiment:
  - `perfect_proto_1d_top_mid_low_failure_bank_oos_report_v59a`
  - status: `invalid_or_inconclusive`
  - run id:
    - `perfect_proto_1d_top_mid_low_failure_bank_oos_report_v59a_probe200k_r3_20260329`

## What Was Proven

### 1. Broad daily-OHLCV-only recovery line is exhausted
- `v55`, `v56`, `v57`, `v58` are effectively hard-stopped.
- Key reasons:
  - `v55`: train breadth existed but exact winner bank collapsed
  - `v56`: symbolic micro-card diversity collapsed
  - `v57`: diversity recovered but only tiny perfect pockets remained
  - `v58`: support-like archetype collapsed into one dominant archetype
- Do not reopen:
  - `v55`
  - `v56`
  - `v57`
  - `v58`

### 2. `v59a` fixed the train breadth / fold accounting root cause
- `v59a` pilot:
  - `TOP x 1D`
  - `MID x 1D`
  - `LOW x 1D`
- Latest verified `r3` result:
  - train folds are now valid:
    - `TOP`: `651 rows / 171 dates / 24 months / 4 folds`
    - `MID`: `478 rows / 133 dates / 24 months / 4 folds`
    - `LOW`: `935 rows / 131 dates / 24 months / 4 folds`
- `failure bank` and `veto bank` mined successfully in every cell
- But:
  - `positiveQualifiedCellCount = 0`
  - all cells remained `unsat_positive_bank_train_breadth`
- Best positive candidates were still too small:
  - `TOP`: `2 dates / 2 months / 2 folds`
  - `MID`: `5 dates / 5 months / 4 folds`
  - `LOW`: `3 dates / 3 months / 2 folds`
- Result:
  - OOS comparison `positive only -> +failure -> +veto` was emitted
  - but every stage selected `0` rows because the positive-bank union was empty
  - so `failure/veto` precision lift could not be meaningfully evaluated

### 3. The core unresolved problem
- The issue is no longer ingest, folds, or report plumbing.
- The real blocker is:
  - no regime-local `1D` positive bank has enough breadth to be promotable
- Current data pattern:
  - large exact rules do not appear
  - only small exact pockets appear
  - broadening destroys purity

## Important Conclusions

### A. Do not jump straight to `20M`
- `20M` is not the next answer.
- It should be used only after a short probe proves a viable cell / family.
- Correct escalation order:
  - `200K`
  - `2M`
  - `20M`

### B. Do not reopen a broad mixed line
- Do not mix `LOW/MID/TOP` inside the same recovery search again.
- Do not use broad `same_day_plus_recent_upto_Nd` as a rescue line for `LOW` or `MID`.
- `LOW` and `MID` must be searched family-locally.

### C. Small exact rules cannot be trusted by default
- A `2/2` or `3/3` rule is not success.
- Any future exact rule must be accepted only if it is:
  - stable across resamples
  - significant after multiple-testing control
  - broad enough at union level

### D. Failure/veto overlays must never become hidden fallback
- Overlay diagnostics are allowed.
- Auto-promotion from an exact-track failure into an overlay-track “success” is forbidden.
- Exact discovery and overlay diagnostics must stay physically separate.

## Best Next Move

Run a two-track campaign, but keep the tracks physically separate.

### Track A: Exact discovery
Patch key:
- `perfect_proto_low_1d_recent_significant_episode_exact_bank_v60a`

Goal:
- search only `LOW 1D recent-only`
- use episode-pattern representation instead of literal prototype cards
- accept only stable and significant exact rules
- allow a small union only if union-level breadth is valid

Scope:
- `recent_impulse_upto_1d x low_gap_top_continuation`
- `recent_impulse_upto_1d x low_gap_high_continuation`
- `recent_impulse_upto_1d x low_jump_below_continuation`

Representation direction:
- use episode tokens such as:
  - squeeze
  - release
  - dryup
  - sponsor
  - reject
  - accept
  - false_release
- avoid hard one-hot prototype assignment as the primary representation

Hard acceptance ideas:
- exact rule:
  - `precision = 1.0`
  - `crossfitNegativeWindowCount = 0`
  - stable across resamples
  - significant after multiple-testing correction
- union:
  - `unionMatchedDateCount >= 10`
  - `unionMatchedMonthCount >= 6`
  - `unionMatchedFoldCount = 4`
  - `union precision = 1.0`

Escalation:
- `200K` first
- only one winning `LOW@1D` line goes to `2M`
- only the same surviving line goes to `20M`

### Track B: Overlay diagnostic
Patch key:
- `perfect_proto_live_line_failure_veto_overlay_report_v60b`

Goal:
- do not discover new positive rules
- evaluate whether `failure/veto` overlays improve OOS on existing frozen live lines

Important rule:
- Track B is diagnostic only
- it must not be used as hidden fallback for Track A

OOS comparison order:
- `positive only`
- `positive + failure`
- `positive + failure + veto`

If positive engine is invalid or empty:
- overlay result must be marked `invalid_or_inconclusive`

## Hard Do-Not-Repeat
- Do not reopen:
  - `v55`
  - `v56`
  - `v57`
  - `v58`
- Do not rerun the exact `v59a` configuration unchanged
- Do not mix Haesung acceptance into the next pilot
- Do not let Track B become fallback promotion for Track A
- Do not treat tiny perfect pockets as success

## Haesung / Support Policy
- `076610` remains:
  - excluded from fit
  - excluded from seed selection
  - excluded from scaling / calibration
- Haesung should come back only as acceptance / recovery after the architecture is validated

## If Track A Fails
- If `v60a` cannot produce a valid stable/significant exact union:
  - conclude that daily OHLCV-only exact discovery is near-exhausted
  - do not keep retuning the same line
- Then the technically defensible fallback objective is:
  - high-precision shortlist
  - plus exact failure/veto suppression
- But that objective must be reported as a different goal, not as exact success

## Practical Restart Hint
If a fresh chat asks “continue from here”, start from:
- this file:
  - `/home/saida/code/stockdesk-lab-lite/meta/session_resume_20260329_v60.md`
- then confirm:
  - `active_research_handoff.md`
  - `live_priority_ops_contract.md`
  - `experiment_patch_memory.json`
- then choose:
  - `v60a` exact discovery first
  - `v60b` overlay diagnostic second
