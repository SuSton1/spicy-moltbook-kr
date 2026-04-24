# TP12 Daily + Side-Daily Patch Plan

## 2026-04-06 Strategic Freeze

- exact `TP12 / SL4 / 3d` search tuning is frozen for this branch
- first scientific baseline is mandatory:
  - `daily_only_no_stop`
- side-daily value must be measured on top of that frozen no-stop baseline before any execution-policy promotion
- buy / sell / stop deep-learning remains explicitly downstream-only
- if a true `12% no-stop selection` supplier is desired, it must open as a sibling branch and must not mutate the frozen scientific baseline
- current critical path is:
  1. rebuild the missing full-period `LOW_GAP_TOP` downstream pack
  2. freeze the four scientific-control variants on the same full-period allowlist / manifest
  3. score the first scientific comparison
  4. if needed, open a sibling `12% no-stop rolling selection` branch on explicit rolling windows
  5. only then design donor export and downstream execution-policy learning
- detailed working plan now lives in:
  - `docs/tp12_side_daily_no_stop_deep_patch_plan.md`

## Goal

Build a fail-fast, server-only `daily + side-daily` TP12 path that:

1. keeps daily Step A discovery as the signal substrate
2. restarts discovery from the reachable `2016` train floor
3. finds the no-stop TP12 target signal first
4. uses side-daily families only as incremental filters and execution-policy aids
5. proves value only when OOS metrics improve on the same candidate/date support
6. learns buy / sell / stop policy only after the signal target is fixed

This plan is intentionally separate from the blocked long-history minute branch.

## Why This Path Now

The current state is:

- daily canonical is already good enough for `2016-01-04 ~ 2026-04-03`
- `LOW_GAP_TOP` still looks like the strongest TP12 source family
- Kiwoom minute history is not reliable enough for the intended 10-year Step A-wide canonical path
- but side-daily data already has a usable foothold:
  - `investor_daily`
  - `program_daily`
  - `trade_strength_daily`

So the next sensible move is not:

- wait for 10-year minute history
- or keep broadening rule search

The next move is:

- keep the daily signal fixed
- first re-establish no-stop TP12 discovery from the reachable `2016` floor
- then test whether side-daily families can reject bad candidates and improve target-hit discrimination
- only after that, learn execution policy

## Strategy Freeze

### Do

- reuse broad Step A outputs and fresh narrowed allowlists
- keep candidate discovery daily-first
- keep signal discovery separate from execution learning
- treat side-daily as:
  - veto features
  - execution router features
- compare each side family against a fixed daily control

### Do Not

- do not let side-daily families redefine the candidate universe
- do not force this path through minute builders
- do not start with stop-first labels
- do not reopen exact `TP12 / SL4 / 3d` search tuning on this branch
- do not accept apparent lift that comes only from coverage shrinkage
- do not compare variants that use different candidate/date support

## Family Promotion Order

### Phase A: Core Families

- `investor_daily`
- `program_daily`

These are the first promoted families because they are already implemented and are the most likely to help with short-horizon crowd/flow filtering.

### Phase B: Conditional Family

- `trade_strength_daily`

Useful, but only if its historical floor is proven for the exact experiment slice.

### Phase C: Pressure Families

- `shorting_daily`
- `loan_daily`
- `credit_daily`

These are the highest-value next additions because they can help separate continuation candidates from distorted / crowded / squeeze-like candidates.

### Phase D: Context Family

- `sector_daily`

Useful, but only after an explicit sector-join contract exists.

## Data and Artifact Shape

### Canonical Inputs

- daily:
  - `data/candle_daily.jsonl`
  - `data/universe_daily.jsonl`
- side-daily:
  - `data/intraday_side/*.jsonl`

### Derived Artifact

- `artifacts/tp12_side_daily/features/run=<id>/feature_rows.jsonl`

Each row is a decision-time-safe, side-daily-only feature row built from:

- `requestId`
- `symbol`
- `decisionDateKey`
- `prevDateKey`
- side-daily values from `prevDateKey` and `decisionDateKey`

### Bridged Experiment Artifact

- `artifacts/tp12_side_daily/bridged_feature_pack/run=<id>/decision_candidates_feature_pack_side_<gateId>.jsonl`

This is the first artifact that experiments should consume.

## Experiment Design

### Stage 1: Daily-Only No-Stop Signal Discovery

Before any side-daily family is judged, fix the first target as:

- `tp12_no_stop_hit_3d`
- `tp12_no_stop_hit_4d`

The purpose of Stage 1 is to answer:

- does the TP12 signal still hold from the `2016` floor without stop semantics hiding it?

Before any side family is tested, freeze and record:

