# 2026-04-03 Session Resume For Next Chat

## Read This First
- `/home/saida/code/stockdesk-lab-lite/meta/active_research_contract.json`
- `/home/saida/code/stockdesk-lab-lite/meta/active_research_handoff.md`
- `/home/saida/code/stockdesk-lab-lite/meta/experiment_patch_memory.json`
- `/home/saida/code/stockdesk-lab-lite/meta/experiment_registry.jsonl`
- this file:
  - `/home/saida/code/stockdesk-lab-lite/meta/session_resume_20260403_tp12_low_gap_top.md`

Before any new target-first experiment:
- `bash tools/bootstrap_target_first_session.sh --scope=target_first_v2`
- `bash tools/check_duplicate_experiment.sh --patch-key=<INTENDED_PATCH_KEY>`

Heavy jobs are server-only.

## Current State
- Latest local `npm run verify`: passed on `2026-04-04`
- Latest server `npm run verify`: passed on `2026-04-04`
- latest real Kiwoom `20-symbol` minute pilot proved the current collector path is alive but the source-depth contract is not sufficient yet for the intended broad TP12 window:
  - `000520` exhausted continuation at `2025-04-01T09:00:00+09:00` before the requested `2024-12-30T09:00:00+09:00` floor
  - `002410` returned a blank placeholder first page
  - treat this as a source-depth blocker, not a collector-liveness bug
- latest real Kiwoom narrowed-manifest attempt proved the new allowlist contract is sound, but existing OOS broad `Step A` sources for `2025-01-02 ~ 2026-01-30` are stale against current canonical candles
- root-cause fix path is now explicit:
  - rebuild a fresh OOS broad `Step A` source with:
    - `/home/saida/code/stockdesk-lab-lite/tools/server_run_stepa_recent_impulse_oos_refresh.sh`
  - then rerun:
    - `/home/saida/code/stockdesk-lab-lite/tools/run_kiwoom_tp12_inputs.sh --allowlist-path=...`
- TP12 Kiwoom intraday planning checklist is now frozen at:
  - `/home/saida/code/stockdesk-lab-lite/docs/tp12_kiwoom_intraday_patch_checklist.md`
- TP12 Kiwoom bundle 1 implementation is now landed:
  - `/home/saida/code/stockdesk-lab-lite/tools/kiwoom_rest_client.py`
  - `/home/saida/code/stockdesk-lab-lite/tools/probe_kiwoom_rest_contract.py`
  - `/home/saida/code/stockdesk-lab-lite/tools/probe_kiwoom_rest_depth.py`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_kiwoom_rest_client.py`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_kiwoom_rest_probes.py`
- Latest completed execution-contract experiment:
  - `perfect_proto_stepb_1d_tp12_low_gap_top_execution_menu_recent0201_0402_20260403`
  - status: `candidate_tradeoff`
- Shared KR daily data status:
  - `data/candle_daily.jsonl`: `2016-01-04 ~ 2026-04-03`
  - `data/universe_daily.jsonl`: `2016-01-04 ~ 2026-04-03`
  - `2016-01-01` is not a trading day, so earliest valid daily row is `2016-01-04`
- Historical server runs completed:
  - inputs: `kr_hist_inputs_2016_2020_retry_checkpoint`
  - remaining backfill + merge + sidecar + verify: `kr_hist_remaining_2016_2017_20260404c`
- Important operational note:
  - `scripts/sync_to_server.sh` now excludes `artifacts/backfill/`
  - do not remove that exclusion unless you intentionally want local sync to delete server-only historical staging artifacts
  - `tools/smoke_public_kr_historical_stage_tools.py` now guards this exclusion and the hardlink-backup inode contract
  - `tools/merge_public_kr_historical_stage.py` has already been cleaned off deprecated `datetime.utcnow()` usage
  - server runtime data remains the source of truth; use `bash scripts/sync_data_from_server.sh` when local `data/*.jsonl` must be refreshed from server canonical state
  - future Kiwoom minute backfill must follow the same server-only source-of-truth rule
- New intraday planning artifact:
  - `/home/saida/code/stockdesk-lab-lite/docs/tp12_kiwoom_intraday_patch_checklist.md`
  - this is now the canonical planning checklist for the Kiwoom-based TP12 intraday branch
  - do not scatter intraday patch planning across ad-hoc notes
