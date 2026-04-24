# TP12 Kiwoom Intraday Patch Checklist

## Status Note
- as of `2026-04-05`, this document tracks the `minute-capable optional branch`
- the primary patch path for immediate TP12 work is now frozen separately at:
  - `docs/tp12_side_daily_patch_checklist.md`
- reason:
  - Kiwoom side-daily families are usable now
  - Kiwoom long-history minute remains source-blocked for the intended 10-year Step A-wide plan

## Scope
- goal:
  - add a patch-ready Kiwoom intraday data subsystem for TP12 research and execution redesign
  - keep the current daily TP12 path stable while adding explicit opt-in intraday datasets and derived feature artifacts
- non-goals:
  - do not mutate the current `hourly60m` contract into raw 1-minute data
  - do not introduce fallback paths, auto provider switching, or local heavy runs
  - do not backfill full-market 10-year 1-minute data outside the Step A candidate universe

## Confirmed Inputs
- daily canonical coverage is already closed:
  - `data/candle_daily.jsonl`: `2016-01-04 ~ 2026-04-03`
  - `data/universe_daily.jsonl`: `2016-01-04 ~ 2026-04-03`
- Kiwoom REST auth is already proven on server:
  - token issuance works
  - `ka10080` minute-chart calls work on recent windows and return `cont-yn=Y`
  - `ka10060`, `ka90013`, `ka10047` work as historical-style daily side datasets
- real narrow pilot state is now explicit:
  - side-daily `investor_daily`, `program_daily`, `trade_strength_daily` completed on the first `20-symbol` pilot
  - minute collector now emits page-level checkpoints and explicit failure classes
  - first real minute blocker is source depth, not collector liveness:
    - `000520` exhausted at `2025-04-01T09:00:00+09:00` while the requested floor was `2024-12-30T09:00:00+09:00`
    - `002410` returned only a blank placeholder row on the first page
  - implication:
    - Kiwoom minute history is still unproven for the intended `2016~2026` TP12 Step A universe
    - broad minute backfill remains blocked until source-floor limits are classified
- current TP12 runtime is effectively daily-only:
  - `hourly60m` is a shallow legacy contract
  - current TP12 pack / Step D paths explicitly disable hourly usage
- real LOW_GAP_TOP narrowing contract is now proven end-to-end:
  - stale OOS `Step A` provenance was repaired via a dedicated refresh wrapper
  - the manifest builder now uses `symbol-local trading calendars`, not a global candle calendar assumption
  - fresh OOS `recent_impulse_upto_1d` `Step A` + real LOW_GAP_TOP allowlist build now succeeds with:
    - `rowCount=4831`
    - `allowlistRowCount=4831`
    - `allowlistMatchedRowCount=4831`

## Architecture Freeze
- source of truth:
  - server-only heavy collection and canonical merge
- client split:
  - Python for auth, raw collection, stage/QC/merge
  - Node for Step A manifest generation and derived feature/label datasets
- fetch model:
  - minute data uses `symbol-centric reverse continuation`
  - start from recent anchor
  - walk backward via `cont-yn` and `next-key`
  - never rely on direct ancient-date minute jumps
- control plane:
  - reuse the historical daily backfill control plane
  - `stage -> QC -> single-writer merge -> downstream feature rebuild -> verify`
- stale-artifact remediation:
  - rebuild broad OOS `Step A` with a dedicated server-only wrapper before any real narrowed manifest run
  - do not paper over `prev date contract mismatch`; treat it as provenance drift and refresh the source artifact
- symbol-local window remediation:
  - do not assume every symbol trades on every global candle date
  - derive `D-1..D+4` windows from each symbol's own candle sequence
  - fail fast if the symbol-local sequence cannot form a full window
- runtime consumption:
  - Step A / Step D should consume compact derived intraday feature artifacts first
  - do not stream raw minute partitions into current full-file loaders

## Dataset Priority
### Must Build
- `1-minute raw bars`
  - Kiwoom `ka10080`
- `Step A intraday request manifest`
  - derived from Step A raw candidate outputs, not Step B/D selections
- `investor daily`
  - `ka10060`
- `program daily`
  - `ka90013`
- `trade strength daily`
  - `ka10047`
- `shorting daily`
  - `ka10014`
- `loan/lending daily`
  - `ka10068`
  - `ka20068`
- `credit daily`
  - `ka10013`