- `trainDateFrom`
- `trainDateTo`
- `oosDateFrom`
- `oosDateTo`
- chosen Step A lane set
- no-stop label ids
- daily-only control artifact paths
- common-support comparison rule

If this contract is not written first, later side-family lift claims are not valid.

### Stage 2: Daily + Side-Daily Additive Lift

Only after Stage 1 is recorded:

- test `investor/program/...` families as additive `d0_close` features
- first objective:
  - improve no-stop TP12 target discrimination
- second objective:
  - preserve or improve OOS while keeping acceptable coverage

### Stage 3: Execution Learning

Only after Stage 2 is green and the branch has explicitly decided whether a new `12% no-stop` supplier is needed:

- introduce execution labels
- learn `buy / sell / stop` policy
- this is the point where downstream deep-learning style policy work may start
- this stage must not begin before the first no-stop scientific comparison is written and reviewed
- keep this as a separate downstream phase so signal discovery and execution learning do not contaminate each other

### Stage 2.5: 12% No-Stop Rolling Selection Branch

Only if the current supplier is still not aligned with the intended `12%` target:

- open a sibling `LOW_GAP_TOP / recent_impulse_1d / TP12 no-stop` selection branch
- keep the current scientific-control root untouched
- freeze explicit rolling windows:
  - `3y train + 1y OOS` for six screen windows
  - one untouched final confirm on `2025-01-02 ~ 2026-03-27`
- evaluate:
  - primary: `tp12_no_stop_hit_3d`
  - secondary: `tp12_no_stop_hit_4d`
- do not mix:
  - `HIGH8`
  - `close28`
  - or `TP12 / SL4 / 3d clean validation`
  into the primary promotion claim for this branch

### Control

- current daily feature pack
- current fixed candidate/date slice

### Gate 1: `d0_close` Veto

Question:

- can side-daily families reject candidates that daily features would have kept, and improve OOS hit rate / avgNetRet?
- first measured on `no-stop` TP12 target labels

### Gate 2: `d0_close` Execution Router

Question:

- given a candidate that daily features would keep, can side-daily families choose between:
  - `stop_first`
  - `delay1_4d`
  - `abstain`

### Comparison Rule

Every family test must be run twice:

1. `common-support view`
   - same rows
   - same dates
   - pure incremental lift
2. `deployment view`
   - actual reachable rows
   - actual coverage loss
   - real operational value

If a family improves only by shrinking the usable slice too much, it does not get promoted.

In addition:

- no family gets credit for lift unless the daily-only no-stop baseline is frozen first

## Join Semantics

### Manifest Provenance

- reuse:
  - `tools/build_tp12_stepa_intraday_manifest.mjs`
- broad Step A remains the collection / experiment universe source

### Side-Daily Join

- join side datasets on `(symbol, dateKey)`

### Bridge Join

- MVP bridge on `(symbol, decisionDateKey)`
- but only after an explicit pair-uniqueness audit proves the evaluated feature-pack slice has no duplicate pairs

If pair uniqueness is not true, the bridge must fail instead of guessing.

## File-Level Patch Bundles

### Bundle 0: Freeze Docs

Touch:

- `docs/tp12_side_daily_patch_checklist.md`
- `docs/tp12_side_daily_patch_plan.md`
- `docs/tp12_kiwoom_intraday_patch_checklist.md`
- `docs/tp12_kiwoom_intraday_patch_plan.md`
- `meta/active_research_handoff.md`
- `meta/session_resume_20260403_tp12_low_gap_top.md`

Outcome:

- minute branch becomes optional / blocked
- daily+side branch becomes primary
- `2016 floor -> no-stop TP12 -> side-daily lift -> execution learning` becomes the frozen order

### Bundle 1: Side Family Registry

Touch:

- `tools/kiwoom_rest_client.py`
- `tools/kiwoom_side_daily_common.py`
- `tools/backfill_kiwoom_side_daily.py`
- `tools/qc_kiwoom_side_daily_stage.py`
- `tools/merge_kiwoom_side_daily_stage.py`

Outcome:

- explicit support and status for:
  - `shorting_daily`
  - `loan_daily`
  - `credit_daily`
  - `sector_daily`

### Bundle 1.5: No-Stop Target Contract

Add / update:

- target-label documentation in the checklist / handoff
- explicit research reporting note that the first side-daily experiments use no-stop TP12 labels only
- reusable no-stop target label helper:
  - `src/lib/tp12_no_stop_target_contract.mjs`

Outcome:

- every later side-daily result is interpretable against the same no-stop target definition

### Bundle 1.6: Split / Control Freeze

Add / update:

- exact reachable `2016`-floor split policy in docs / handoff
- machine-readable frozen contract:
  - `meta/tp12_side_daily_research_contract.json`
