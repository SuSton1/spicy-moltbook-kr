# TP12 No-Stop Lookback Ladder Future Plan

## Purpose

This document freezes the deferred follow-up branch for `12% no-stop` selection after the current
`LOW_GAP_TOP / recent_impulse_1d / TP12 no-stop` rolling branch is fully scored.

The goal is not to brute-force every `lookback x scope` cell at once. The goal is to widen one axis
at a time so later work can answer a clean question:

- does wider recent-impulse lookback improve `12% no-stop` selection under the same source family?
- if yes, which lookback wins without collapsing OOS support or concentrating on a few dates?
- only after that, does widening scope beyond `LOW_GAP_TOP` add anything real?

## Current Status

- deferred backlog only
- not active until the current `1d` rolling branch is closed
- do not start this branch before:
  - the current `LOW_GAP_TOP / recent_impulse_1d / TP12 no-stop` rolling screen is complete
  - the untouched final confirm on `2025-01-02 ~ 2026-03-27` is judged
  - the branch result is written to handoff and experiment memory

## Scaffold Status

The ladder is now scaffolded and resumable.

- contract:
  - `/home/saida/code/stockdesk-lab-lite/meta/tp12_no_stop_lookback_ladder_contract.json`
- derived candidate builder:
  - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_no_stop_lookback_ladder_candidate_contract.mjs`
- orchestrator:
  - `/home/saida/code/stockdesk-lab-lite/tools/run_stepb_tp12_no_stop_lookback_ladder.sh`
- server wrapper:
  - `/home/saida/code/stockdesk-lab-lite/tools/server_run_stepb_tp12_no_stop_lookback_ladder.sh`
- summary builder:
  - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_no_stop_lookback_ladder_summary.mjs`
- summary wrapper:
  - `/home/saida/code/stockdesk-lab-lite/tools/run_tp12_no_stop_lookback_ladder_summary.sh`

No ladder mining run has been executed yet. This is scaffolding only.

## Why Not Run `1d~12d x TOP/MID/LOW` Immediately

- current recent-impulse infra ceiling is `8d`, not `12d`
- broad TP12 exact-search families already have multiple hard-stop histories
- simultaneous `lookback x scope` expansion multiplies false-positive risk
- existing evidence says `LOW_GAP_TOP` is the strongest TP12 source family, so scope should stay fixed first
- lookback expansion must be judged under the same signal family before opening additional families

## Branch Contract

- objective:
  - discover whether a wider recent-impulse window beats the frozen `1d` no-stop supplier under the same TP12 no-stop contract
- fixed source family:
  - `scopeId = LOW_GAP_TOP`
- fixed evaluation contract:
  - primary label `tp12_no_stop_hit_3d`
  - secondary label `tp12_no_stop_hit_4d`
- fixed entry semantics:
  - `NEXT_DAY_OPEN`
- fixed target:
  - `targetPct = 0.12`
- fixed stop policy:
  - `stopLossPct = 0`
- forbidden comparison metrics:
  - `HIGH8`
  - `close28`
  - `TP12 / SL4 / 3d stop-first`

## Expansion Philosophy

Phase order matters.

1. fix scope, widen lookback
2. confirm a winning lookback
3. only then widen scope with that winning lookback
4. only after `8d` evidence is green consider infra expansion to `9d~12d`

Do not open `TOP/MID/LOW` and `1d~Nd` at the same time.

## Phase 1: Sparse Lookback Ladder Screen

Start with a sparse ladder under `LOW_GAP_TOP` only.

- candidate lookbacks:
  - `recent_impulse_upto_1d`
  - `recent_impulse_upto_2d`
  - `recent_impulse_upto_3d`
  - `recent_impulse_upto_5d`
  - `recent_impulse_upto_8d`
- reason:
  - this is enough to see directionality without paying the full multiple-testing cost of `1d..8d`
- budget:
  - `200K` screen only
- rolling windows:
  - W1 train `2016-08-12 ~ 2018-12-31`, OOS `2019-01-02 ~ 2019-12-31`
  - W2 train `2017-01-02 ~ 2019-12-31`, OOS `2020-01-02 ~ 2020-12-31`
  - W3 train `2018-01-02 ~ 2020-12-31`, OOS `2021-01-04 ~ 2021-12-30`
  - W4 train `2019-01-02 ~ 2021-12-31`, OOS `2022-01-03 ~ 2022-12-29`
  - W5 train `2020-01-02 ~ 2022-12-30`, OOS `2023-01-02 ~ 2023-12-28`
  - W6 train `2021-01-04 ~ 2023-12-29`, OOS `2024-01-02 ~ 2024-12-27`

## Phase 2: Dense Fill Only If Sparse Ladder Is Green

Only if Phase 1 shows a real trend should the ladder be filled in.

- eligible dense-fill lookbacks:
  - `4d`
  - `6d`
  - `7d`