- Live Kiwoom probe status:
  - contract probe summary:
    - `/home/moltook/apps/stockdesk-lab-lite/artifacts/tmp/kiwoom_contract_probe_20260404.json`
  - depth probe summary:
    - `/home/moltook/apps/stockdesk-lab-lite/artifacts/tmp/kiwoom_depth_probe_20260404.json`
  - confirmed contract fix:
    - `ka90013` and `ka10047` must use `/api/dostk/mrkcond`
    - do not route them through `/api/dostk/chart`
  - observed conservative depth sample:
    - `ka10080` `12` pages -> oldest observed `2026-02-23T12:36:00`
    - `ka10060` `8` pages -> oldest observed `2012-10-05`
    - `ka90013` `8` pages -> oldest observed `2015-05-14`
    - `ka10047` `8` pages -> oldest observed `2024-04-11`
  - interpretation:
    - minute reverse-continuation is confirmed, but full 2016 minute depth is still unproven
    - investor/program side-daily history is already promising for the TP12 train window
    - trade-strength looks much shorter and should not yet be treated as a 10-year guaranteed side dataset
  - real narrowed pilot checkpoint proof:
    - `artifacts/backfill/kiwoom_intraday_1m/run=tp12_intraday_low_gap_top_pilot20_minute_20260405_r7/checkpoints/000520.json`
    - `artifacts/backfill/kiwoom_intraday_1m/run=tp12_intraday_low_gap_top_pilot20_minute_20260405_r7/checkpoints/002410.json`
  - next correct move is not a wider minute run; it is to classify enough pilot symbols to decide whether Kiwoom minute can support the requested OOS/train floor at all

## What Was Proven

### 1. Broad exact TP12/SL4 search is exhausted for now
Frozen broad control:
- `1D / recent_impulse_upto_1d / strict_label_boundary / D+1 open / 3 trading days / TP12 / SL4 / 200K / baseline conjunction / v3_contextual_plus_lite / max-rule-size=6`

What broad and cell-local search showed:
- broad control has rules and some OOS zero-negative pockets
- `TOP / MID / LOW` cell splits also have tiny OOS-perfect pockets
- but all of them fail the real gates:
  - `train 10 dates / 6 months / 4 folds = 0`
  - `OOS perfect >= 3 matched dates = 0`

Implication:
- the problem is not "can we find exact rules at all"
- the problem is "all exact TP12/SL4 rules collapse into tiny pockets"

### 2. `LOW_GAP_TOP` is the strongest signal source
Among the family-local scopes, the strongest TP12 touch source is `LOW_GAP_TOP`.
Important baseline touch stats:
- OOS touch baseline: `76/206 = 36.89%`
- OOS matched dates: `161`
- touch OOS `perfect >=3 dates` rules: `3`

This means:
- a real `3-day 12% mover` signal exists in `LOW_GAP_TOP`
- but it does not survive unchanged under the current clean execution contract

### 3. Contract split changed the interpretation
Critical result from contract split:
- `touch discovery`:
  - `D+1 open`
  - `3-day 12% touch`
  - no stop gate in the promotion criterion
- `clean validation`:
  - `D+1 open / 3d / TP12 / SL4`

Outcome:
- touch discovery produced repeated OOS-perfect rules
- clean TP12/SL4 produced none

Interpretation:
- the signal exists
- the current `TP12 / SL4` execution contract blocks it

### 4. Broadening / scorecard / bundle / parent-lift all failed to preserve coverage cleanly
Several attempts were made after touch discovery:
- broadening union
- scorecard bundle
- touch bundle union with veto
- parent-lift bundle

What happened repeatedly:
- train breadth sometimes improved
- precision sometimes improved
- but OOS coverage collapsed
- or no feasible positive parent/scorecard term survived

Typical failure pattern:
- tiny high-precision union like `4/4 = 100%`
- but selected rows collapse versus baseline touch `206`

Interpretation:
- these paths can build nice tiny subsets
- they do not yet produce a promotable operating rule set

### 5. Replaying the original OOS touch-good rules on recent data failed
Recent replay run:
- patch key:
  - `perfect_proto_stepb_1d_tp12_low_gap_top_touch_oos_rules_recent0201_0402_replay_20260403`
- requested range:
  - `2026-02-01 ~ 2026-04-02`
- actual strict-boundary decision-date coverage:
  - `2026-02-02 ~ 2026-04-01`
- recent touch pack:
  - `51` rows
  - `21` touch-positive rows
  - `29` decision dates

Two banks were replayed unchanged:
1. all `47` touch OOS zero-negative rules
- result:
  - `4 selected / 1 hit = 25.00%`
  - `4` matched dates