- first daily-only no-stop control contract fields:
  - `trainDateFrom`
  - `trainDateTo`
  - `oosDateFrom`
  - `oosDateTo`
  - `stepALaneSet`
  - `targetLabelIds`
  - `allowlistPolicy`
  - `commonSupportPolicy`
- scientific comparison order:
  - `daily-only`
  - `daily + investor`
  - `daily + program`
  - `daily + investor + program`

Outcome:

- every later side-family comparison is anchored to one frozen daily-only control
- control tooling can load the same split/lane/policy contract without retyping values

### Bundle 1.7: Daily-Only Control Artifact Builder

Add:

- `src/lib/tp12_side_daily_control_builder.mjs`
- `src/lib/tp12_side_daily_contract.mjs`
- `tools/build_tp12_side_daily_control.mjs`
- `tools/run_tp12_side_daily_control.sh`
- `tools/server_run_tp12_side_daily_control.sh`
- `tools/smoke_tp12_side_daily_control.mjs`
- `tools/smoke_tp12_side_daily_contract.mjs`

Outputs:

- `artifacts/tp12_side_daily/control/run=<id>/decision_candidates_feature_pack_control.jsonl`
- `artifacts/tp12_side_daily/control/run=<id>/no_stop_label_rows.jsonl`
- `artifacts/tp12_side_daily/control/run=<id>/control_summary.json`

Outcome:

- the first scientific baseline becomes a real machine-readable artifact instead of a doc-only promise

### Bundle 1.8: Control-Input Pack Builder / 2016 Floor Proof

Add:

- `src/lib/tp12_side_daily_control_input_pack.mjs`
- `tools/build_tp12_side_daily_control_input_pack.mjs`
- `tools/smoke_tp12_side_daily_control_input_pack.mjs`
- `tools/run_tp12_side_daily_control_inputs.sh`
- `tools/server_run_tp12_side_daily_control_inputs.sh`

Outputs:

- `artifacts/runs/<run-id>/step-perfect-prototype-open-control-input-pack/daily_pack.jsonl`
- `artifacts/runs/<run-id>/step-perfect-prototype-open-control-input-pack/control_input_summary.json`
- `artifacts/runs/<run-id>/control_input_pipeline_summary.json`

Scientific role:

- build one exact train+oos base input pack for the first `daily-only no-stop` control rerun
- prove whether the current open daily-pack surface really reaches the requested calendar `2016-01-05` train floor

Known current blocker:

- existing broad open packs only cover:
  - train `2020-11-27 ~ 2024-12-27`
  - oos `2025-01-02 ~ 2026-01-29`
- therefore the first real server run must be treated as a floor-proof test, not an assumed green build

Outcome:

- either we get a real `2016`-floor control-input pack
- or we get a fail-fast floor error that identifies the remaining surface-history limitation

Observed first real run:

- run id: `tp12_side_daily_control_inputs_low_gap_top_2016_floor_v1`
- verify status before run: server `npm run verify` green
- result: fail-fast
  - `control input pack does not reach requested train floor: requested=2016-01-05 actual=2016-08-12`
- implication:
  - the remaining blocker is not wrapper/orchestration
  - the remaining blocker is the strict daily feature warmup contract:
    - `localWindow=40`
    - `globalWindow=150`
    - `featureAsOf=t-1`
- required next move:
  - freeze the reachable effective floor at `2016-08-12`
  - then rerun the floor-proof pack build
  - only after a green floor-proof pack may the first daily-only no-stop control artifact run