- `sector daily / sector flow`
  - `ka20009`
  - `ka10051`
  - `ka10010`

### Optional After Core Path Is Stable
- `intraday investor chart`
  - `ka10064`
- `trade-strength time series`
  - `ka10046`
- `broker/dealer concentration`
  - `ka10002`
  - `ka10043`
  - `ka10052`
- `VI and real-time microstructure`
  - `ka10054`
  - websocket `0B`, `0D`, `0F`, `0w`, `1h`
  - forward-collection preferred over deep historical canonical backfill

## Candidate Universe Contract
- build minute data from `Step A broad candidate universe`, not final trades or donor winners
- canonical Step A sources:
  - `step-a/events_high8_lite.jsonl`
  - `step-a/step_a_summary.json`
- do not derive the minute universe from Step B or Step D outputs
- required window per candidate:
  - `D-1`
  - `D0`
  - `D+1`
  - `D+2`
  - `D+3`
  - `D+4`
- use trading-day windows, not naive calendar-day offsets

## Scale Estimate
- current TP12 Step A universe estimate across `2016-01-04 ~ 2026-04-03`:
  - about `41.6K` events
- event window:
  - `D-1..D+4`
  - about `2340` 1-minute bars per event
- total 1-minute scale:
  - about `97.4M` bars
- implication:
  - large but practical with date partitions and server-only collection
  - still small enough to avoid full-market 10-year minute backfill

## New Data Contracts
### Raw Minute Partitions
- root:
  - `data/intraday_1m/`
- partition shape:
  - `data/intraday_1m/date=YYYY-MM-DD/part-000.jsonl`
- row contract:
```json
{"symbol":"005930","tradingDateKey":"2026-04-03","tsKst":"2026-04-03T09:01:00+09:00","open":0,"high":0,"low":0,"close":0,"volume":0,"valueKrw":0,"source":"KIWOOM","apiId":"ka10080"}
```
- first implemented canonical contract keeps minute partitions as `.jsonl`
- compression can be added only after loader/merge contract is explicit

### Presence Index
- path:
  - `data/intraday_1m_presence_daily.jsonl`
- row contract:
```json
{"symbol":"005930","tradingDateKey":"2026-04-03","barCount":390,"firstTsKst":"2026-04-03T09:00:00+09:00","lastTsKst":"2026-04-03T15:30:00+09:00","status":"complete","source":"KIWOOM"}
```

### Side Daily Datasets
- paths:
  - `data/intraday_side/investor_daily.jsonl`
  - `data/intraday_side/program_daily.jsonl`
  - `data/intraday_side/trade_strength_daily.jsonl`
  - `data/intraday_side/shorting_daily.jsonl.zst`
  - `data/intraday_side/loan_daily.jsonl.zst`
  - `data/intraday_side/credit_daily.jsonl.zst`
  - `data/intraday_side/sector_daily.jsonl.zst`
- first implemented canonical contract keeps side-daily as `.jsonl`
- compression can be added only after loader/merge contract is explicit

### Derived Intraday Feature Artifact
- path:
  - `artifacts/tp12_intraday/features/run=<id>/feature_rows.jsonl`
- purpose:
  - compact decision-time-safe feature rows for Step A / Step D experiments

## Required Config Extensions
- extend `src/lib/config.mjs` `dataPaths` with explicit keys:
  - `intraday1mRoot`
  - `intraday1mPresenceJsonl`
  - `intradaySideInvestorDailyJsonl`
  - `intradaySideProgramDailyJsonl`
  - `intradaySideTradeStrengthDailyJsonl`
  - `intradaySideShortingDailyJsonl`
  - `intradaySideLoanDailyJsonl`
  - `intradaySideCreditDailyJsonl`
  - `intradaySideSectorDailyJsonl`
  - `tp12IntradayFeatureJsonl`
- keep server-lite explicit-empty by default
- no silent fallback to `optional_empty.jsonl` for new intraday paths

## Required Loader Split
- do not extend `loadStepAData` / `loadStepDEData` to read raw 1-minute partitions wholesale
- add explicit windowed loaders to `src/lib/data.mjs`:
  - `loadIntraday1mWindow({ rootDir, symbols, tradingDateKeys })`
  - `loadIntradayPresenceWindow({ path, symbols, tradingDateKeys })`
  - `loadIntradaySideDailyWindow({ path, symbols, dateFrom, dateTo })`
- first runtime consumer should prefer `tp12IntradayFeatureJsonl`, not raw minute partitions