- selected rows:
  - `2026-02-11` `비엘팜텍` `HIT`
  - `2026-03-06` `극동유화` `MISS`
  - `2026-03-20` `에이비프로바이오` `MISS`
  - `2026-03-27` `세우글로벌` `MISS`

2. the `3` touch OOS `perfect >=3 matched dates` rules
- result:
  - `0 selected / 0 hit`

Interpretation:
- the original OOS touch-good bank does not carry forward cleanly into recent data
- even the broader `47`-rule bank degrades to `25%`
- the tighter repeated OOS-perfect subset does not fire at all

### 6. Fixed-donor execution-menu redesign confirms stop pressure and finds a usable stop-aware recovery path
Execution-menu run:
- patch key:
  - `perfect_proto_stepb_1d_tp12_low_gap_top_execution_menu_recent0201_0402_20260403`
- recent gate:
  - requested range `2026-02-01 ~ 2026-04-02`
  - actual strict-boundary decision-date coverage `2026-02-02 ~ 2026-04-01`
- fixed donor cohort:
  - OOS touch line `76/206 = 36.89%`
  - recent touch line `21/51 = 41.18%`
  - donor OOS stop-before-touch share `28/76 = 36.84%`
  - donor recent stop-before-touch share `11/21 = 52.38%`

Baseline clean stop-first execution:
- `3d / TP12 / SL4 / stop-first`
- OOS:
  - `48/206 = 23.30%`
  - avgNetRet `+0.23%`
- recent:
  - `10/51 = 19.61%`
  - avgNetRet `-0.68%`

Best overall policy:
- `touch_anchor_tp12_no_stop_3d`
- OOS:
  - `76/206 = 36.89%`
  - avgNetRet `+0.64%`
- recent:
  - `21/51 = 41.18%`
  - avgNetRet `-1.35%`

Best stop-aware policy:
- `tp12_sl4_stop_delay1_4d`
- OOS:
  - `61/206 = 29.61%`
  - avgNetRet `+1.32%`
- recent:
  - `19/51 = 37.25%`
  - avgNetRet `+2.11%`
- verdict:
  - `stop_recovery_policy_found`

Interpretation:
- the signal loss is substantially execution-contract driven
- pure no-stop keeps the highest hit rate, but it is not the best practical operating shape because recent avg net return stays negative
- a delayed-stop plus slightly longer hold recovers much more of the donor signal than the clean baseline while staying positive on both OOS and recent
- the next branch should stay inside execution-contract redesign, not go back to exact-rule search

## Important Conclusions

### A. Do not continue exact TP12/SL4 search tuning
Do not keep tuning:
- exact search ordering
- exact search prune
- parent-lift exact candidates
- same bundle/scorecard thresholds
- same broad/cell TP12/SL4 search

This line has been tested enough.

### B. Do not treat tiny high-precision unions as success
Examples like:
- `4/4 = 100%`
- `7/10 = 70%`
are not success if coverage collapses.

Rule-set success must be judged by:
- OOS selected rows
- OOS matched dates
- OOS hit rate
- concentration ceilings
not by raw precision alone.

### C. The real problem is no longer signal discovery alone
The strongest evidence now is:
- signal discovery works in `LOW_GAP_TOP`
- bank reuse fails on recent data
- clean TP12/SL4 blocks the signal
- delayed-stop execution recovers a large part of the donor signal

So the remaining problem is one of these:
1. the signal is real but unstable as a fixed exact-rule bank
2. the execution contract is wrong for that signal
3. both are true

## Next Patch Branch
- do not start with raw runtime integration
- first patch branch is the Kiwoom intraday data plane:
  - `tools/kiwoom_rest_client.py`
  - `tools/probe_kiwoom_rest_contract.py`
  - `tools/probe_kiwoom_rest_depth.py`
  - `tools/build_tp12_stepa_intraday_manifest.mjs`
  - side-daily stage/QC/merge
  - minute stage/QC/merge
  - derived intraday feature dataset
- minute scope must be built from `Step A broad candidate universe`, not final hits
- request windows must be `D-1..D+4`
- heavy runs remain server-only
- hard stop:
  - do not launch full 10-year minute backfill until the depth probe proves the reachable history floor with explicit evidence
- storage rule:
  - do not extend `hourly60mJsonl`
  - use a separate partitioned `intraday_1m` dataset as described in the checklist
- follow the exact checklist in:
  - `/home/saida/code/stockdesk-lab-lite/docs/tp12_kiwoom_intraday_patch_checklist.md`

