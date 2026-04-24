# TP12 No-Stop Deep Patch Plan

## Strategic Freeze

- freeze all new exact-search work under `TP12 / SL4 / 3d`
- freeze stop-first evaluation as the main research path for the current branch
- force the branch to prove the signal on `no-stop` TP12 targets first
- treat execution policy as a separate downstream learning problem
- do not open buy / sell / stop deep-learning until the no-stop scientific comparison is closed

## Why This Freeze Is Mandatory

- `LOW_GAP_TOP` is already the strongest source family
- touch-side evidence shows the `12%` mover signal exists
- repeated exact rules collapse when the branch is forced through the current clean `TP12 / SL4 / 3d` contract
- execution-policy tuning before no-stop signal proof would hide whether the signal exists or whether the policy is only masking it

## Current Critical Path

### Phase 1: Freeze The Scientific No-Stop Baseline

Goal:

- close one machine-readable, full-period `daily_only_no_stop` baseline and compare side-daily variants against it

Required outputs:

- one full-period `LOW_GAP_TOP` downstream pack covering `2016-08-12 ~ 2026-03-30`
- one exact full-period allowlist
- one exact full-period Step A manifest
- one frozen scientific-control bundle with:
  - `daily_only_no_stop`
  - `daily_plus_investor`
  - `daily_plus_program`
  - `daily_plus_investor_program`
- one scientific comparison report on that frozen bundle

Acceptance gate:

- the baseline variant and every side-daily variant are scored on the same frozen comparison contract
- both `common-support` and `deployment` views exist
- no execution-policy logic is used as the primary justification for signal existence

### Phase 2: Decide Which Side Families Actually Help

Goal:

- decide whether `investor_daily` and `program_daily` add real predictive lift on top of the same no-stop baseline

Rules:

- no family gets promoted on coverage shrinkage alone
- no family gets promoted without both views beating or justifying tradeoffs against `daily_only_no_stop`
- `trade_strength_daily` stays conditional until its historical floor is proven on the exact slice

Outputs:

- one comparison verdict per family variant
- one written promotion or rejection decision
- one frozen best additive family set for downstream use

### Phase 3: Prepare Execution Learning Inputs, But Do Not Train Yet

Goal:

- prepare a clean donor cohort and learning-ready labels without contaminating the signal stage

Precondition:

- the branch must first decide whether the existing supplier remains acceptable
- if the intended target is a true `12% no-stop` supplier rather than the current frozen baseline, open and score a sibling rolling-selection branch before policy learning

Allowed work:

- export the frozen no-stop donor cohort
- define downstream action labels for:
  - entry timing
  - hold horizon
  - stop activation delay
  - stop width
  - abstain
- define training / validation / recent replay splits
- define feature provenance and leakage rules

Not allowed yet:

- no policy model training
- no production execution-policy promotion
- no reopening `SL4` exact-rule tuning to compensate for a weak signal stage

### Phase 4: Downstream Deep-Learning Execution Policy

Only after Phase 1 and Phase 2 are green:

- train buy / sell / stop models on the frozen donor cohort
- compare learned execution policy against fixed menus on identical candidate support
- optimize practical operating zones such as:
  - delayed-stop activation
  - extended hold windows
  - abstain zones
  - volatility-conditioned stop width

Success condition:

- execution models improve realized operating metrics without redefining the original no-stop signal substrate

## Immediate Patch Bundles

### Bundle A: Full-Period Scientific Input Closure

- rebuild the missing full-period downstream `LOW_GAP_TOP` pack
- freeze the allowlist and manifest on that pack
- write `pipeline_summary.json` for the scientific-control bundle

### Bundle B: First Scientific Comparison

- bind frozen selected-row artifacts into one `selection_manifest.json`
- score the first scientific comparison report
- record the verdict in handoff and experiment memory

### Bundle C: Additive Family Promotion Decision

- decide whether `investor_daily`
- `program_daily`
- or `investor_daily + program_daily`
- are promotable over `daily_only_no_stop`

### Bundle D: Downstream Execution-Learning Design Only