- dense fill is allowed only when:
  - at least one wider lookback beats `1d` on primary OOS quality and breadth
  - no early window collapse is observed
  - the improvement is not explained by one or two dates
- dense fill remains:
  - `LOW_GAP_TOP` only
  - `200K` screen only

## Phase 3: Winner Confirm

Take only the winning lookback from Phase 1 or 2 into full confirm.

- train:
  - `2016-08-12 ~ 2024-12-27`
- untouched OOS:
  - `2025-01-02 ~ 2026-03-27`
- budget:
  - `20M`
- outputs:
  - frozen catalog
  - final confirm summary
  - final confirm report

Do not carry two or three lookbacks into final confirm unless the screen result is genuinely tied and
the tie cannot be broken by breadth or concentration diagnostics.

## Phase 4: Scope Expansion Only After Winner Confirm

Only after a winning lookback survives final confirm may scope expansion begin.

Scope expansion order:

1. `LOW_GAP_TOP`
2. `LOW`
3. only if justified, `MID`
4. only if justified, `TOP`

Rules:

- never expand all scopes together in the first pass
- keep the winning lookback fixed during scope expansion
- compare each wider scope directly against the winner scope, not against unrelated older baselines

## Phase 5: Optional `9d~12d` Infra Expansion

This phase is forbidden unless `8d` or a nearby winner materially improves over `1d`.

Required preconditions:

- existing `1d..8d` ladder shows stable OOS benefit from wider lookback
- final confirm remains green on untouched `2025-01-02 ~ 2026-03-27`
- there is a written reason for why `9d~12d` is worth the infra cost

Required patch before any experiment:

- raise the current recent-impulse ceiling from `8d` to `12d`
- update contract validators
- update wrappers and smokes
- update leaderboard/report code that assumes `8d`
- pass server `npm run verify`

## Promotion Criteria

A wider lookback is promotable only if all of the following are true.

- primary metric:
  - OOS `tp12_no_stop_hit_3d` quality is better than or credibly tied with `1d`
- breadth:
  - at least `4/6` screen windows have non-degenerate OOS selected rows
- date diversity:
  - repeated OOS hit dates appear across multiple windows
- concentration:
  - `top1DateShare` does not show one-date dependence
- support:
  - early windows do not collapse to near-zero usable support
- robustness:
  - `tp12_no_stop_hit_4d` does not contradict the primary conclusion

## Fail Conditions

Stop the branch immediately if any of these happen.

- W1 and W2 both collapse to near-zero usable support
- wider lookback wins only by shrinking coverage to trivial size
- OOS improvement comes from one concentrated date cluster
- dense fill is proposed before sparse ladder results are judged
- scope expansion is proposed before winner confirm closes
- `HIGH8`, `close28`, or stop-first metrics are used as the reason to promote a wider lookback

## Artifacts To Add Later

These are future implementation items, not active patch requirements yet.

- new contract:
  - `meta/tp12_no_stop_lookback_ladder_contract.json`
- new helper lib:
  - `src/lib/tp12_no_stop_lookback_ladder_contract.mjs`
- new screen wrapper:
  - `tools/run_stepb_tp12_no_stop_lookback_ladder.sh`
- new server wrapper:
  - `tools/server_run_stepb_tp12_no_stop_lookback_ladder.sh`
- new per-lookback summary builder:
  - `tools/build_tp12_no_stop_lookback_ladder_report.mjs`
- optional final-confirm wrapper:
  - `tools/server_run_stepb_tp12_no_stop_lookback_confirm.sh`

## Run Naming Convention

Reserve a clean naming pattern for later work.

- sparse screen:
  - `tp12_no_stop_low_gap_top_lb_ladder_screen_v1_<date>_lb<Nd>`
- dense fill:
  - `tp12_no_stop_low_gap_top_lb_ladder_fill_v1_<date>_lb<Nd>`
- final confirm:
  - `tp12_no_stop_low_gap_top_lb_confirm_v1_<date>_lb<Nd>`
- scope expansion:
  - `tp12_no_stop_scope_expand_v1_<date>_<scope>_lb<Nd>`

## Minimal Resume Checklist

When this branch is reopened later, do these first.

1. re-read:
   - `meta/active_research_contract.json`
   - `meta/active_research_handoff.md`
   - `meta/experiment_patch_memory.json`
2. verify the current `1d` rolling branch verdict is already frozen
3. run:
   - `bash tools/bootstrap_target_first_session.sh --scope=target_first_v2`
4. run duplicate check with the real patch key for the reopened branch
5. start with sparse ladder only:
   - `1d`
   - `2d`
   - `3d`
   - `5d`
   - `8d`
6. do not open dense fill, scope expansion, or `12d` infra work in the same turn

## Status Line

Saved as deferred future work on `2026-04-07` so the branch can be resumed later without rebuilding the reasoning from scratch.