### Current Kiwoom Bundle Status
- Bundle 1 done:
  - `tools/kiwoom_rest_client.py`
  - `tools/probe_kiwoom_rest_contract.py`
  - `tools/probe_kiwoom_rest_depth.py`
  - `tools/smoke_kiwoom_rest_client.py`
  - `tools/smoke_kiwoom_rest_probes.py`
- Bundle 2 done:
  - `tools/build_tp12_stepa_intraday_manifest.mjs`
  - `tools/smoke_tp12_stepa_intraday_manifest.mjs`
- current manifest contract:
  - build from `step-a/events_high8_lite.jsonl`
  - join provenance from `step-a/step_a_summary.json`
  - emit `D-1..D+4` windows on each symbol's own canonical candle sequence
  - fail fast if the decision date cannot form a full window
- real OOS narrowing is now closed:
  - fresh broad OOS source:
    - `artifacts/runs/tp12_intraday_recent_impulse_upto_1d_oos_stepa_refresh_20260405_01`
  - real LOW_GAP_TOP allowlist:
    - `artifacts/tp12_intraday/allowlist/run=perfect_proto_low_gap_top_support_scorecard_router_v31_oos/rows.jsonl`
  - fresh narrowed manifest:
    - `artifacts/tp12_intraday/request_manifest/run=perfect_proto_low_gap_top_support_scorecard_router_v31_oos_fresh/requests.jsonl`
    - `rowCount=4831`
    - `allowlistMatchedRowCount=4831`
- next implementation target:
  - close minute timestamp/session contract first
  - then run a `20-symbol` real side-daily + minute pilot from the fresh narrowed manifest
  - then build `d0_close` feature rows and the first baseline-vs-bridged OOS comparison
  - use the master remaining-work checklist in:
    - `/home/saida/code/stockdesk-lab-lite/docs/tp12_kiwoom_intraday_patch_checklist.md`

### D. Recent continuation matters more than historic OOS perfection alone
The latest replay is especially important.
Even rules that were OOS-perfect in the original OOS window do not carry cleanly into `2026-02-02 ~ 2026-04-01`.
That means any next operating candidate must survive a recent replay gate, not just the original OOS.

## Hard Do-Not-Repeat
- do not rerun the same broad `1D TP12 / SL4` exact search unchanged
- do not rerun `TOP / MID / LOW` regime-cell exact TP12 probes unchanged
- do not rerun relaxed promotable-first on the same scopes unchanged
- do not rerun ordering-only TP12 exact-search tuning unchanged
- do not rerun the same scorecard bundle / parent-lift exact patch unchanged
- do not promote tiny touch unions as if they were broad rules
- do not escalate any of the failed exact-search branches to `2M`

## Best Next Move
Two defensible next branches remain.

### Branch 1: Execution-contract redesign on the discovered touch donor cohort
This is now the most direct branch.

Use `LOW_GAP_TOP touch` donor cohort as fixed signal input and test execution alternatives such as:
- different entry timing/zone around `D+1 open`
- stop-free discovery with later execution scoring
- wider stop / delayed stop / no stop in discovery then execution evaluation later
- variants centered on the current best stop-aware shape:
  - `SL4 stop delay1 / 4d hold`
  - compare hold extension vs stop delay separately
  - compare `SL4` vs `SL6` only if the donor-cohort evaluation stays fixed
- learned or menu-based stop/entry policy on top of a fixed signal donor cohort

Reason:
- signal exists
- current clean `TP12 / SL4` blocks it
- reusing exact OOS rule pockets unchanged does not survive recent replay

### Branch 2: Coverage-preserving donor aggregation beyond exact-rule banks
Only do this if the goal is still to improve signal-side selection before execution.

Direction:
- stop thinking in terms of one exact rule or tiny OR-bundle
- build donor aggregation that optimizes:
  - OOS selected rows floor
  - OOS matched dates floor
  - hit-rate lift vs touch baseline `36.89%`
  - concentration ceilings
- any new aggregation must also pass a recent replay gate, not only original OOS

If this branch is reopened, baseline target should be something like:
- selected rows materially above `40`
- matched dates materially above `20`
- hit rate above `36.89%`
- no tiny-union collapse

## Recommended Priority For Next Chat
1. keep `LOW_GAP_TOP touch discovery` as the signal substrate
2. do not reopen exact-search tuning
3. continue execution-contract redesign first
4. start from the new best stop-aware shape:
   - `tp12_sl4_stop_delay1_4d`
5. only reopen signal-side aggregation if execution redesign stalls
6. if a new signal-side aggregation is tested, require a recent replay gate immediately