## Patch Map
### Docs
- update `docs/data_contracts.md`
- add this checklist
- update:
  - `meta/active_research_handoff.md`
  - `meta/session_resume_20260403_tp12_low_gap_top.md`

### Python Collector / Backfill Layer
- add:
  - `tools/kiwoom_rest_client.py`
  - `tools/probe_kiwoom_rest_contract.py`
  - `tools/probe_kiwoom_rest_depth.py`
  - `tools/backfill_kiwoom_intraday_1m.py`
  - `tools/backfill_kiwoom_side_daily.py`
  - `tools/qc_kiwoom_intraday_1m_stage.py`
  - `tools/qc_kiwoom_side_daily_stage.py`
  - `tools/merge_kiwoom_intraday_stage.py`

### Shell Wrappers
- add:
  - `tools/run_kiwoom_tp12_inputs.sh`
  - `tools/run_kiwoom_tp12_backfill.sh`
  - `tools/run_kiwoom_tp12_pipeline.sh`
  - `tools/server_run_kiwoom_tp12_pipeline.sh`

### Node Manifest / Feature Layer
- add:
  - `tools/build_tp12_stepa_intraday_manifest.mjs`
  - `tools/build_tp12_intraday_feature_dataset.mjs`
  - `src/lib/tp12_intraday_features.mjs`
- extend:
  - `src/lib/config.mjs`
  - `src/lib/data.mjs`
  - only after feature artifact exists:
    - `src/lib/perfect_prototype_daily_pack.mjs`
    - `src/pipeline/step_d_online_loop.mjs`

### Verification
- add:
  - `tools/smoke_kiwoom_rest_client.py`
  - `tools/smoke_tp12_stepa_intraday_manifest.mjs`
  - `tools/smoke_kiwoom_intraday_stage_tools.py`
- extend:
  - `scripts/verify.sh`

## Phase Checklist
### Phase 0: Contract Freeze
- [ ] document raw minute contract, presence contract, side-daily contract
- [ ] freeze `hourly60m` as legacy-only
- [ ] freeze server-only heavy-run rule

### Phase 1: Kiwoom Client + Auth Gate
- [ ] implement `KiwoomRestClient`
- [ ] fail fast on missing `KIWOOM_APP_KEY` / `KIWOOM_SECRET_KEY`
- [ ] implement token issuance
- [ ] implement `call_json(uri, api_id, body, cont_yn=None, next_key=None)`
- [ ] implement 429 throttle / cooldown / trace logging
- [ ] implement typed helpers for core TRs
- [ ] add `smoke_kiwoom_rest_client.py`

### Phase 2: Probe Before Backfill
- [ ] implement `probe_kiwoom_rest_contract.py`
- [ ] implement `probe_kiwoom_rest_depth.py`
- [ ] measure oldest reachable date for:
  - [ ] `ka10080`
  - [ ] `ka10060`
  - [ ] `ka90013`
  - [ ] `ka10047`
  - [ ] `ka10014`
  - [ ] `ka10068`
  - [ ] `ka20068`
  - [ ] `ka10013`
  - [ ] `ka20009`
  - [ ] `ka10051`
  - [ ] `ka10010`
- [ ] fail the plan if minute depth cannot reach the required historical floor
- [x] convert the abstract depth question into a real `20-symbol` server pilot
- [ ] classify pilot minute failures into:
  - [ ] history depth exhaustion
  - [ ] zero-usable first page
  - [ ] genuine in-window date holes
- [ ] stop the broad minute plan if the pilot proves the source floor is above the required Step A floor

### Phase 3: Step A Request Manifest
- [x] build manifest from `events_high8_lite.jsonl`
- [x] include provenance from `step_a_summary.json`
- [x] include `D-1..D+4` trading-day windows
- [x] include `stepALaneId`, `impulseSourceDateKey`, `impulseLookbackDays`
- [x] add `smoke_tp12_stepa_intraday_manifest.mjs`

### Phase 4: Side Daily Backfill
- [x] stage side daily datasets by symbol/date range for:
  - `investor_daily`
  - `program_daily`
  - `trade_strength_daily`
- [x] QC for duplicates/date coverage
- [x] single-writer merge into canonical side daily files
- [x] verify that `2016`-anchored requests continue backward cleanly for:
  - `ka10060`
  - `ka90013`