- define donor export contract
- define label schema
- define training objective and replay protocol
- do not train until Bundle B and Bundle C are green

### Bundle E: 12% No-Stop Rolling Selection Branch

- open one sibling machine-readable contract for:
  - `LOW_GAP_TOP`
  - `recent_impulse_1d`
  - `TP12 no-stop`
- keep the frozen scientific baseline untouched:
  - `daily_only_no_stop`
  - `daily_plus_investor`
  - `daily_plus_program`
  - `daily_plus_investor_program`
- define explicit rolling windows:
  - W1 train `2016-08-12 ~ 2018-12-31`, OOS `2019-01-02 ~ 2019-12-31`
  - W2 train `2017-01-02 ~ 2019-12-31`, OOS `2020-01-02 ~ 2020-12-31`
  - W3 train `2018-01-02 ~ 2020-12-31`, OOS `2021-01-04 ~ 2021-12-30`
  - W4 train `2019-01-02 ~ 2021-12-31`, OOS `2022-01-03 ~ 2022-12-29`
  - W5 train `2020-01-02 ~ 2022-12-30`, OOS `2023-01-02 ~ 2023-12-28`
  - W6 train `2021-01-04 ~ 2023-12-29`, OOS `2024-01-02 ~ 2024-12-27`
  - untouched final confirm train `2016-08-12 ~ 2024-12-27`, OOS `2025-01-02 ~ 2026-03-27`
- rerun exact `LOW_GAP_TOP` mining only:
  - screen windows at `200K`
  - final confirm at `20M`
- keep the primary metric on:
  - `tp12_no_stop_hit_3d`
- keep the secondary robustness metric on:
  - `tp12_no_stop_hit_4d`
- emit:
  - per-window source-pack provenance
  - per-window mining/report summary
  - one rolling aggregate summary and markdown report
- do not promote from the rolling screen alone:
  - untouched `2025-01-02 ~ 2026-03-27` confirm must remain separate

## Hard Stops

- fail the branch if someone reopens broad or narrow `TP12 / SL4 / 3d` exact-search tuning as the main path
- fail the branch if stop-first or delayed-stop metrics are used to claim signal existence before the no-stop scientific comparison closes
- fail the branch if buy / sell / stop deep-learning starts before the no-stop baseline and additive family comparison are both frozen
- fail the branch if wider Step A expansion starts before `LOW_GAP_TOP` itself is scientifically scored
- fail the branch if `HIGH8 / close28` metrics are mixed into a new `12% no-stop selection` promotion claim
- fail the branch if a new `12% no-stop` selection run overwrites or mutates the existing scientific-control root

## Operational Next Step

Keep the existing scientific-control root frozen. If a true `12% no-stop` supplier is still desired, the next operational step is not to retune `TP12 / SL4 / 3d`; it is to open the sibling rolling-selection branch, score the six screen windows, and then run the untouched final confirm.

## Deferred Follow-Up: Lookback Ladder Expansion

If the `recent_impulse_1d` rolling branch closes cleanly and the team still wants a wider `12% no-stop`
supplier search, do not jump straight to `1d~12d x TOP/MID/LOW`.

Use the deferred future plan instead:

- path:
  - `/home/saida/code/stockdesk-lab-lite/docs/tp12_side_daily_no_stop_lookback_ladder_future_plan.md`
- first action:
  - keep `scopeId = LOW_GAP_TOP` fixed
  - widen only recent-impulse lookback
- initial screen ladder:
  - `1d`
  - `2d`
  - `3d`
  - `5d`
  - `8d`
- only after a winning lookback survives untouched final confirm:
  - widen scope to `LOW`
  - then consider `MID`
  - then consider `TOP`
- only after `1d..8d` proves real value:
  - consider infra expansion to `9d~12d`
- scaffold already exists:
  - `/home/saida/code/stockdesk-lab-lite/meta/tp12_no_stop_lookback_ladder_contract.json`
  - `/home/saida/code/stockdesk-lab-lite/tools/run_stepb_tp12_no_stop_lookback_ladder.sh`