## Practical Restart Hint
If a new chat says “continue from here”, start from:
- this file:
  - `/home/saida/code/stockdesk-lab-lite/meta/session_resume_20260403_tp12_low_gap_top.md`
- then re-read:
  - `/home/saida/code/stockdesk-lab-lite/meta/active_research_contract.json`
  - `/home/saida/code/stockdesk-lab-lite/meta/active_research_handoff.md`
  - `/home/saida/code/stockdesk-lab-lite/meta/experiment_patch_memory.json`
  - `/home/saida/code/stockdesk-lab-lite/meta/experiment_registry.jsonl`
- then choose one branch explicitly:
  - `LOW_GAP_TOP touch donor -> execution contract redesign`
  - or `LOW_GAP_TOP touch donor -> coverage-preserving aggregation with recent replay gate`
## 2026-04-04 Kiwoom Side-Daily Bundle 3
- bundle 3 status:
  - done for proven datasets only:
    - `investor_daily`
    - `program_daily`
    - `trade_strength_daily`
- patch set:
  - `tools/kiwoom_side_daily_common.py`
  - `tools/backfill_kiwoom_side_daily.py`
  - `tools/qc_kiwoom_side_daily_stage.py`
  - `tools/merge_kiwoom_side_daily_stage.py`
  - `tools/smoke_kiwoom_side_daily_stage_tools.py`
  - `tools/run_kiwoom_side_daily_backfill.sh`
  - `tools/server_run_kiwoom_side_daily_backfill.sh`
- canonical contract in this bundle:
  - `data/intraday_side/investor_daily.jsonl`
  - `data/intraday_side/program_daily.jsonl`
  - `data/intraday_side/trade_strength_daily.jsonl`
- hard stop:
  - do not auto-extend bundle 3 tools to `shorting/loan/credit/sector` until each TR has the same contract probe and smoke coverage
- next bundle:
  - minute collector:
    - `symbol-first`
    - `reverse continuation`
    - `manifest-filtered D-1..D+4`

## 2026-04-04 Kiwoom Intraday 1M Bundle 4
- bundle 4 status:
  - done
- patch set:
  - `tools/kiwoom_intraday_1m_common.py`
  - `tools/backfill_kiwoom_intraday_1m.py`
  - `tools/qc_kiwoom_intraday_1m_stage.py`
  - `tools/merge_kiwoom_intraday_stage.py`
  - `tools/smoke_kiwoom_intraday_stage_tools.py`
  - `tools/run_kiwoom_intraday_1m_backfill.sh`
  - `tools/server_run_kiwoom_intraday_1m_backfill.sh`
- current canonical minute contract:
  - `data/intraday_1m/date=YYYY-MM-DD/part-000.jsonl`
  - `data/intraday_1m_presence_daily.jsonl`
- collector contract:
  - start from latest anchor
  - walk backward with `cont-yn` and `next-key`
  - keep only manifest-requested dates
  - fail if requested presence is incomplete
- next bundle:
  - compact derived intraday feature dataset
  - decision-time-safe D0/D+1 cutoff features

## 2026-04-04 Kiwoom Intraday Bundle 5/6
- bundle 5/6 status:
  - done
- patch set:
  - `src/lib/config.mjs`
  - `src/lib/tp12_intraday_feature_builder.mjs`
  - `tools/build_tp12_intraday_feature_dataset.mjs`
  - `tools/smoke_tp12_intraday_feature_dataset.mjs`
  - `tools/run_tp12_intraday_feature_dataset.sh`
  - `tools/server_run_tp12_intraday_feature_dataset.sh`
- current derived feature artifact:
  - `artifacts/tp12_intraday/features/run=<id>/feature_rows.jsonl`
- implemented gate rows:
  - `d0_close`
  - `d1_0905`
  - `d1_0915`
  - `d1_0930`
- current supported flow families:
  - `investor_daily`
  - `program_daily`
  - `trade_strength_daily`
- still deferred:
  - direct runtime wiring with explicit config/cache signatures
  - `shorting/loan/credit/sector` side-daily bundles

## 2026-04-05 Kiwoom Intraday Bundle 7
- bundle 7 status:
  - done
- patch set:
  - `src/lib/tp12_intraday_feature_bridge.mjs`
  - `tools/build_tp12_intraday_feature_pack_bridge.mjs`
  - `tools/smoke_tp12_intraday_feature_bridge.mjs`
  - `tools/run_tp12_intraday_feature_pack_bridge.sh`
  - `tools/server_run_tp12_intraday_feature_pack_bridge.sh`