### Phase 5: Minute Backfill
- [x] implement symbol-centric reverse-continuation crawler
- [x] persist per-symbol checkpoints:
  - [x] `status`
  - [x] `nextKey`
  - [x] `pagesFetched`
  - [x] `rowsWritten`
  - [x] `oldestFetchedTs`
  - [x] `newestFetchedTs`
  - [x] `coveredRequestedDateCount`
  - [x] `coveredRequestedDatePreview`
  - [x] `completedFloorDate`
  - [x] `rateLimitHitCount`
- [x] stage only requested `D-1..D+4` windows
- [x] write date partitions + presence index
- [x] add `smoke_kiwoom_intraday_stage_tools.py`
- [x] distinguish `history floor exhausted` from `missing requested dates within reached history`
- [ ] persist a dedicated minute pilot report with symbol-level oldest reachable timestamp

### Phase 6: QC + Merge
- [x] QC duplicate `(symbol, tsKst)` rows
- [x] QC monotonic timestamp order
- [x] QC OHLC integrity
- [x] QC `tradingDateKey == tsKst date`
- [x] QC completed symbols fully cover requested windows
- [x] QC intraday aggregated OHLC matches daily candle samples
- [x] merge with single-writer lock and hardlink backup
- [x] write merge journal

### Phase 7: Derived Feature Dataset
- [x] build compact intraday feature rows for decision-time-safe use
- [x] D0-close features use `D-1..D0` only
- [x] D+1 09:05 / 09:15 / 09:30 features use bars only up to cutoff
- [x] later bars remain label-only
- [x] write `artifacts/tp12_intraday/features/run=<id>/feature_rows.jsonl`

### Phase 8: Runtime Integration
- [x] keep Step A candidate generation daily-first
- [x] consume derived feature artifact in experiments before touching raw minute runtime
- [ ] if runtime integration is needed later, add explicit config flags and cache signatures

### Phase 9: Strict Orchestration
- [x] add explicit `run_kiwoom_tp12_inputs.sh`
- [x] add explicit `run_kiwoom_tp12_backfill.sh`
- [x] add explicit `run_kiwoom_tp12_pipeline.sh`
- [x] ensure the orchestration wrapper runs a single final `npm run verify`
- [x] keep lower-level wrappers usable directly with explicit `--skip-verify`

## Required Manifest Fields
- `symbol`
- `decisionDateKey`
- `prevDateKey`
- `asOfDateKey`
- `stepALaneId`
- `impulseSourceDateKey`
- `impulseLookbackDays`
- `eventLabel`
- `highJumpThreshold`
- `highJumpMode`
- `recentImpulseLookbackTradingDays`
- `windowStartDateKey`
- `windowEndDateKey`
- `windowDateKeys`
- `sourceEventsPath`
- `sourceSummaryPath`
- `runId`

## Core TP12 Feature Families
### Minute Path Features
- `dminus1_last30m_volume_burst`
- `dminus1_close_runup_pct`
- `d0_first5m_ret`
- `d0_first15m_ret`
- `d0_first30m_high_pct`
- `d0_first30m_low_pct`
- `d0_vwap_hold_ratio`
- `d0_morning_breakout_strength`
- `d0_close_strength_after_breakout`
- `d1_open_flush_depth`
- `d1_open_flush_reclaim`
- `minutesToTp12`
- `minutesToSl4`
- `day1MFE`
- `day1MAE`

### Flow / Crowd Features
- current `v1` implemented:
  - `investor_dminus1_netbuy`
  - `investor_d0_netbuy`
  - `investor_day_delta`
  - `program_dminus1_netbuy`
  - `program_d0_netbuy`
  - `program_day_delta`
  - `trade_strength_dminus1`
  - `trade_strength_d0`
  - `trade_strength_day_delta`
- still pending after current patch:
  - `investor_intraday_bias`
  - `investor_1d_3d_5d_netbuy`
  - `program_1d_3d_5d_bias`
  - `trade_strength_daily_slope`
- `shorting_pressure_delta`
- `loan_pressure_delta`
- `credit_pressure_delta`
- `sector_flow_alignment`
- `sector_program_alignment`

## Leakage Rules
- `D0 close gate`:
  - features may use `D-1..D0` only
- `D+1 09:05 gate`:
  - features may use bars up to `09:05` only
- `D+1 09:15 gate`:
  - features may use bars up to `09:15` only
- `D+1 09:30 gate`:
  - features may use bars up to `09:30` only