- follow-up after the green effective-floor rerun:
  - keep `scopeId = LOW_GAP_TOP` as the downstream comparison scope
  - correct `control.stepALaneSet` to the real broad Step A lane:
    - `recent_impulse_1d`
  - do not reuse `LOW_GAP_TOP` as a Step A lane id; it is a downstream allowlist scope
  - next blocker after the green control-input pack is:
    - no full-period downstream `LOW_GAP_TOP` daily pack / exact allowlist for `2016-08-12 ~ 2026-03-30`
    - current server-side downstream `LOW_GAP_TOP` packs still begin at `2020-11-27`
  - helper now added for that blocker:
    - `tools/build_tp12_side_daily_downstream_full_period_pack.mjs`
    - `tools/run_tp12_side_daily_downstream_full_period_pack.sh`
    - `tools/server_run_tp12_side_daily_downstream_full_period_pack.sh`
    - `tools/run_tp12_side_daily_full_period_allowlist.sh`
    - `tools/server_run_tp12_side_daily_full_period_allowlist.sh`
    - `tools/build_tp12_side_daily_full_period_manifest.mjs`
    - `tools/run_tp12_side_daily_full_period_manifest.sh`
    - `tools/server_run_tp12_side_daily_full_period_manifest.sh`
    - `src/lib/tp12_side_daily_family_variants.mjs`
    - `tools/smoke_tp12_side_daily_family_variants.mjs`
    - `tools/run_tp12_side_daily_scientific_control_pipeline.sh`
    - `tools/server_run_tp12_side_daily_scientific_control_pipeline.sh`
    - `tools/run_tp12_side_daily_scientific_post_rerun.sh`
    - `tools/server_run_tp12_side_daily_scientific_post_rerun.sh`
    - `src/lib/tp12_side_daily_scientific_comparison.mjs`
    - `tools/build_tp12_side_daily_scientific_comparison_report.mjs`
    - `tools/run_tp12_side_daily_scientific_comparison_report.sh`
    - `tools/server_run_tp12_side_daily_scientific_comparison_report.sh`
  - exact follow-up order after the rerun turns green:
    1. merge train/oos downstream packs into `step-perfect-prototype-open-full-period-pack/daily_pack.jsonl`
    2. build the narrowed full-period allowlist from that merged pack
    3. build the full-period narrowed Step A manifest from the broad train/oos Step A sources
    4. freeze one deterministic scientific-control bundle for:
      - `daily_only_no_stop`
      - `daily_plus_investor`
      - `daily_plus_program`
      - `daily_plus_investor_program`
    5. bind those variants to one exact `selection_manifest.json`
    6. only then run the first scored scientific comparison
  - deterministic post-rerun wrapper now exists:
    - `tools/run_tp12_side_daily_scientific_post_rerun.sh`
    - `tools/server_run_tp12_side_daily_scientific_post_rerun.sh`
  - without `--variant-selection-map=...`, it stops after `pipeline_summary.json`
  - with `--variant-selection-map=...`, it continues through:
    - `selection_manifest.json`
    - `scientific_comparison_report.json`

### Bundle 2: Side-Daily Feature Builder

Add:

- `src/lib/tp12_side_daily_feature_builder.mjs`
- `tools/build_tp12_side_daily_feature_dataset.mjs`
- `tools/run_tp12_side_daily_feature_dataset.sh`
- `tools/server_run_tp12_side_daily_feature_dataset.sh`
- `tools/smoke_tp12_side_daily_feature_dataset.mjs`
- `tools/smoke_tp12_side_daily_feature_dataset.mjs`

Outcome:

- side-daily-only `d0_close` feature rows for the no-stop TP12 label stage

### Bundle 3: Side-Daily Bridge

Add:

- `src/lib/tp12_side_daily_feature_bridge.mjs`
- `tools/build_tp12_side_daily_feature_pack_bridge.mjs`
- `tools/run_tp12_side_daily_feature_pack_bridge.sh`
- `tools/server_run_tp12_side_daily_feature_pack_bridge.sh`
- `tools/smoke_tp12_side_daily_feature_bridge.mjs`
- `tools/smoke_tp12_side_daily_feature_bridge.mjs`

Outcome:

- explicit bridged feature pack with `side.*` features

### Bundle 4: Side-Daily Pipeline Wrapper

Add:

- `tools/run_kiwoom_tp12_side_daily_pipeline.sh`
- `tools/server_run_kiwoom_tp12_side_daily_pipeline.sh`

Outcome:

- end-to-end side-daily path that does not call minute backfill

### Bundle 5: Verify and Reporting

Touch:

- `scripts/verify.sh`
- handoff/resume docs

Outcome:

- each bundle closes with smoke + server verify

### Bundle 6: First Scientific Pilot

Start with:

- `LOW_GAP_TOP`
- `d0_close`
- families:
  - `investor`
  - `program`
  - `investor + program`

First target:

- `tp12_no_stop_hit_3d`
- `tp12_no_stop_hit_4d`

Outcome:

- first real answer to:
  - does side-daily improve OOS on top of daily control before any stop logic is introduced?

## Promotion Rules

A side family gets promoted only if:

1. `common-support view` improves meaningfully
2. `deployment view` remains acceptable
3. the family has explicit canonical coverage proof for the target slice

## Hard-Stop Rules

- no side-daily experiment may depend on minute data
- no family may be silently dropped because of missing coverage
- no experiment may compare different candidate/date support without an explicit common-support report
- no bridge may guess through duplicate `(symbol, decisionDateKey)` pairs
- no local heavy collection or local canonical writes

## Immediate Next Patch

The next correct implementation step is:

1. freeze the exact `2016` split / control values
2. run the first real daily-only no-stop control artifact on the server
3. keep minute code untouched until side-daily lift is scientifically measured