- bridge output:
  - gate-specific augmented Step-D feature pack
  - full-coverage fail-fast join on `(symbol, decisionDateKey)`
  - `features` only, no `labels`
- next step:
  - local smoke
  - server verify

## 2026-04-05 Kiwoom Intraday Bundle 8
- bundle 8 status:
  - done
- patch set:
  - `tools/run_kiwoom_tp12_inputs.sh`
  - `tools/run_kiwoom_tp12_backfill.sh`
  - `tools/run_kiwoom_tp12_pipeline.sh`
  - `tools/server_run_kiwoom_tp12_pipeline.sh`
- contract:
  - lower-level wrappers support explicit `--skip-verify`
  - end-to-end pipeline does one final `npm run verify`
  - writes `artifacts/tp12_intraday/pipeline/run=<id>/pipeline_summary.json`

## 2026-04-05 Kiwoom Intraday Bundle 9
- bundle 9 status:
  - done
- patch set:
  - `tools/build_tp12_intraday_allowlist_from_pack.mjs`
  - `tools/run_tp12_intraday_allowlist_from_pack.sh`
  - `tools/server_run_tp12_intraday_allowlist_from_pack.sh`
  - `tools/build_tp12_stepa_intraday_manifest.mjs`
- contract:
  - downstream `daily_pack.jsonl` can generate an explicit `(symbol, decisionDateKey, stepALaneId)` allowlist
  - broad Step A manifest can be narrowed with `--allowlist-path`
  - unmatched allowlist rows are fatal

## 2026-04-05 Kiwoom Intraday Bundle 10
- bundle 10 status:
  - done
- patch set:
  - `tools/kiwoom_intraday_1m_common.py`
  - `tools/qc_kiwoom_intraday_1m_stage.py`
  - `tools/probe_kiwoom_rest_contract.py`
  - `tools/probe_kiwoom_rest_depth.py`
  - `tools/smoke_kiwoom_intraday_stage_tools.py`
  - `tools/smoke_kiwoom_rest_probes.py`
- contract:
  - Kiwoom minute `cntr_tm` is treated as already `KST` local
  - `UTC -> KST` shift is removed
  - minute timestamps must stay inside the KR regular session
  - probe summaries now record normalized minute bounds and session-invalid counts
- verify:
  - local `bash scripts/verify.sh` passed
  - server `bash scripts/verify.sh` passed
- next step:
  - run the first real narrow server pilot from the fresh LOW_GAP_TOP manifest
- `2026-04-05`: primary TP12 patch path has been split:
  - `minute-capable optional branch`:
    - `/home/saida/code/stockdesk-lab-lite/docs/tp12_kiwoom_intraday_patch_checklist.md`
  - `daily + side-daily core branch`:
    - `/home/saida/code/stockdesk-lab-lite/docs/tp12_side_daily_patch_checklist.md`
    - `/home/saida/code/stockdesk-lab-lite/docs/tp12_side_daily_patch_plan.md`
  - immediate next work should start from the side-daily branch, not the minute branch
  - research sequence is fixed:
    - restart from the `2016` train floor
    - find no-stop TP12 rules first
    - test side-daily additive lift on that target
    - only then move to buy/sell/stop deep-learning or execution-policy work