- anything after the decision cutoff is label-only

## Hard Stops
- fail if `KIWOOM_APP_KEY` or `KIWOOM_SECRET_KEY` is missing
- fail if token issuance fails
- fail if `ka10080` depth probe cannot reach the required historical floor for the intended experiment
- fail if the real minute pilot exhausts history before the requested Step A floor
- fail if multiple pilot symbols return zero usable first pages
- fail if minute backfill depends on direct old-date jumps
- fail if 429 handling would require hidden fallback behavior
- fail if raw minute data is wired into `hourly60m`
- fail if raw minute partitions are added to current full-file loaders wholesale
- fail if completed symbols do not fully cover requested manifest windows
- fail if QC detects duplicate timestamp rows or daily OHLC mismatch
- fail if canonical merge would happen outside the single-writer merge tool

## Initial Heavy-Run Policy
- server only
- default minute collector concurrency:
  - `1 worker`
  - `1.2s~1.5s` minimum inter-request interval
- side daily collectors may run separately with conservative concurrency
- only increase minute concurrency after:
  - [ ] contract smoke passes
  - [ ] depth probe passes
  - [ ] 20-symbol pilot completes with zero QC failures and acceptable 429 rate

## First Execution Order
1. patch docs/contracts/checklists
2. patch `kiwoom_rest_client.py`
3. patch contract/depth probes
4. patch Step A manifest builder
5. patch side daily backfill + QC + merge
6. patch minute backfill + checkpoints + QC + merge
7. patch derived intraday feature dataset builder
8. patch gate-specific bridged feature pack materializer
9. add verify smokes
10. run local smoke set
11. sync to server
12. run server `npm run verify`
13. only then run the first server pilot

## First Server Pilot
- universe:
  - `LOW_GAP_TOP` first
- reason:
  - strongest TP12 source so far
  - smallest high-ROI pilot
- pilot gate:
  - 20 symbols first
  - then full `LOW_GAP_TOP`
  - then expand to `LOW`
  - then to full TP12 Step A candidate universe

## Bundle 9
- [x] add `daily_pack -> explicit allowlist` helper
  - `tools/build_tp12_intraday_allowlist_from_pack.mjs`
  - `tools/run_tp12_intraday_allowlist_from_pack.sh`
  - `tools/server_run_tp12_intraday_allowlist_from_pack.sh`
- [x] add manifest narrowing contract
  - `tools/build_tp12_stepa_intraday_manifest.mjs --allowlist-path=...`
  - fail fast if any allowlist row is not present in the broad Step A source
- [x] propagate allowlist through orchestration
  - `tools/run_kiwoom_tp12_inputs.sh`
  - `tools/run_kiwoom_tp12_pipeline.sh`
- [x] cover with smoke + verify
  - `tools/smoke_tp12_stepa_intraday_manifest.mjs`
  - `scripts/verify.sh`

## Completed Snapshot
- [x] Bundle 1: Kiwoom auth + contract/depth probes
- [x] Bundle 2: Step A intraday request manifest
- [x] Bundle 3: side-daily stage/QC/merge for `investor_daily`, `program_daily`, `trade_strength_daily`
- [x] Bundle 4: minute stage/QC/merge + presence index
- [x] Bundle 5: config/data contract extensions
- [x] Bundle 6: derived intraday feature dataset builder
- [x] Bundle 6.5: Step D bridge for gate-specific intraday feature packs
- [x] Bundle 7: verify/handoff/resume wiring
- [x] Bundle 8: strict orchestration wrappers
- [x] Bundle 9: downstream allowlist narrowing + fresh OOS Step A refresh path

## Master Remaining Patch Queue
This is the authoritative remaining-work checklist. Any next patch should start here and keep this section current.

### Bundle 10: Minute Timestamp and Session Contract Closure
- [x] prove the exact meaning of Kiwoom minute `cntr_tm`
  - `tools/kiwoom_intraday_1m_common.py` now treats `cntr_tm` as already `KST` local
  - removed the incorrect `UTC -> KST` conversion that could shift minute bars by `+9h`
- [x] add an explicit smoke/probe for minute session validity
  - `tools/qc_kiwoom_intraday_1m_stage.py` now fails on `sessionBoundsViolationCount > 0`
  - `tools/probe_kiwoom_rest_contract.py` records normalized minute bounds and fails on out-of-session rows
  - `tools/probe_kiwoom_rest_depth.py` records normalized oldest/newest minute timestamps and session-invalid counts
  - `tools/smoke_kiwoom_intraday_stage_tools.py` and `tools/smoke_kiwoom_rest_probes.py` now prove `09:00/09:01` stays in-session after normalization