## 2026-04-05 TP12 Side-Daily Bundle 3/4/5
- primary path is now `daily + side-daily`, not long-history minute
- implemented:
  - no-stop TP12 label helper:
    - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_no_stop_target_contract.mjs`
  - side-daily derived feature dataset:
    - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_feature_builder.mjs`
    - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_side_daily_feature_dataset.mjs`
  - side-daily Step-D bridge:
    - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_feature_bridge.mjs`
    - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_side_daily_feature_pack_bridge.mjs`
  - strict side-daily pipeline wrapper:
    - `/home/saida/code/stockdesk-lab-lite/tools/run_kiwoom_tp12_side_daily_pipeline.sh`
- frozen contract:
  - gate:
    - `d0_close`
  - labels:
    - `tp12_no_stop_hit_3d`
    - `tp12_no_stop_hit_4d`
  - execution labels are not allowed in this artifact
- next action:
  - rerun server verify
  - then record the exact `2016` floor split and first daily-only no-stop control metrics

## 2026-04-05 TP12 Side-Daily follow-up
- strict-mode rename applied:
  - `flow_*` side-daily feature keys were removed
  - current cross-family keys now use:
    - `side_alignment_*`
    - `side_pressure_*`
    - `side_strength_*`
- checklist/plan were tightened:
  - add explicit split/control freeze bundle before the first scientific comparison
  - keep the scientific order fixed as:
    - daily-only no-stop control
    - `daily + investor`
    - `daily + program`
    - `daily + investor + program`
    - execution / deep-learning only later
- local `bash scripts/verify.sh` passed again after this follow-up refresh
- server `bash scripts/verify.sh` also passed again after sync

## 2026-04-05 TP12 Side-Daily Control Artifact Builder
- implemented:
  - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_control_builder.mjs`
  - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_contract.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_side_daily_control.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/run_tp12_side_daily_control.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/server_run_tp12_side_daily_control.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_tp12_side_daily_control.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_tp12_side_daily_contract.mjs`
- froze the first machine-readable scientific control contract:
  - `/home/saida/code/stockdesk-lab-lite/meta/tp12_side_daily_research_contract.json`
  - `contractId = tp12_side_daily_low_gap_top_no_stop_effective_floor_20160812_v3`
  - `decisionWindow = 2016-08-12 ~ 2026-03-30`
  - `train = 2016-08-12 ~ 2024-12-31`
  - `oos = 2025-01-02 ~ 2026-03-30`
  - `scopeId = LOW_GAP_TOP`
  - `stepALaneSet = [recent_impulse_1d]`
  - `targetLabelIds = [tp12_no_stop_hit_3d, tp12_no_stop_hit_4d]`
- purpose:
  - freeze the first scientific `daily-only no-stop` baseline as files, not prose
- outputs:
  - `decision_candidates_feature_pack_control.jsonl`
  - `no_stop_label_rows.jsonl`
  - `control_summary.json`
- hard contract:
  - exact `train/oos` split required
  - exact `stepALaneSet` required
  - exact `allowlistPolicy` required
  - exact `commonSupportPolicy` required
  - label ids must remain no-stop TP12 target ids
- next step:
  - run the first real server control artifact for the frozen `2016` floor contract before any `daily + investor/program` comparison

## 2026-04-05 TP12 Side-Daily Control-Input Pack / 2016 Floor Proof
- implemented:
  - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_control_input_pack.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_side_daily_control_input_pack.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_tp12_side_daily_control_input_pack.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/run_tp12_side_daily_control_inputs.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/server_run_tp12_side_daily_control_inputs.sh`
- role:
  - build fresh train/oos open daily packs
  - merge them into one exact control-input daily pack
  - fail-fast if the merged pack does not reach the frozen effective train floor
- current confirmed blocker from existing broad open packs:
  - train `2020-11-27 ~ 2024-12-27`
  - oos `2025-01-02 ~ 2026-01-29`
  - therefore the currently available artifacts do not satisfy the frozen `2016` floor
- exact next step:
  - rerun verify with the new smoke
  - then run:
    - `bash tools/server_run_tp12_side_daily_control_inputs.sh --contract-path=meta/tp12_side_daily_research_contract.json --run-id=tp12_side_daily_control_inputs_low_gap_top_2016_floor_v1 --split-policy=strict_label_boundary --discovery-universe-id=recent_impulse_upto_1d --recent-impulse-lookback-days=1`
  - expected behavior:
    - green `2016` floor coverage
    - or fail-fast `control input pack does not reach requested train floor`, which becomes the canonical blocker for the next patch

## 2026-04-05 TP12 Side-Daily Control-Input / Real Outcome
- server `npm run verify` was rerun and reached `==> verify complete`
- real run id:
  - `tp12_side_daily_control_inputs_low_gap_top_2016_floor_v1`
- result:
  - fail-fast `control input pack does not reach requested train floor: requested=2016-01-05 actual=2016-08-12`
- concrete facts:
  - train Step A accepted rows: `34781`
  - train pack `rowsWritten = 34756`
  - train pack `selectedDecisionCoverage.from = 2016-08-12`
  - merged control-input summary before assertion:
    - `rowCount = 40624`
    - `decisionDateFrom = 2016-08-12`
    - `decisionDateTo = 2026-03-27`
- interpretation:
  - no wrapper bug remains on this path
  - current `LOW_GAP_TOP + recent_impulse_upto_1d + strict_label_boundary` is not the actual cause of the January miss
  - the strict daily feature warmup contract (`localWindow=40`, `globalWindow=150`, `featureAsOf=t-1`) makes `2016-08-12` the first reachable decision date
- next action:
  - freeze `2016-08-12` as the effective floor
  - do not rerun the same control-input patch unchanged
  - only after the new floor contract is explicit should the floor-proof run be retried

## 2026-04-05 Side-Daily effective-floor control-input green / next blocker
- real run:
  - `tp12_side_daily_control_inputs_low_gap_top_effective_floor_20160812_v1`
- result:
  - `rowCount = 40624`
  - `trainRowCount = 34756`
  - `oosRowCount = 5868`
  - `decisionDateFrom = 2016-08-12`
  - `decisionDateTo = 2026-03-27`
- new root cause:
  - the side-daily research contract had been using downstream scope `LOW_GAP_TOP` as if it were the raw Step A lane id
  - actual broad Step A / allowlist / request manifest rows use `stepALaneId = recent_impulse_1d`
- frozen correction:
  - keep `scopeId = LOW_GAP_TOP`
  - set `control.stepALaneSet = [recent_impulse_1d]`
- remaining blocker before the first real daily-only no-stop control artifact:
  - no full-period downstream `LOW_GAP_TOP` daily pack / exact allowlist exists yet
  - existing server `LOW_GAP_TOP` downstream packs still start at `2020-11-27`
- helper added so the unblock path is deterministic once the rerun finishes:
  - `tools/build_tp12_side_daily_downstream_full_period_pack.mjs`
  - `tools/run_tp12_side_daily_downstream_full_period_pack.sh`
  - `tools/server_run_tp12_side_daily_downstream_full_period_pack.sh`
  - `tools/smoke_tp12_side_daily_downstream_full_period_pack.mjs`
  - `tools/run_tp12_side_daily_full_period_allowlist.sh`
  - `tools/server_run_tp12_side_daily_full_period_allowlist.sh`
  - `tools/build_tp12_side_daily_full_period_manifest.mjs`
  - `tools/run_tp12_side_daily_full_period_manifest.sh`
  - `tools/server_run_tp12_side_daily_full_period_manifest.sh`
  - `tools/smoke_tp12_side_daily_full_period_manifest.mjs`
  - `src/lib/tp12_side_daily_scientific_comparison.mjs`
  - `tools/build_tp12_side_daily_scientific_comparison_report.mjs`
  - `tools/run_tp12_side_daily_scientific_comparison_report.sh`
  - `tools/server_run_tp12_side_daily_scientific_comparison_report.sh`
  - `tools/smoke_tp12_side_daily_scientific_comparison_report.mjs`
- next order:
  1. rerun full-period downstream `LOW_GAP_TOP`
  2. merge train/oos downstream packs into one exact full-period pack
  3. build narrowed full-period allowlist
  4. build full-period narrowed manifest
  5. run frozen scientific-control pipeline for:
    - `daily_only_no_stop`
    - `daily_plus_investor`
    - `daily_plus_program`
    - `daily_plus_investor_program`
  6. bind those frozen variants to one exact `selection_manifest.json`
  7. then score the first scientific comparison

## 2026-04-05 TP12 Side-Daily Scientific-Control Wrapper
- added:
  - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_family_variants.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_tp12_side_daily_family_variants.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/run_tp12_side_daily_scientific_control_pipeline.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/server_run_tp12_side_daily_scientific_control_pipeline.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/run_tp12_side_daily_scientific_post_rerun.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/server_run_tp12_side_daily_scientific_post_rerun.sh`
- purpose:
  - remove manual post-rerun sequencing
  - freeze the exact comparison bundle first
  - keep scoring separate from artifact freezing
  - convenience path:
    - `bash tools/server_run_tp12_side_daily_scientific_post_rerun.sh --downstream-run-dir=... --train-run-dir=... --oos-run-dir=... --feature-pack-path=...`
    - later add `--variant-selection-map=...` to continue through report generation

## 2026-04-05 TP12 Side-Daily Scientific Comparison Bundle
- added:
  - `/home/saida/code/stockdesk-lab-lite/src/lib/tp12_side_daily_scientific_comparison.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/build_tp12_side_daily_scientific_comparison_report.mjs`
  - `/home/saida/code/stockdesk-lab-lite/tools/run_tp12_side_daily_scientific_comparison_report.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/server_run_tp12_side_daily_scientific_comparison_report.sh`
  - `/home/saida/code/stockdesk-lab-lite/tools/smoke_tp12_side_daily_scientific_comparison_report.mjs`
- purpose:
  - score the frozen variants only after the control bundle is fixed
  - compare `deployment` and `common-support` views against `daily_only_no_stop`
  - keep candidate/date support intersection explicit instead of assuming equal coverage