- [x] add a minute-depth proof artifact for the actual pilot symbols
  - probe output now records normalized oldest reachable `tsKst`
  - probe output records pages fetched and continuation stop state
  - 429 accounting remains on the collector/checkpoint path; pilot still keeps `minute-max-workers=1`
- [x] keep `minute-max-workers=1` until this bundle is green
- [x] do not start any wider minute pilot before this bundle is green
- [x] pass local and server verification after the root-cause fix

### Bundle 11: First Real Server Pilot
- [x] use only the fresh narrowed manifest as the pilot source:
  - `artifacts/tp12_intraday/request_manifest/run=perfect_proto_low_gap_top_support_scorecard_router_v31_oos_fresh/requests.jsonl`
- [x] cut a small pilot slice from that manifest
  - target: `20 symbols` max
  - keep `tail-policy=require_full_window`
- [x] run side-daily backfill first for the pilot slice
  - `investor_daily`
  - `program_daily`
  - `trade_strength_daily`
- [x] keep side/minute workers at `1`
- [x] run minute backfill second for the same pilot slice
- [ ] persist a pilot summary artifact with:
  - requested symbols
  - requested `(symbol, dateKey)` pairs
  - written rows
  - missing pairs
  - 429 counts
  - oldest reached minute timestamp
  - QC verdict
- [ ] rerun server `verify` after the pilot merge
- [ ] current blocker classification from the real run:
  - `000520` = history depth exhausted before `2024-12-30`
  - `002410` = zero usable first page
  - keep the pilot blocked at minute stage until this classification is widened beyond the first few symbols

### Bundle 12: Pilot QC and Coverage Gate
- [ ] require zero missing requested side-daily pairs
- [ ] require zero missing requested minute presence pairs
- [ ] require zero duplicate `(symbol, tsKst)` rows
- [ ] require zero duplicate `(symbol, dateKey)` side-daily rows
- [ ] require monotonic minute timestamps per `(symbol, tradingDateKey)`
- [ ] require minute aggregated OHLC samples to match canonical daily candles
- [ ] require `presence.status=complete` only when the full requested window is actually present
- [ ] fail the pilot if any requested window is partial
- [ ] fail the pilot if any QC script reports non-zero invalid counts

### Bundle 13: First Derived Feature Artifact
- [ ] build `feature_rows.jsonl` from the real pilot canonical data
- [ ] enable only `d0_close` gate for the first experiment artifact
- [ ] keep `d1_0905`, `d1_0915`, `d1_0930` disabled until `d0_close` is evaluated
- [ ] verify that `d0_close` features use only `D-1..D0`
- [ ] verify that all post-cutoff bars remain label-only
- [ ] emit a summary artifact with:
  - gate id
  - row count
  - symbol count
  - date range
  - feature coverage by family

### Bundle 14: First Bridged Pack and OOS Comparison
- [ ] build a gate-specific bridged Step D pack for `d0_close`
- [ ] add an explicit experiment summary builder for:
  - baseline pack
  - bridged pack
  - same dates
  - same candidate universe
- [ ] compare at minimum:
  - selected rows
  - matched dates
  - hit rate
  - avgNetRet
  - stop-first frequency
- [ ] fail the branch if the bridged pack improves precision only by collapsing coverage
- [ ] do not move to `d1_*` gates before `d0_close` comparison is written down

### Bundle 15: Gate Expansion
- [ ] run `d1_0905` as a separate experiment branch
- [ ] run `d1_0915` only after `d1_0905`
- [ ] run `d1_0930` only after `d1_0915`
- [ ] keep each gate as a separate problem definition
- [ ] never merge `d0_close` and `d1_*` gate rows into a single training/eval artifact
- [ ] document the exact execution-policy interpretation for each gate

### Bundle 16: Side-Daily Expansion Beyond v1
- [ ] implement `shorting_daily`
- [ ] implement `lending_daily`
- [ ] implement `credit_daily`
- [ ] implement `sector_daily`
- [ ] add probe/depth evidence for each new dataset before canonical rollout
- [ ] add each new family to feature generation one family at a time
- [ ] rerun the same baseline-vs-bridged comparison after each family addition
- [ ] do not add multiple new side-data families in one experiment jump

### Bundle 17: Scope Expansion
- [ ] expand from `20-symbol` pilot to full `LOW_GAP_TOP` manifest only after Bundles 10-14 are green
- [ ] expand from full `LOW_GAP_TOP` to full `LOW` only after `LOW_GAP_TOP` shows non-trivial lift without coverage collapse
- [ ] expand from full `LOW` to broader Step A only after `LOW` remains green
- [ ] keep historical minute backfill bounded to the proven reachable floor
- [ ] do not start full Step A 2016-2026 minute backfill until depth proof is explicit

### Bundle 18: Optional Forward-Collection Layer
- [ ] design websocket capture for `0B`, `0D`, `0F`, `0w`, `1h`
- [ ] store these as forward-accrual datasets only
- [ ] do not mislabel forward-only datasets as 10-year historical canonical data

## Go / No-Go Gates
### Gate A: Pre-Collection
- [ ] Kiwoom auth/token smoke green
- [ ] minute timestamp/session contract green
- [ ] minute depth proof reaches the intended pilot floor
- [ ] fresh narrowed manifest exists and matches allowlist `100%`

### Gate B: Small Pilot
- [ ] side-daily pilot green
- [ ] minute pilot green
- [ ] zero partial windows
- [ ] zero QC failures
- [ ] server verify green after merge

### Gate C: First Modeling Lift
- [ ] `d0_close` bridged pack produced
- [ ] same-universe OOS comparison artifact produced
- [ ] lift is not only precision-by-coverage-collapse
- [ ] stop-first or net-return behavior improves meaningfully versus baseline

### Gate D: Expansion
- [ ] `LOW_GAP_TOP` full run green
- [ ] `LOW` full run green
- [ ] side-daily family additions remain green one-by-one
- [ ] minute depth proof still supports intended historical floor

## Risk Register
- [ ] `minute timestamp normalization`
  - risk: KST/UTC mis-normalization silently corrupts all gate timings
  - mitigation: Bundle 10 hard-stop before any wider pilot
- [ ] `429 / rate limit`
  - risk: partial minute history while appearing superficially successful
  - mitigation: keep `minute-max-workers=1`, record rate-limit counts, fail on persistent 429
- [ ] `minute historical floor`
  - risk: reverse continuation never reaches the target train floor
  - mitigation: explicit depth proof artifact and stop condition
- [ ] `trade_strength depth drift`
  - risk: feature availability differs sharply by era
  - mitigation: treat as optional/conditional until deeper history is proven
- [ ] `partial coverage bias`
  - risk: models train only on windows that happened to fill
  - mitigation: `require_full_window` for all serious pilots
- [ ] `selection bias`
  - risk: LOW_GAP_TOP-only success gets mistaken for general Step A lift
  - mitigation: phase-gated expansion `LOW_GAP_TOP -> LOW -> broader Step A`
- [ ] `coverage collapse disguised as precision lift`
  - risk: gate looks better only because it trades almost nothing
  - mitigation: compare `selectedRows`, `matchedDates`, `hitRate`, `avgNetRet` together
- [ ] `stale Step A provenance`
  - risk: narrowed manifest silently drifts from canonical daily data
  - mitigation: always refresh broad OOS Step A before real narrowed runs
- [ ] `disk/headroom`
  - risk: partition rewrite + hardlink backup exhausts server storage
  - mitigation: check headroom before merge and keep pilots small

## Explicit Do-Not-Do
- [ ] do not run full `2016-2026` minute backfill as the first real collection
- [ ] do not reopen exact-rule TP12 search as a substitute for intraday execution work
- [ ] do not wire raw minute partitions into `hourly60m`
- [ ] do not wire raw minute partitions into current whole-file loaders
- [ ] do not treat partial windows as valid training/eval rows
- [ ] do not mix `d0_close` and `d1_*` gates into one experiment artifact
- [ ] do not add multiple new side-data families in the same attribution step

## Immediate Next Action List
1. [x] close Bundle 10 minute timestamp/session contract
2. [ ] run Bundle 11 small side-daily pilot
3. [ ] run Bundle 11 small minute pilot
4. [ ] pass Bundle 12 QC/coverage gate
5. [ ] build Bundle 13 `d0_close` feature artifact
6. [ ] build Bundle 14 `d0_close` bridged pack and OOS comparison
7. [ ] only then decide whether to expand to full `LOW_GAP_TOP`
