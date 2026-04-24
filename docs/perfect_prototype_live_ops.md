# Perfect Prototype Live Ops

Current live operation has one primary predictive path and two legacy reference paths.

Indexed predictive implementation checklist:
- [docs/perfect_prototype_predictive_indexed_checklist.md](/home/saida/code/stockdesk-lab-lite/docs/perfect_prototype_predictive_indexed_checklist.md)

## Quick Start

Primary predictive path after market close:

```bash
tools/run_prejump_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/prejump_frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=YYYY-MM-DD
```

This requires a predictive curated catalog to exist first. Initial setup:

```bash
tools/rebuild_prejump_curated_perfect_prototype_catalog.sh \
  --source-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/<predictive_run>/step-perfect-prototype/catalog.json
```

Predictive live/OOS/apply catalogs must now be treated as frozen artifacts:
- build from one source train catalog
- store under an immutable run-specific path
- carry catalog/rule-set hashes in metadata + manifest
- pass expected catalog hash/rule-id hash into OOS/live consumers
- do not use shared mutable live catalog paths unless explicitly opting in for a manual maintenance task

All live/OOS/apply consumers now require both expected hashes explicitly. Reading only a frozen catalog path is not enough.

Then read:

- `artifacts/runs/<RUN_ID>/step-perfect-prototype-apply/deduped_symbols.jsonl`
- `artifacts/runs/<RUN_ID>/step-perfect-prototype-apply/summary.json`

## Scope

- Primary path: curated predictive catalogs built from `prejump_pack.parquet`, exact token index artifacts, and `v5_prejump_contextual`.
- Predictive training/index primary path is now feature-store-backed and partitioned:
  - build/update `artifacts/feature-store/prejump_v5`
  - build shard-local exact token indexes from that feature store
  - exact-merge shard indexes into one predictive index
- Predictive mining defaults are currently:
  - `maxGapTradingDays = 100000` (effectively disabled)
  - `maxRuleSize = 6`
  - `maxSeedTokens = 4000`
  - `maxRules = 4000`
  - `maxSearchStates = 20000000`
- Legacy parent path: `rule2` via `daily_pack`, kept only for comparison.
- Legacy Step-B path: `171-rule shortlist`, kept only as archived continuation reference.
- Legacy Step-B D+1 baseline line is a separate reproducible reference path:
  - `Step-A -> Step-B -> legacy no-gap miner`
  - semantics remain explicit:
    - `decisionDate=D`
    - `asOfDate=D-1`
    - `entry=D+1 open`
    - `3-day / +8% / -4%`
  - this line is not the predictive primary path
  - do not merge its catalogs or reports into predictive train/OOS/live artifacts
  - wrapper must require explicit split policy:
    - `decision_date_only`
    - `strict_label_boundary`
  - v1 baseline is exact-only:
    - current legacy miner collects only `trainPrecision=1.0` / zero-negative rules
    - lower-precision leaderboard buckets require a later explicit relaxed-precision mode
- Legacy combined union remains available for comparison, not as the primary predictive route.
- All heavy runs are server-only.

## Core idea

Do not re-mine rules every day.

Daily flow after market close:

1. update server raw daily data
2. build one-day predictive `prejump_pack.parquet`
3. run predictive live apply on that parquet pack
4. use legacy parent/Step-B/combined only when explicitly comparing against older catalogs

Live operation excludes any matched row whose recommendation-date close is `>= +28%` versus the previous close. This filter is applied before dedupe on the predictive path and on all legacy comparison paths.
Filtered predictive apply now fails fast if the recommendation close-return sidecar is stale relative to `data/candle_daily.jsonl`; rebuild the sidecar after any candle source refresh:

```bash
node tools/build_recommendation_close_ret_sidecar.mjs \
  --candle-path=data/candle_daily.jsonl \
  --overwrite=true
```

The recommendation close-return sidecar is now a directory-backed v4 artifact:
- root: `artifacts/sidecar/recommendation_close_ret/`
- per-date partitions: `date=YYYY-MM-DD/*.parquet`
- older single-parquet or pre-v4 sidecars are no longer accepted on the predictive primary path

Server market data is authoritative. Local `data/*.jsonl` files are not synced to server by `tools/run_server_command.sh`.
Local `artifacts/curated/` files are synced to server non-destructively so server-built curated catalogs are not deleted on the next sync.
Local `artifacts/feature-store/` files are synced to server non-destructively so server-built predictive feature-store partitions survive later code syncs.
Do not sync local code into the shared server checkout while the long-running historical feature-store bootstrap is still active there. Wait for bootstrap completion before server verify or server smoke on new code.

The output pack is only for one decision date, but feature calculation still reads the required lookback history such as 20/40/150 trading days.

## Predictive mining pipeline

Predictive mining is parquet-first and indexed:

1. build/update predictive feature store
2. build partitioned exact token index from the feature store
3. run indexed miner
4. evaluate OOS
5. rebuild curated catalog from the selected predictive source catalog

Example:

```bash
node tools/build_perfect_prototype_prejump_feature_store.mjs \
  --config=config/lab.config.server.lite.prejump.json \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --feature-store-dir=artifacts/feature-store/prejump_v5

node tools/build_perfect_prototype_partitioned_token_index.mjs \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --feature-store-dir=artifacts/feature-store/prejump_v5 \
  --workspace-dir=artifacts/runs/perfect_proto_prejump_train_workspace_<STAMP> \
  --out-dir=artifacts/runs/perfect_proto_prejump_train_index_<STAMP>/step-perfect-prototype-index

node tools/mine_perfect_prototypes_parallel_indexed.mjs \
  --index-dir=artifacts/runs/perfect_proto_prejump_train_index_<STAMP>/step-perfect-prototype-index \
  --out-dir=artifacts/runs/perfect_proto_prejump_train_mine_<STAMP>/step-perfect-prototype \
  --workers=2
```

`progress.json` is written during index build and indexed mining so long-running predictive jobs can be monitored without guessing wall time.
Parallel exact mining now fails fast if the aggregate explored-state count would exceed the configured global `maxSearchStates` budget.
Predictive index/miner progress and summaries now also expose:
- `seedSelectionMs`
- `partialRuleMergeMs`
- `tokenIdCandidateChecks`
- `sidecarLookupMs`
- `boundPruneCount`
- `memoHitCount`
- `memoLookupMs`
- `stateDominancePruneCount`
- `kthHitFloor`
- `childOrderingMs`
- `orderingNegativeLoads`
- `rowsetModeStats`
- `memoCacheBytes`
- `memoEvictedBucketCount`
- `memoOversizeSkipCount`
- `partialMergePeakBucketCount`
- `partialMergePeakLiveRuleCount`
- `partialMergeEvictedByHitFloorCount`
- `partialMergeKthHitFloor`
- `observedRuleCount`
- `liveCanonicalRuleCount`
- `finalSelectedRuleCount`
- `orderingHeadWindow`
- `orderingHeadExactLoads`
- `orderingHeadRerankMs`
- `partialMergeTieBandRuleCount`
- `partialMergeTieBandBucketCount`
- `partialMergePeakTieBandRuleCount`
- canonical exact mining target is now the full-range train window:
  - `2020-11-27 .. 2024-12-31`
  - fixed semantics:
    - `decisionDate=D`
    - `entry=D+1 open`
    - `3-day / +8% / -4%`
  - primary exact output objective:
    - `precision=1.0`
    - `trainMatchCount>=6`
  - follow-up exact catalog objective on the same full-range index:
    - `precision>=0.8`
    - `trainMatchCount>=6`
- latest valid partitioned predictive index for mining-only reprobe is:
  - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_reprobe_walltime_baseline_v1_20260316_3/step-perfect-prototype-index`
  - this 3-month index is throughput/control-plane validation only
  - it must not be treated as the canonical production target for the full-range exact search
- latest live mining reprobe still shows sparse-state dominance:
  - root states may start as `bitset`
  - actual search states remain overwhelmingly `sparse`
  - sparse CPU v4 is complete and memo skyline v6 is complete
- latest exact-safe hardening bundle completed:
  - `perfect_proto_sparse_bitmap_universe_contract_guard_v1`
  - `perfect_proto_memo_budget_compaction_integrity_v1`
- latest exact-speed bundle completed:
  - `perfect_proto_stepchange_memo_skyline_v6_v1`
- latest exact-safe throughput bundle completed:
  - `perfect_proto_floor_bootstrap_ordering_v1`
  - bootstrap ordering now raises the first global floor earlier without changing exact final selection semantics
- latest exact-safe budget orchestration bundle completed:
  - `perfect_proto_parallel_live_budget_topup_v1`
  - ready-queue chunk budgets now bind by `chunkIndex`, not ready-queue position
  - active chunks may receive deterministic external lease increases via chunk-local `live_budget.json`
- latest explicit budget request/ack bundle completed:
  - `perfect_proto_parallel_budget_request_ack_v1`
  - workers now emit chunk-local `budget_request.json` before failing at a lease edge
  - parent now replies with atomic `budget_decision.json` plus `live_budget.json` grants/denials
- latest commit-on-ack budget bundle completed:
  - `perfect_proto_parallel_topup_commit_on_ack_v1`
  - workers now request additional budget only at true lease exhaustion on the canonical runtime path
  - parent grants request-scoped allowances first and records top-up search states only after worker `budget_commit.json` ack
  - manifest/progress top-up telemetry now reflects applied commits instead of speculative pre-use reservations
- current production-run blocker is:
  - no fresh exact-safe blocker is open in the current parallel budget control-plane path
  - the canonical target is no longer blocked by shard contract repair
  - restored merged full-range exact index:
    - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_fullrange_exact_target_restore_20260317_073337/step-perfect-prototype-index`
  - restored merged effective trading coverage currently resolves to:
    - `2020-11-27 .. 2024-12-30`
  - canonical exact target remains:
    - `2020-11-27 .. 2024-12-31`
  - the holiday-aware effective-trading coverage contract is now closed:
    - requested calendar target remains `2020-11-27 .. 2024-12-31`
    - effective trading coverage is now explicitly accepted as `2020-11-27 .. 2024-12-30`
    - `2024-12-31` is a KRX holiday, not a true source-gap blocker
    - local/server `npm run verify` now pass with the holiday-aware coverage contract smoke
    - fresh 180-second full-range probe `perfect_proto_timeprobe_fullrange_effective_coverage_20260317_082819` observed:
      - `parallelChunkPlannerImbalanceRatio=24.7161`
      - `parallelFirstChunkCompletionElapsedMs=null`
      - top-level live `precision=1.0` / `trainMatchCount>=6` candidates before first chunk completion: `8`
  - canonical server `npm run verify` covers positive persistent-slot traffic plus request/ack, reclaim/ack, live-topup, and guardband smokes
- latest exact-safe target-restoration bundle completed:
  - `perfect_proto_fullrange_shard_dictionary_v2_upgrade_v1`
  - legacy monthly shard dictionaries were upgraded from schema v1 to v2
  - the merged full-range exact index was restored
  - a 180-second exact probe on that index observed `8` live `precision=1.0` / `trainMatchCount>=6` candidates before first chunk completion
- latest exact-safe target coverage/chunk bundle completed:
  - `perfect_proto_fullrange_target_coverage_chunk_rebalance_v1`
  - full-range chunk rebalance now has dedicated verify smoke coverage
- latest exact-safe runtime bundle completed:
  - `perfect_proto_fullrange_effective_trading_coverage_contract_v1`
  - requested calendar target range and effective trading coverage are now separated on the canonical full-range path
- latest exact-safe runtime bundle completed:
  - `perfect_proto_fullrange_chunk_cost_calibration_v1`
  - full-range planner cost now consumes token-dictionary byte/span metadata
  - bootstrap-head ordering now uses `bootstrapDispatchScore`
  - full-range worker-slot ready timeout now tolerates 30s+ cold starts
  - commit-pending allowances are no longer re-granted from the same `budget_request.json`
- current exact-safe runtime blocker is:
  - full-range first-wave dispatch still misranks head chunks on the restored 4-year exact index
  - latest 180-second probe `perfect_proto_timeprobe_fullrange_chunk_cost_calibration_v4_20260317_091243` showed:
    - `parallelChunkPlannerImbalanceRatio=9.5184`
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `worker_000.exploredStatesPerSec=2.218`
    - `worker_001.exploredStatesPerSec=20.556`
- next exact-safe runtime patch is:
  - `perfect_proto_fullrange_head_microprobe_dispatch_v1`
  - remove the hard bootstrap-head prefix from the ready queue and replace it with a bootstrap-head launch quota
  - add deterministic first-wave head microprobe scoring/splitting before the next longer full-range probe
  - split pathological first-wave head chunks deterministically when microprobe cost is materially above the first-wave median
- latest exact-safe runtime bundle completed:
  - `perfect_proto_fullrange_head_microprobe_dispatch_v1`
  - hard bootstrap-head queue prefix is removed; first-wave ordering now uses a quota-aware global dispatch queue plus deterministic microprobe scoring
  - deterministic completion-target splitting now applies to the first `workerCount` launch chunks
  - fresh 180-second full-range probe `perfect_proto_timeprobe_fullrange_first_wave_completion_target_split_20260317_111339` still observed:
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelCompletedChunkCount=0`
    - real budget request/grant/commit/top-up activation on the first pair
  - fresh 20-minute full-range probe `perfect_proto_midprobe_fullrange_first_wave_completion_target_split_20260317_111658` still observed:
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelCompletedChunkCount=0`
    - `parallelBudgetTopupCount=17`
    - `parallelWorkerSlotReuseCount=0`
  - after that patch:
    - do not start the full production run yet
    - latest exact-safe runtime bundle completed:
      - `perfect_proto_fullrange_singleton_root_exact_completion_microprobe_v1`
      - deterministic exact completion-oriented microprobes now cover the full bound singleton-root first-wave candidate pool
      - static-score fallback inside that bound singleton pool is now fail-fast on the live path
      - fresh 180-second probe `perfect_proto_timeprobe_fullrange_singleton_exact_completion_microprobe_20260317_215330` still observed:
        - `parallelFirstWaveExactCompletionProbeCount=17`
        - `parallelFirstWaveExactCompletionProbeSingletonCandidateCount=17`
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - worker search did not materially advance inside the 180-second window
      - fresh 20-minute probe `perfect_proto_midprobe_fullrange_singleton_exact_completion_microprobe_20260317_215701` then confirmed the exact-probe path is live:
        - `parallelFirstWaveExactCompletionProbeCount=17`
        - `parallelFirstWaveExactCompletionProbeReachedTerminalCount=0`
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - `parallelBudgetTopupCount=19`
        - `parallelWorkerSlotReuseCount=0`
        - `worker_000` explored `166302` states with `rulesCollected=0`
        - `worker_001` explored `12960` states with `rulesCollected=18`
    - therefore the remaining blocker moved from startup planning into the first launched worker search pair
    - latest exact-safe runtime bundle completed:
      - `perfect_proto_fullrange_stage1_exact_probe_collapse_v1`
      - keep startup progress telemetry on the primary path
      - move the stage-1 singleton exact-probe off the array-intersection path and onto native rowset/count primitives
      - preserve exact semantics and deterministic first-wave planning contracts
      - re-assert `_slot` directory existence before worker-slot command writes
      - local `npm run verify`: passed
      - server `npm run verify`: passed
    - latest fresh canonical 180-second probe after the stage-1 exact-probe collapse bundle:
      - `perfect_proto_timeprobe_fullrange_stage1_exact_probe_collapse_20260318_143730`
      - `EXIT_STATUS=124`
      - top-level parent phase progressed to `search_ready_queue`
      - planning/probe telemetry before timeout:
        - `parallelPlanningExactProbeStage1ElapsedMs=8141`
        - `parallelPlanningExactProbeStage1ChunksCompleted=24`
        - `parallelPlanningExactProbeStage1ChunkCount=24`
        - `parallelPlanningExactProbeStage2Ms=334`
        - `parallelPlanningReadyQueueMs=5`
        - `parallelDispatchCount=2`
        - `parallelActiveChunkCount=2`
        - `parallelReadyQueueDepth=55`
      - the run still timed out with:
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - `parallelWorkerSlotReuseCount=0`
        - `exploredStates=12076`
        - `mergedObservedRuleCount=0`
      - top-level `parallel_manifest.json` and `summary.json` still did not land before timeout
      - top-level `live_floor.json` was emitted after worker-slot spawn
      - launched worker-local chunks before timeout:
        - `worker_000 / chunk_003 / rootSeed[38,39) / maxSearchStates=9925 / exploredStates=9031 / rulesCollected=0`
        - `worker_001 / chunk_021 / rootSeed[56,57) / maxSearchStates=14227 / exploredStates=3045 / rulesCollected=0`
      - do not advance to the `15~20 minute` probe or the first exact production full run from this result
    - next exact-safe runtime patch is:
      - `perfect_proto_fullrange_first_chunk_exact_search_collapse_v1`
      - keep it one-hypothesis-only:
        - no ranking retune
        - no launch-shape rewrite
        - no candidate-pool shrink
      - target the worker-side exact-search wall after `search_ready_queue` without shrinking the candidate pool
      - surface launched chunk identity and per-chunk search telemetry clearly at the parent level
      - keep the direct single-chunk baseline `perfect_proto_singlechunk_probe_chunk003_20260318_144923` as the comparison point:
        - `rootSeed[38,39)` / `allocatedMaxSearchStates=9925` / `exploredStates=9925` / `real=31.60s`
      - therefore collapse steady-state parent control-plane churn on the primary path before retrying any ranking ideas:
        - no-request budget fastpath polling
        - worker-slot completion polling
      - watch `parallelBudgetFastpathTickCount`, `parallelBudgetFastpathServiceMs`, and parent-emitted active chunk telemetry on the next canonical `180s` probe
      - bundle scope:
        - idle fastpath ticks must not call the budget service when no request/commit activity exists
        - worker-slot completion polling must become progress-aware rather than unconditional fixed-rate polling
        - record `parallelBudgetFastpathIdleSkipCount` to prove idle ticks were skipped instead of serviced
        - split worker-slot completion polling into hot vs steady counters on the parent path
        - `tools/smoke_prejump_parallel_active_chunk_telemetry.mjs` and `tools/smoke_prejump_search_state_cache_incremental_range_summary.mjs` both belong in the verify gate for this patch
      - current status:
        - local verify passed with the control-plane churn patch
        - targeted server smokes for `indexed_acceleration_adversarial`, `parallel_active_chunk_telemetry`, and `parallel_slot_request_grant_integrated` all passed in isolation
        - do not re-run the canonical `180s` full-range probe until one full server `npm run verify` sweep completes without the current unrelated DuckDB/index smoke flakes
      - expose worker-side live exact-search counters during active search, not only after summary write:
        - `currentSearchDepth`
        - `maxSearchDepth`
        - `candidateDescriptorCount`
        - `acceptedCandidateCount`
        - worker `updatedAt`
        - parent-observed `progressAgeMs`
        - cumulative rowset runtime counters
      - keep launched-pair budget context visible in the same parent artifact:
        - `baseAllocatedMaxSearchStates`
        - `guardBandAllocatedSearchStates`
        - `allocatedMaxSearchStates`
        - `effectiveAllocatedMaxSearchStates`
        - `remainingGlobalSearchBudgetAtLaunch`
      - keep the new rowset-native stage-1 path intact
      - do not re-open previously failed ranking-only patch lines
      - the next canonical `180s` probe is only a `Go` if parent progress surfaces the launched pair with non-stale detail, `parallelBudgetFastpathIdleSkipCount > 0`, `parallelWorkerSlotCompletionSteadyPollCount > 0`, and the remaining worker-local wall is directly visible there
    - latest exact-safe runtime bundle completed:
      - `perfect_proto_fullrange_first_chunk_exact_search_collapse_v1`
      - keep ranking, launch shape, and candidate-pool size unchanged
      - preserve the rowset-native stage-1 exact-probe path
      - collapse worker-side memo frontier range-summary churn on the live exact-search path
      - surface launched chunk identity and worker search telemetry at the parent `parallelActiveChunks` layer
      - local `npm run verify`: passed
      - server `npm run verify`: passed
    - latest fresh canonical 180-second probe after the first-chunk exact-search collapse bundle:
      - `perfect_proto_timeprobe_fullrange_first_chunk_exact_search_collapse_20260318_150309`
      - `EXIT_STATUS=124`
      - top-level parent state before timeout:
        - `phase=search_ready_queue`
        - `parallelDispatchCount=2`
        - `parallelActiveChunkCount=2`
        - `parallelReadyQueueDepth=55`
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - `parallelWorkerSlotReuseCount=0`
        - `exploredStates=33798`
        - `mergedObservedRuleCount=0`
      - top-level control-plane counters before timeout:
        - `parallelBudgetFastpathTickCount=1132`
        - `parallelBudgetFastpathHotTickCount=775`
        - `parallelBudgetFastpathIdleTickCount=289`
        - `parallelBudgetFastpathServiceMs=33558`
        - `parallelWorkerSlotCompletionPollCount=938`
        - `parallelWorkerSlotCompletionPollServiceMs=17555`
        - `parallelBudgetRequestCount=2`
        - `parallelBudgetGrantCount=2`
        - `parallelBudgetCommitCount=2`
        - `parallelBudgetTopupCount=2`
      - top-level artifacts before timeout:
        - `progress.json`: present
        - `live_floor.json`: present
        - `parallel_manifest.json`: absent
        - `summary.json`: absent
      - parent-visible launched pair before timeout:
        - `worker_000 / chunk_017 / rootSeed[52,53) / allocated=14236 / effective=22428 / explored=20480 / statesPerSec=163.816 / eta=11.9 / memoLookupMs=1579.254 / rowsetIntersectionMs=1300.129 / orderingNegativeLoads=21832 / seedCacheHitRate=0.497444 / memoRangeSummaryRebuildCount=0 / depth=6/6 / candidateDescriptorCount=24193 / acceptedCandidateCount=20480 / rulesCollected=0`
        - `worker_001 / chunk_023 / rootSeed[58,59) / allocated=10464 / effective=18656 / explored=13318 / statesPerSec=111.835 / eta=47.7 / memoLookupMs=1363.825 / rowsetIntersectionMs=1126.366 / orderingNegativeLoads=13630 / seedCacheHitRate=0.082609 / memoRangeSummaryRebuildCount=0 / depth=6/6 / candidateDescriptorCount=18344 / acceptedCandidateCount=13318 / rulesCollected=0`
      - this clears one runtime hypothesis and tightens the next one:
        - parent launched-pair visibility is now live
        - `memoRangeSummaryRebuildCount=0` on both active workers, so the prior memo frontier rebuild wall is cleared on the canonical path
        - the remaining blocker is now the worker exact-search inner loop after `search_ready_queue`, not the previous startup/probe wall
      - `perfect_proto_fullrange_worker_exact_search_wall_v1` is now complete:
        - local/server `npm run verify` both passed
        - fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_exact_search_wall_20260319_053613` still ended with:
          - `EXIT_STATUS=124`
          - `phase=search_ready_queue`
          - `parallelDispatchCount=2`
          - `parallelActiveChunkCount=2`
          - `parallelCompletedChunkCount=0`
          - `parallelFirstChunkCompletionElapsedMs=null`
        - the parent-visible telemetry contract is now live on the canonical path:
          - `parallelBudgetFastpathIdleSkipCount=564`
          - `parallelWorkerSlotCompletionHotPollCount=181`
          - `parallelWorkerSlotCompletionSteadyPollCount=236`
          - launched-pair budget context and worker exact-search counters are present under `parallelActiveChunks`
        - the remaining wall is now directly attributed to worker exact-search load/build cost:
          - worker `chunkIndex=17`: `seedPostingLoadMs=122108`, `candidateDescriptorBuildMs=55503`, `negativeCountResolutionMs=66299`, `childRowsetMaterializeMs=2149`, `rowsetIntersectionMs=3916.203`
          - worker `chunkIndex=23`: `seedPostingLoadMs=132350`, `candidateDescriptorBuildMs=44744`, `negativeCountResolutionMs=87587`, `childRowsetMaterializeMs=1215`, `rowsetIntersectionMs=1849.407`
      - `perfect_proto_fullrange_worker_seed_posting_load_collapse_v1` is now complete:
        - local/server `npm run verify` both passed
        - fresh clean canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_seed_posting_load_collapse_20260319_055500` still ended with:
          - `EXIT_STATUS=124`
          - `phase=search_ready_queue`
          - `parallelDispatchCount=2`
          - `parallelActiveChunkCount=2`
          - `parallelCompletedChunkCount=0`
          - `parallelFirstChunkCompletionElapsedMs=null`
          - `exploredStates=1164288`
        - the bundle did materially collapse the previous worker wall:
          - worker `chunkIndex=17`: `seedPostingCacheEntryLimit=1496`, `seedCacheHitRate=0.999353`, `seedPostingLoadMs=3426`, `negativeCountResolutionMs=6290`
          - worker `chunkIndex=23`: `seedPostingCacheEntryLimit=1496`, `seedCacheHitRate=0.998922`, `seedPostingLoadMs=4444`, `negativeCountResolutionMs=10586`
        - deeper worker progress now shows the next hidden wall:
          - worker `chunkIndex=17`: `memoRangeSummaryRebuildCount=461`, `memoLookupMs=20561.056`, `rowsetIntersectionMs=28349.389`
          - worker `chunkIndex=23`: `memoRangeSummaryRebuildCount=272`, `memoLookupMs=28404.305`, `rowsetIntersectionMs=31897.987`
      - next exact-safe runtime patch is:
        - `perfect_proto_fullrange_worker_memo_range_summary_rebuild_collapse_v1`
        - keep it one-hypothesis-only:
          - no ranking retune
          - no launch-shape rewrite
          - no candidate-pool shrink
          - no rowset-algorithm rewrite in the same bundle
        - preserve the improved seed posting cache path and parent launched-pair visibility
        - target the re-emerged memo range-summary rebuild / lookup wall on the deeper worker exact-search path
          - launched-pair `guardBandAllocatedSearchStates`
          - launched-pair `remainingGlobalSearchBudgetAtLaunch`
        - rowset follow-up stays gated behind a fresh canonical `180s` probe from this memo bundle:
          - that gate is now satisfied by `perfect_proto_timeprobe_fullrange_worker_memo_range_summary_rebuild_collapse_20260319_063229`:
            - launched-pair `memoRangeSummaryRebuildCount=0/0`
            - launched-pair `memoLookupMs=21361.065/28913.143` remained dominant
          - `perfect_proto_fullrange_worker_rowset_fused_count_fill_v1` is now complete:
            - local `npm run verify` passed
            - server `npm run verify` passed
            - fresh clean canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_rowset_fused_count_fill_20260319_064709` still ended with:
              - `parallelCompletedChunkCount=0`
              - `parallelFirstChunkCompletionElapsedMs=null`
              - `mergedObservedRuleCount=0`
            - but the launched-pair worker counters moved in the expected direction:
              - worker `chunkIndex=17`: `rowsetIntersectionMs 28349.389 -> 28301.895`, `childRowsetMaterializeMs 12127 -> 8829`, `acceptedCandidateCount 604011 -> 609131`
              - worker `chunkIndex=23`: `rowsetIntersectionMs 31897.987 -> 30208.49`, `childRowsetMaterializeMs 15472 -> 10893`, `acceptedCandidateCount 562747 -> 569915`
            - the rowset bundle therefore removed real duplicate materialization work without shrinking the live candidate flow, but it did not yet create first chunk completion
          - feature pruning / row pruning remain blocked until a later contribution-diagnostics bundle proves contract-safe low-yield features or rows
      - `perfect_proto_fullrange_feature_row_contribution_diagnostics_v1` is now complete:
        - local `npm run verify` passed
        - server `npm run verify` passed
        - fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_feature_row_first_wave_diagnostics_20260318_221626` still ended with:
          - `parallelCompletedChunkCount=0`
          - `parallelFirstChunkCompletionElapsedMs=null`
          - `mergedObservedRuleCount=0`
        - but canonical worker progress now exposes feature/row contribution telemetry on the live exact path:
          - launched `chunkIndex=17` tracked `386` features; top selection/cost keys were led by `feature.pattern.closeClusterTightness3`, `feature.pattern.closeClusterTightness5`, `feature.shape.sidewaysScore3`, `feature.trend.closeOverMa5`, `feature.trend.closeNearMa5Pct`
          - launched `chunkIndex=23` tracked `385` features; top selection/cost keys were led by `feature.trend.closeNearMa60Pct`, `feature.trend.highNearMa60Pct`, `feature.trend.closeNearMa10Pct`, `feature.trend.highNearMa20Pct`, `feature.trend.highNearMa120Pct`
          - both launched workers still had `exactRuleCount=0` and `livePartialSnapshotRuleCount=0`
          - row diagnostics showed `duplicateSourceIdRowCount=0` and `duplicateSymbolDateRowCount=0`, so no duplicate-row pruning proof exists yet
        - contribution diagnostics therefore unlocked measurement, not pruning:
          - feature pruning remains blocked
          - row pruning remains blocked
      - `perfect_proto_fullrange_first_wave_exact_yield_diagnostics_v1` is now complete:
        - local `npm run verify` passed
        - server `npm run verify` passed
        - the same fresh canonical `180s` probe observed:
          - launched `chunkIndex=17`: `candidateDescriptorCount=322418`, `acceptedCandidateCount=317069`, `yieldCandidateAcceptanceRate=0.98341`, `yieldRulesPerAcceptedCandidate=0`
          - launched `chunkIndex=23`: `candidateDescriptorCount=308323`, `acceptedCandidateCount=301205`, `yieldCandidateAcceptanceRate=0.976914`, `yieldRulesPerAcceptedCandidate=0`
          - ready-queue head telemetry did not show an obvious better first-wave alternative on the same score axis:
            - queued `chunkIndex=24` stayed at `firstWaveDispatchScore=0.019356`
            - launched pair were already at `0.019801/0.019695`
            - next queued multi-root heads were far lower at `0.000145/0.000125/0.000123`
        - interpretation:
          - launch-policy retuning is still blocked
          - the current launched pair is already consuming a high-acceptance candidate flow but still yields zero exact/live-partial rules inside `180s`
          - the remaining wall is still the deeper worker exact-search loop or the low rule density of this exact line, not an obvious first-wave mislaunch
      - `perfect_proto_fullrange_worker_memo_lookup_fastpath_v1` is now complete:
        - local/server `npm run verify` both passed
        - fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_memo_lookup_fastpath_20260319_000001` timed out with `EXIT_STATUS=124`
        - top-level remained:
          - `phase=search_ready_queue`
          - `parallelCompletedChunkCount=0`
          - `parallelFirstChunkCompletionElapsedMs=null`
          - `mergedObservedRuleCount=0`
        - launched-pair worker snapshots showed:
          - `chunkIndex=17`
            - `memoLookupMs=9956.397`
            - `memoLookupFingerprintMs=917.961`
            - `memoLookupExactFingerprintScanMs=239.022`
            - `memoLookupRangeSummaryPrepMs=73.44`
            - `memoLookupPrefixScanMs=127.449`
            - `memoLookupSuffixScanMs=115.693`
            - `memoLookupEntryScanCount=1061`
            - `memoLookupFingerprintMissCount=307206`
            - `memoLookupRangeCandidateBucketCount=284`
            - `rulesCollected=0`
            - `livePartialRuleCount=0`
          - `chunkIndex=23`
            - `memoLookupMs=13689.376`
            - `memoLookupFingerprintMs=1025.02`
            - `memoLookupExactFingerprintScanMs=152.848`
            - `memoLookupRangeSummaryPrepMs=88`
            - `memoLookupPrefixScanMs=95.456`
            - `memoLookupSuffixScanMs=82.193`
            - `memoLookupEntryScanCount=906`
            - `memoLookupFingerprintMissCount=295946`
            - `memoLookupRangeCandidateBucketCount=274`
            - `rulesCollected=0`
            - `livePartialRuleCount=0`
        - interpretation:
          - the bundle added the missing lookup decomposition telemetry and preserved exact behavior
          - it did **not** reduce launched-pair `memoLookupMs`
          - the instrumented fingerprint/range/prefix/suffix buckets explain only a minority of lookup wall-time, so the next blocker has shifted to the uncovered memo miss-path
      - next exact-safe runtime patch is now:
        - `perfect_proto_fullrange_worker_memo_miss_path_breakdown_v1`
        - keep launch policy, candidate pool, rowset semantics, and exact semantics fixed
        - target:
          - positive-bucket fingerprint/equality lookup
          - collision-bucket scan
          - negative-rowset clone/estimate
          - frontier insertion/index maintenance
        - do not mix this bundle with:
          - feature pruning
          - row pruning
          - launch retune
          - ranking retune
          - candidate-pool shrink
      - do not advance to the `15~20 minute` probe or the first exact production full run from this result
    - canonical full-range exact production mining inputs are:
      - feature store root: `/home/moltook/apps/stockdesk-lab-lite/artifacts/feature-store/prejump_v5`
      - contextual surface: `v5_prejump_contextual`
      - restored merged exact index: `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_fullrange_exact_target_restore_20260317_073337/step-perfect-prototype-index`
    - canonical full-range exact production mining command, once the blocker is closed, is:
      - `node tools/mine_perfect_prototypes_parallel_indexed.mjs --index-dir=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_fullrange_exact_target_restore_20260317_073337/step-perfect-prototype-index --out-dir=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/<RUN_ID>/step-perfect-prototype --train-start=2020-11-27 --train-end=2024-12-31 --min-hit-count=6 --max-gap=100000 --max-rule-size=6 --max-seed-tokens=4000 --max-rules=4000 --max-search-states=20000000 --workers=2 --ordering-head-window=8 --search-state-cache-max-bytes=134217728`
  - the root-seed microshard patch is now complete:
    - `perfect_proto_fullrange_first_wave_root_seed_microshard_v1`
    - canonical verify now includes `smoke_prejump_parallel_fullrange_root_seed_microshard.mjs`
    - fresh 180-second probe `perfect_proto_timeprobe_fullrange_multi_root_completion_ranking_20260317_172733` still ended with:
      - `parallelCompletedChunkCount=0`
      - `parallelFirstChunkCompletionElapsedMs=null`
      - `parallelBudgetTopupCount=4`
      - `parallelFirstWaveSingletonRootChunkCount=2`
      - `parallelFirstWaveMultiRootChunkCount=0`
    - slot command inspection on that probe showed the first pair reverted to singleton roots:
      - `rootSeedStartIndex=962`, `rootSeedEndIndexExclusive=963`
      - `rootSeedStartIndex=89`, `rootSeedEndIndexExclusive=90`
      - `parallelBudgetTopupCount=1`
    - slot command inspection on that probe showed the first pair was already singleton-root scoped:
      - `rootSeedStartIndex=962`, `rootSeedEndIndexExclusive=963`
      - `rootSeedStartIndex=11`, `rootSeedEndIndexExclusive=12`
    - therefore the active runtime blocker is now post-split singleton-root rescoring, not multi-root microsharding
  - rerun a `180-second` full-range probe after the singleton-root post-split rescoring patch
  - only if first chunk completion appears should the `15~20 minute` probe and then the first exact full production mining run begin
- current objective is one exact production mining run on the restored full-range index, not another 3-month measurement-only reprobe
- ready-queue live-floor bundle must preserve:
  - exact search semantics
  - exact final rule set / champion / matches / coverage
  - deterministic final rule ranking / champion selection regardless of worker completion timing
  - `< kthHitFloor` prune only; `== kthHitFloor` remains non-prunable
- memo cache resident-byte contract now requires:
  - `memoCacheBytes` must equal the live resident bytes of positive buckets plus frontier entries
  - bucket eviction must subtract both bucket base bytes and frontier entry bytes
  - insertion-path frontier compaction must increment `memoFrontierCompactionCount`
- short mining-only reprobe throughput readings taken before the resident-byte fix are not canonical
- ready-queue parent progress / manifest must expose:
  - `parallelChunkCount`
  - `parallelWaveCount`
  - `parallelCompletedChunkCount`
  - `parallelCompletedWaveCount`
  - `parallelGlobalKthHitFloor`
  - `parallelFloorSeededChunkCount`
  - `parallelWaveMergeMs`
  - `parallelChunkPlannerImbalanceRatio`
- ready-queue mining now also requires launch-time global search-budget leasing:
  - every chunk run must record `allocatedMaxSearchStates`
  - every chunk run must also record:
    - `baseAllocatedMaxSearchStates`
    - `guardBandAllocatedSearchStates`
    - `effectiveAllocatedMaxSearchStates`
  - every chunk run must record `remainingGlobalSearchBudgetAtLaunch`
  - no later chunk may launch after a chunk truncates at its leased budget
  - a worker must never report `exploredStates` above `effectiveAllocatedMaxSearchStates`
- ready-queue telemetry must also expose:
  - `parallelReadyQueueDepth`
  - `parallelDispatchCount`
  - `parallelImmediateRefillCount`
  - `parallelLiveFloorUpdateCount`
  - `parallelLiveFloorRevision`
  - `parallelFirstGlobalFloorElapsedMs`
  - `parallelActiveAllocatedSearchBudget`
  - `parallelSlotIdleMs`
- top-level `progress.json` must continue updating during active search and expose:
  - `parallelActiveChunkCount`
  - `parallelActiveWaveExploredStates`
  - `parallelActiveWaveRulesCollected`
  - `parallelActiveWaveMemoLookupMs`
  - `parallelActiveWaveEtaSeconds`
  - `parallelRemainingSearchBudget`
  - `parallelRemainingGrantableSearchBudget`
  - `parallelOutstandingAllowanceSearchStates`
  - `parallelOutstandingAllowanceChunkCount`
  - `parallelAllowanceToCommitLagMs`
- startup planning must also expose:
  - `parallelFirstTopLevelProgressElapsedMs`
  - `parallelPlanningValidateIndexProvenanceMs`
  - `parallelPlanningSeedSelectionMs`
  - `parallelPlanningSeedDictionaryPlanningMs`
  - `parallelPlanningHeadMicroprobePass1Ms`
  - `parallelPlanningHeadMicroprobePass2Ms`
  - `parallelPlanningExactProbeStage1Ms`
  - `parallelPlanningExactProbeStage2Ms`
  - `parallelPlanningReadyQueueMs`
  - `parallelPlanningFirstWaveFrontierSplitMs`
  - `parallelPlanningFirstWaveLaunchSplitMs`
  - `parallelPlanningRootSeedMicroshardMs`
  - `parallelPlanningReadyQueueRebuildCount`
  - `parallelPlanningRescoredChunkCount`
  - `parallelPlanningMicroprobeReuseCount`
  - `parallelPlanningExactProbeStage1ElapsedMs`
  - `parallelPlanningExactProbeStage1ChunksCompleted`
  - `parallelPlanningExactProbeStage1ChunkCount`
  - `parallelPlanningExactProbeStage1ExploredStates`
  - `parallelPlanningExactProbeStage1CurrentChunkIndex`
- running worker progress / summary must also expose:
  - `externalKthHitFloor`
  - `externalKthHitFloorRevision`
  - `externalKthHitFloorPollCount`
  - `externalKthHitFloorAppliedCount`
  - `effectiveKthHitFloor`
- live partial-rule floor bundle must also expose:
  - parent:
    - `parallelLivePartialRuleRevisionCount`
    - `parallelLivePartialRuleMergeMs`
    - `parallelLivePartialFloorUpdateCount`
    - `parallelFirstLivePartialFloorElapsedMs`
    - `parallelActiveLiveRuleCount`
  - worker:
    - `livePartialRuleRevision`
    - `livePartialRuleCount`
    - `livePartialRuleCheckpointCount`
    - `livePartialRuleWriteMs`
    - `livePartialLocalKthHitFloor`
- bootstrap floor-ordering bundle must also expose:
  - parent:
    - `parallelBootstrapChunkCount`
    - `parallelFirstChunkCompletionElapsedMs`
    - `parallelActiveChunks` with launched chunk identity plus live worker progress counters
    - `parallelFirstBootstrapFloorElapsedMs`
    - `parallelBootstrapFloorSeededLaunchCount`
  - worker:
    - `livePartialBootstrapSnapshotCount`
    - `livePartialBootstrapRuleCount`
    - `livePartialBootstrapModeActive`
- first-chunk exact-search collapse bundle must also emit parent-visible active chunk telemetry during `search_ready_queue`:
  - `parallelActiveChunks[].chunkIndex`
  - `parallelActiveChunks[].dispatchOrder`
  - `parallelActiveChunks[].workerSlotIndex`
  - `parallelActiveChunks[].rootSeedStartIndex`
  - `parallelActiveChunks[].rootSeedEndIndexExclusive`
  - `parallelActiveChunks[].phase`
  - `parallelActiveChunks[].progressUpdatedAt`
  - `parallelActiveChunks[].progressAgeMs`
  - `parallelActiveChunks[].exploredStates`
  - `parallelActiveChunks[].exploredStatesPerSec`
  - `parallelActiveChunks[].etaSeconds`
  - `parallelActiveChunks[].memoRangeSummaryRebuildCount`
  - `parallelActiveChunks[].orderingNegativeLoads`
  - `parallelActiveChunks[].currentSearchDepth`
  - `parallelActiveChunks[].maxSearchDepth`
  - `parallelActiveChunks[].candidateDescriptorCount`
  - `parallelActiveChunks[].acceptedCandidateCount`
  - `parallelActiveChunks[].rowsetIntersectionMs`
- next hardening bundle after ready-queue/live-floor is:
  - `perfect_proto_parallel_atomic_control_plane_v1`
  - parent `progress.json`, worker `progress.json`, worker `summary.json`, `parallel_manifest.json`, and `live_floor.json` must be written atomically
  - parent active progress polling must fail fast on malformed control-plane JSON once the file exists
  - running worker live-floor polling must fail fast on malformed/unreadable `live_floor.json`
  - bootstrap `ENOENT` before the first parent floor write is the only allowed missing-file case
- live partial-rule floor bundle must preserve:
  - exact final rule set / champion / matches / coverage
  - exact `< kthHitFloor` pruning only
  - no duplicate counting of active worker snapshot revisions in the parent live-floor aggregate
  - per-chunk live snapshots must include at least the local canonical top `maxRules` and may extend through the local snapshot tie band
  - the live partial-rule aggregate may only strengthen the current floor; it must never lower a previously published floor
- memo skyline v6 validation and memo budget/compaction integrity validation must reuse the current valid index and run mining-only reprobe
- do not reduce `maxSeedTokens`, `maxRules`, or `maxSearchStates` to force earlier completion
- do not solve chunk-budget overruns by shrinking search-space knobs; fix worker stop semantics and chunk leasing instead
- bootstrap live partial-rule overscan remains control-plane only and must not alter exact final selection semantics
- approximate or degraded pruning remains forbidden
- dense sparse/bitset and dense bitset/bitset result contracts now require:
  - explicit `universeSize` exactly equal to the canonical dense result universe
  - exact output word length `ceil(universeSize / 32)`
  - no out-of-universe bits in the last output word
- smaller explicit dense universes must fail fast; clipping or silent ignore is forbidden
Integrated native exact-mining acceleration contract:
- predictive indexed mining now targets a required native exact runtime bundle:
  - native exact rowset kernel
  - native delta postings decode
  - native exact sparse/plain-bitset backend
  - required sparse kernel mode: `adaptive_exact_v4`
- this bundle is fail-fast only:
  - no hidden JS fallback
  - no approximate bitmap mode
  - no degraded runtime path when native build/load fails
- native preflight is now part of the mining gate:
  - `bash scripts/build_native_rowset_kernel.sh`
  - `bash scripts/verify_native_rowset_kernel.sh`
  - the direct `scripts/build_native_rowset_kernel.sh` compiler path is the only canonical native build contract
  - `scripts/sync_to_server.sh` must exclude `native/perfect_prototype_rowset_kernel/build/` so code sync never overwrites the server-built `.node`
  - server verify/smoke must use the server-built native rowset kernel only
  - direct server smoke/debug must also fail fast before addon load when the native build manifest or native/source hashes are stale
Exact indexed mining acceleration currently relies on these invariants:
- count-first pruning is only allowed for exact-safe reject gates
- top-K hit bound is allowed only on full-output indexed mining or disjoint-root partial workers, and only on `< kthHitFloor`
- dominance memo requires same positive rows, a subset negative frontier, `startAt <= nextStartAt`, and strictly smaller `ruleSize`
- dominance memo is byte-bounded; evictions only remove memo opportunities and must never change final rule semantics
- child ordering may change traversal order only; it must not change canonical token availability or introduce suffix-wide exact negative prefetch as a prerequisite
- dense rowset fast paths are allowed only when the exact result stays in bitset form with the same counted membership
- bitset/bitset sparse intersections must materialize sparse results directly without an intermediate dense result buffer
- parent parallel partial merge may use a live top-K hit floor only to evict rules with `trainHitCount < partialMergeKthHitFloor`
- `collectedRuleCount` is no longer a stable diagnostic contract; use:
  - `observedRuleCount`
  - `liveCanonicalRuleCount`
  - `finalSelectedRuleCount`
- ordering head rerank may only reorder a bounded head window and must not prune
- `trainHitCount === partialMergeKthHitFloor` tie-band rules are non-evictable during partial merge
- native rowset engine invariants:
  - native count/materialize paths must match exact JS semantics on the same fixture
  - native delta decode must fail fast on universe overflow, malformed varints, count mismatch, and stale build-manifest mismatch
  - external rowset modes remain:
    - `sparse`
    - `bitset`
  - backend metadata must not be documented as a compressed-container guarantee
Excluded from the current runtime-completion bundle:
- real compressed bitmap 2-container backend
- diffset negative-state engine
Index merge acceleration contract:
- the current index-stage primary-path bottleneck is `merge_postings`
- partitioned index progress / ETA must use actual merged distinct token counts, not the sum of per-shard token counts
- primary-path dictionary merge must use one canonical global stream instead of per-shard FIFO fanout
- canonical global stream ordering must be:
  - `token`
  - `shardIndex`
- merge completion must fail fast unless:
  - `mergedTokenCount == expectedDistinctTokens`
  - `dictionaryCursorRows == expectedDictionaryRefRows`
- merged-dictionary stats must be emitted during the same canonical materialization stage; do not recompute them from a later shard-union rescan
- the canonical merged-dictionary temp artifact must be emitted as an already ordered direct stream and consumed without a second DuckDB/parquet order pass
- duplicate `(token, shardIndex)` refs inside one merged token group must fail fast
- partitioned merge must preflight shard token-dictionary schema before merge starts:
  - `tokenDictionarySchemaVersion >= 2`
  - required columns include `positiveFirstRowIdx`, `positiveLastRowIdx`, `negativeFirstRowIdx`, `negativeLastRowIdx`
- primary-path `token_postings.bin` merge must use required native shifted-delta merge
- debug-only `emitTokenPostingsParquet=true` may remain slower, but exact output semantics must match
- current index merge acceleration bundle intentionally excludes:
  - real compressed bitmap 2-container backend
  - rowset pool / ownership refactor
  - diffset negative-state engine
  - full postings splice-merge optimization
  - DuckDB row-bridge replacement with a non-JSON transport
  - file-to-file postings splice finalization
- completed rowset/splice step-change bundle covered:
  - rowset pool / ownership refactor on the indexed-mining primary path
  - native postings splice merge on the primary `token_postings.bin` merge path
  - strong local/server equivalence coverage for borrowed-rowset ownership and splice metadata contracts
- exact rowset/splice bundle invariants:
  - primary indexed-mining intersections may use borrowed rowsets only inside one local expansion scope
  - long-lived memo/cache state must store owned rowsets only
  - borrowed rowset escape is fail-fast
  - primary `token_postings.bin` merge must not materialize a merged JS buffer before write
  - native splice merge must fail fast on bad first/last-row metadata, malformed first varints, and non-monotonic shifted rows
- explicitly out of scope for this bundle:
  - compressed bitmap backend
  - SIMD native rowset kernel rewrite
  - diffset negative-state engine
- next step-change bundle now targets:
  - AVX2/POPCNT-required exact native bitset kernel on the current dense backend
  - dense/dense count / materialize / equality / subset hot loops first
  - strong local/server equivalence coverage for dense exactness under the unchanged `sparse|bitset` rowset contract
- SIMD bitset bundle invariants:
  - dense primary backend remains the current exact plain-bitset backend
  - compressed bitmap container backends stay deferred
  - x86_64 + AVX2 + POPCNT are required on the canonical runtime path
  - build/verify/runtime must fail fast if the SIMD contract is unavailable
  - hidden scalar degraded fallback is forbidden
  - scalar tail handling is allowed only as an internal exact tail path inside the AVX2-required kernel
- explicitly out of scope for this SIMD bundle:
  - compressed bitmap backend
  - run-container / roaring-style container expansion
  - diffset negative-state engine
  - skyline memo fingerprint buckets with delete/update that do not rebuild arrays
- next step-change bundle now targets:
  - `perfect_proto_stepchange_structured_sink_completion_v1`
  - remove the remaining predictive primary-path JSONL parquet sinks
  - migrate feature-store / pack / partial-rules / sidecar indexes to explicit structured fixed-schema sinks
  - keep logical wrapper/rule contracts unchanged by parsing structured JSON text explicitly on read
  - fail fast on schema drift, invalid structured payloads, or legacy sink-mode activation
- next exact-speed bundle after structured sinks now targets:
  - `perfect_proto_stepchange_sparse_kernel_merge_stream_v1`
  - replace merged-dictionary temp JSONL materialization/parsing with a fixed-schema delimited stream on the canonical partitioned-index merge path
  - accelerate sparse/sparse and sparse/bitset exact native rowset kernels without changing the public `sparse|bitset` rowset contract
  - move bitset first/last edge-summary lookup onto the native exact runtime path
  - keep compressed bitmap backend deferred
- next exact-speed bundle after sparse-kernel/merge-stream now targets:
  - `perfect_proto_stepchange_query_stream_completion_v1`
  - replace predictive primary parquet JSON query streams with fixed-schema delimited/structured query streams
  - migrate row-meta, token-stats, typed wrapper, partial-rule, feature-values sidecar, recommendation sidecar, shard row-meta merge, and ordered token-index wrapper streams off the JSON fifo bridge
  - keep logical wrapper/rule semantics unchanged and fail fast on schema/type/structured-json drift
- next exact-speed bundle after query-stream completion now targets:
  - `perfect_proto_stepchange_table_stream_completion_v1`
  - replace the remaining primary `token_postings` table readback JSON bridge with a fixed-schema delimited table stream
  - require explicit schema/select contracts for canonical DuckDB table-sink `streamRows()` calls
  - keep `token, rowIdx` deterministic ordering and exact postings/dictionary output unchanged
  - fail fast if the canonical table-stream mode is not `delimited`
- next exact-speed bundle after table-stream completion now targets:
  - `perfect_proto_stepchange_sparse_cpu_v3_v1`
  - strengthen sparse/sparse and sparse/bitset exact native kernels on the canonical indexed-mining path
  - expose sparse runtime counters that separate near-size merge from galloping and sparse/bitset word-run behavior
  - keep public `sparse|bitset` rowset modes and all exact mining semantics unchanged
  - fail fast if the canonical sparse-kernel contract is disabled
- latest server re-probe conclusion:
  - current patch stack completed index-only re-probe successfully
  - mining live probe showed sparse-state dominance on the canonical search path
  - sparse CPU is the next canonical step-change; memo skyline is the follow-up bundle
- completed exact-speed bundle after sparse CPU v3:
  - `perfect_proto_stepchange_memo_skyline_v5_v1`
  - canonical memo skyline frontier buckets now carry impossible-bucket skip metadata and explicit tombstone compaction
  - mining summaries now expose `memoFrontierSkippedBucketCount` and `memoFrontierCompactionCount`
  - exact dominance semantics remain unchanged
  - `PREJUMP_MEMO_SKYLINE_V3=true` remains the required runtime gate for the skyline v5 implementation
  - fail fast if the canonical memo skyline contract is disabled
- next follow-up after memo skyline v5:
  - first close native runtime stale-binary fail-fast and parallel telemetry completion
  - then reuse the current canonical index artifact and run a mining-only reprobe before starting any further cleanup bundle
- current runtime/telemetry hardening follow-up must also guarantee:
  - `scripts/build_native_rowset_kernel.sh` self-heals stale/corrupt native binaries instead of trusting `buildInputsHash` alone
  - merged rejection summaries and `parallel_manifest.json` preserve deterministic `rowsetModeStats`
  - worker `rowsetModeStats.rootPositiveMode` / `rootNegativeMode` mismatches fail fast
  - native runtime-guard verify covers `sourceSha256`, `outputSha256`, missing-manifest, malformed-manifest, `platform`, and `nodeApiVersion` branches
- current cleanup follow-up after runtime/telemetry hardening:
  - remove DuckDB JSON row streaming from recommendation close-return sidecar candle fingerprint scans
  - centralize `rowsetModeStats` schema so miner merge code and server smoke share one contract
  - keep `PREJUMP_MEMO_SKYLINE_V3=true` naming drift documented but unchanged in this round
- current index-contract/provenance hardening bundle now also requires:
  - `row_meta.parquet` mining readers to fail fast on duplicate / missing / out-of-order `rowIdx`
  - `row_meta.parquet` mining readers to fail fast on blank `sourceType`, `sourceId`, `dateKey`, or `symbol`
  - `row_meta.parquet` row-level `sourceType` / `strategyMode` must exactly match the dataset-level contract
  - predictive indexed manifests and summaries must persist canonical `sourceType=perfect_prototype_prejump_pack`
  - `token_stats.parquet` seed scans to fail fast on duplicate/out-of-order tokens and streamed-count mismatch vs manifest `tokenCount`
  - `token_dictionary.parquet` selected-entry loads to fail fast on duplicate/out-of-order tokens and requested-count mismatches
  - partitioned index artifacts to persist feature-store provenance:
    - selected coverage
    - selected partition count
    - feature-store contract hash
    - selected partition-state hash
    - tokenizer-spec cache key + cache inputs
  - indexed and parallel mining to validate current feature-store provenance against the recorded index provenance before search begins
  - non-partitioned direct-built indexes to persist explicit input provenance and fail fast on stale input reuse
  - direct partitioned-index merge to emit provenance-complete `manifest.json`, `summary.json`, and `partition_manifest.json`
  - canonical server wrapper to reject raw pack/direct-index mode and stay partitioned-only
  - stale feature-store / index reuse to stop with explicit feature-store rebuild + index rebuild remediation
  - the current server reprobe index artifact predates this provenance-complete contract and must be rebuilt before any mining-only reprobe
  - direct partitioned-index merge now requires exact source-set integrity:
    - source index directories must be unique
    - source indexes must be non-partitioned shard-local builds
    - source `inputProvenance.inputPaths` union must exactly match the selected feature-store partitions for the recorded provenance range
    - every source shard index must persist `tokenizerSpecHash`
    - every source shard `tokenizer_spec.json` must match its recorded hash
    - direct merge must fail fast unless every source shard `tokenizerSpecHash` matches the canonical tokenizer spec implied by the current feature-store provenance
  - canonical partitioned predictive tokenizer options are fixed and explicit:
    - `surfaceName=v5_prejump_contextual`
    - `binCount=5`
    - `includeSymbolToken=false`
    - `includeMissingTokens=false`
    - `includeCategoricalTokens=true`
  - canonical server wrapper must pass those tokenizer options explicitly into the partitioned build tool
  - tokenizer-spec cache files under `.tokenizer-spec-cache/` must use an explicit envelope contract, not a bare tokenizer JSON payload
  - invalid, legacy, or metadata-mismatched tokenizer cache files must be rebuilt from current feature-store sidecars before canonical partitioned build/merge continues
  - low-level direct build / merge tools must fail fast on dirty output dirs and stale canonical artifact leftovers
  - predictive direct/merged index manifests now require tokenizer-spec fingerprint fields:
    - `tokenizerSpecHash`
    - `tokenizerSpecFingerprintVersion`
    - tokenizer-spec fingerprint v2 excludes volatile `generatedAt`
  - the current server reprobe partitioned index artifact predates tokenizer-spec fingerprint persistence and must be rebuilt before mining-only reprobe
- do not use JSONL sink batches on the primary partitioned index build/merge output path once this bundle lands
- do not re-materialize partial-merge buckets with `filter()` on the canonical path once this bundle lands
Forbidden unsafe prunes:
- positive-only closure prune
- equal-size dominance prune
- top-K prune on equality
- precision-only or gap-only upper-bound prune
- partial-worker top-K prune outside disjoint root partitions
The indexed one-shot wrapper intentionally stops after `feature_store -> partitioned index merge -> mining`. OOS evaluation and curated rebuild stay explicit fail-fast steps.
Validation gates for the exact-mining acceleration bundle:
- local:
  - `bash scripts/build_native_rowset_kernel.sh`
  - `bash scripts/verify_native_rowset_kernel.sh`
  - `node tools/smoke_prejump_indexed_equivalence.mjs`
  - `node tools/smoke_prejump_indexed_acceleration_adversarial.mjs`
  - `node tools/smoke_prejump_index_merge_equivalence.mjs`
  - `npm run verify`
- server, after shared feature-store bootstrap completes:
  - `bash scripts/build_native_rowset_kernel.sh`
  - `bash scripts/verify_native_rowset_kernel.sh`
  - `npm run verify`
  - `node tools/smoke_prejump_parallel_indexed_equivalence.mjs`
`npm run verify` must include the native exactness smokes above; export-only addon checks are not a sufficient gate.
The one-shot wrapper now uses a worker-aware memory preflight before starting predictive parallel mining.
Synthetic server equivalence checks are available for both indexed and parallel exact miner paths:
- `tools/smoke_prejump_indexed_equivalence.mjs`
- `tools/smoke_prejump_parallel_indexed_equivalence.mjs`

Current hardening bundle completed:
- binary artifact readers now fail fast on short reads / bad offsets
- exact quantile sidecar now uses cursor-based v3 merge with bounded file handles
- `feature_stats.parquet` no longer duplicates exact value arrays; `feature_values.bin + feature_values_index.parquet` is canonical
- partitioned index merge now streams shard dictionaries instead of full-loading them
- predictive feature-store split no longer uses DuckDB `ORDER BY dateKey,rowOrdinal`; pack/feature-store parquet writers now preserve insertion order and split fail-fast verifies physical monotonicity instead
- recommendation close-return sidecar now uses a partition-aware v4 freshness contract before safe incremental rebuilds are allowed
- exact-mining merge hardening now also:
  - materializes sparse dense/dense intersections directly without an intermediate dense result
  - tracks parent partial-merge live rule peaks and exact-safe hit-floor evictions during parallel merge
  - splits indexed/parallel rule-count diagnostics into observed/live/final counts
  - adds bounded head rerank metrics for ordering-only refinement
- current index merge acceleration bundle now also:
  - fixes `merge_postings` progress/ETA to use actual distinct merged token counts
  - replaces per-shard DuckDB FIFO cursor fanout with one canonical global dictionary stream
  - moves primary-path shifted-delta postings merge into the required native kernel
  - stores first/last posting row metadata in shard token dictionaries for future exact-safe splice work
  - fails fast unless merged token and dictionary-ref counts match precomputed expectations
  - preflights shard token-dictionary schema before merge
  - preserves deterministic merge order as `token, shardIndex`
  - emits merged-dictionary stats in the same materialization stage instead of rescanning shard-union inputs
  - emits the canonical merged-dictionary temp artifact as ordered JSONL and consumes it directly instead of a second DuckDB/parquet order pass
  - fails fast on duplicate `(token, shardIndex)` refs
  - uses native file-backed postings merge on the primary path and reserves bounded-concurrency JS reads for debug-only `emitTokenPostingsParquet=true`
  - one-shot wrapper now also pins:
    - `PREJUMP_INDEX_SCHEMA_PREFLIGHT_REQUIRED=true`
    - `PREJUMP_INDEX_MERGE_READ_CONCURRENCY=<n>`
- remaining exact-acceleration bundle must now close:
  - required native file-backed shifted-delta postings merge on the primary `token_postings.bin` path
  - incremental tie-band accounting instead of rescanning all live merge buckets per insert
  - ordered memo frontier / skyline-style early stop before native subset checks
  - incremental memo frontier insertion/update instead of full frontier sort/reindex on every insert
  - incremental hit-floor pruning instead of full-scanning all signature buckets whenever the partial-merge floor rises

Recommended end-to-end order:

1. build/update predictive feature store explicitly
2. run native preflight:
   - `bash scripts/build_native_rowset_kernel.sh`
   - `bash scripts/verify_native_rowset_kernel.sh`
3. run `node tools/smoke_prejump_index_merge_equivalence.mjs`
4. run `tools/run_prejump_predictive_indexed_mining.sh --start=... --end=... --run-prefix=<name>`
5. build a predictive OOS pack for the OOS window
6. freeze the chosen predictive source catalog to an immutable curated path
7. run `tools/report_perfect_prototypes_oos.mjs` against that frozen predictive catalog with expected hash verification
8. edit `artifacts/curated/perfect_proto_prejump_live_rule_ids.txt` only if a new frozen curated catalog is intentionally being created
9. run `tools/rebuild_prejump_curated_perfect_prototype_catalog.sh --source-catalog=...` so it writes a new frozen catalog path

## Live files

- Predictive rule ID list: [artifacts/curated/perfect_proto_prejump_live_rule_ids.txt](/home/saida/code/stockdesk-lab-lite/artifacts/curated/perfect_proto_prejump_live_rule_ids.txt)
- Predictive live catalog legacy shared target path: `artifacts/curated/perfect_proto_prejump_live_catalog_v2.json`
- Preferred predictive frozen catalog root: `artifacts/curated/prejump_frozen/<train_run_id>/<selection_id>/`
- Legacy parent rule ID list: [artifacts/curated/perfect_proto_live_rule_ids.txt](/home/saida/code/stockdesk-lab-lite/artifacts/curated/perfect_proto_live_rule_ids.txt)
- Legacy parent live catalog: [artifacts/curated/perfect_proto_live_catalog_rule2_v1.json](/home/saida/code/stockdesk-lab-lite/artifacts/curated/perfect_proto_live_catalog_rule2_v1.json)
- Step-B shortlist rule IDs: [artifacts/curated/perfect_proto_stepb_oos_close28_dedup_zero152_plus_top19_rule_ids.txt](/home/saida/code/stockdesk-lab-lite/artifacts/curated/perfect_proto_stepb_oos_close28_dedup_zero152_plus_top19_rule_ids.txt)
- Step-B shortlist catalog: [artifacts/curated/perfect_proto_stepb_oos_close28_dedup_zero152_plus_top19_catalog.json](/home/saida/code/stockdesk-lab-lite/artifacts/curated/perfect_proto_stepb_oos_close28_dedup_zero152_plus_top19_catalog.json)
- Generic frozen catalog root for legacy parent / Step-B curated sets: `artifacts/curated/frozen/<train_run_id>/<selection_id>/`

## Rebuild the predictive curated catalog

After re-mining a predictive `v5_prejump_contextual` source catalog, edit the predictive rule ID list and build the live catalog:

```bash
tools/rebuild_prejump_curated_perfect_prototype_catalog.sh \
  --source-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/<predictive_run>/step-perfect-prototype/catalog.json
```

The rebuild wrapper copies the server-built predictive catalog back to local `artifacts/curated/` so later server sync keeps the same live catalog.
The predictive rebuild wrapper should now be treated as a frozen-catalog builder:
- source train catalog is immutable input
- selected `ruleId` set is explicit input
- output should be a new run-specific frozen catalog directory with:
  - `catalog.json`
  - `manifest.json`
- downstream OOS/apply/live should reference the frozen absolute path plus expected hashes
- source catalogs that are missing frozen-contract metadata must be rebuilt/frozen first; curated rebuild no longer accepts unfrozen source catalogs

If feature-store partitions were created before the exact quantile sidecar v3 patch, rebuild them once so every partition contains:
- `feature_stats.parquet`
- `feature_values.bin`
- `feature_values_index.parquet`
- canonical structured parquet readers now require one explicit query contract:
  - normalize structured columns to canonical JSON text inside the DuckDB `SELECT` before delimited streaming
  - older typed struct/list/map partitions are supported only through that canonical normalization expression
  - hidden alternate parsing paths are forbidden
- overwrite-range feature-store repair may now reuse the previous manifest exactly when the rewritten contract still matches:
  - `strategyModes`
  - `contextSurfaces`
  - `numericFeatureKeys`
  - otherwise the canonical path must still rebuild exact metadata instead of carrying stale manifest state

Index-build progress payloads now also expose:
- `quantileMergeMs`
- `fdPoolPeak`
- `dictionaryCursorRows`

Filtered predictive apply summaries now also expose:
- `sidecarPartitionLoads`

## Rebuild the legacy parent curated catalog

After editing the rule ID list, rebuild the live catalog on server from an already frozen source catalog:

```bash
tools/rebuild_curated_perfect_prototype_catalog.sh \
  --source-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json
```

Optional custom source catalog:

```bash
tools/rebuild_curated_perfect_prototype_catalog.sh \
  --source-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --rule-ids-file=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/perfect_proto_live_rule_ids.txt \
  --out-path=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<new_selection_id>/catalog.json
```

Legacy parent and Step-B after-close wrappers now also require explicit frozen catalog paths plus sibling `manifest.json` hashes. Old mutable defaults are no longer accepted.

## Run predictive after close

```bash
tools/run_prejump_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/prejump_frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=YYYY-MM-DD
```

Example:

```bash
tools/run_prejump_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/prejump_frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=2026-03-13
```

This path uses:

1. one-day `prejump_pack.parquet` build for the target date
2. `apply_perfect_prototypes` on `prejump_pack.parquet`
3. close `>= +28%` removal before dedupe

## Run legacy parent after close

```bash
tools/run_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=YYYY-MM-DD
```

Example:

```bash
tools/run_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=2026-03-13
```

## Run legacy Step-B shortlist after close

```bash
tools/run_stepb_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=YYYY-MM-DD
```

Example:

```bash
tools/run_stepb_curated_perfect_prototypes_after_close.sh \
  --catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --expected-catalog-sha256=<catalog_sha256> \
  --expected-rule-ids-sha256=<rule_ids_sha256> \
  --date=2026-03-13
```

Pinned A-free operating subset:

```bash
tools/run_stepb_afree_operating_5rule_after_close.sh \
  --date=2026-03-13
```

This wrapper is pinned to the frozen 7-rule A-free operating catalog:

- `/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/perfect_proto_stepb_afree_daycap2_train_precision90_maxhit15_20m_v1_20260322/operating_7rule_plus_pp935d6457f10a_v1/catalog.json`
- `catalogContentSha256=d94a55a33f4ad1fe3a0185d26154408c57a967ebfcc69bdb9a591f40584bea39`
- `ruleIdsSha256=65619b5bcdc57dbd894709a3dd17a5d03edb734e5734941c7d06e639898a40c1`

Pinned rule ids:

- `PP_0c87a6a77f60`
- `PP_25820a1eaeaf`
- `PP_332c954c7516`
- `PP_471c80cbdd29`
- `PP_4e55c09a1d6a`
- `PP_935d6457f10a`
- `PP_cefa17c34587`

Manual promotion note:

- `PP_935d6457f10a` came from the relaxed `trainPrecision>=0.90` A-free 20M line.
- Its raw open OOS result was `9/10`, and its future replay through `2026-03-18` was `1/2`.

This path uses the canonical A-free live path only:

1. one-day A-free open live pack build for the target date
2. `sourceType=perfect_prototype_stepb_open_eval_pack`
3. `lineId=stepb_dplus1_plus_lite`, `surface=v3_contextual_plus_lite`
4. `apply_perfect_prototypes` with `selectionMode=union_all`

Do not route this pinned 7-rule operating catalog through `Step-A -> Step-B -> templates_lite.jsonl`.
That gated path is not the operating contract for this subset and can drop valid A-free matches.

Multiline recent-impulse expansion contract:

- keep `afree_open` as the primary discovery universe while reusing the existing `stepb_dplus1_plus_lite` runtime contract
- keep the recent-only discovery family:
  - `recent_impulse_upto_1d`
  - `recent_impulse_upto_2d`
  - `recent_impulse_upto_3d`
  - `recent_impulse_upto_4d`
  - `recent_impulse_upto_5d`
  - `recent_impulse_upto_6d`
  - `recent_impulse_upto_7d`
  - `recent_impulse_upto_8d`
- add the widened plus-lite discovery family:
  - `same_day_plus_recent_upto_1d`
  - `same_day_plus_recent_upto_2d`
  - `same_day_plus_recent_upto_3d`
  - `same_day_plus_recent_upto_4d`
  - `same_day_plus_recent_upto_5d`
  - `same_day_plus_recent_upto_6d`
  - `same_day_plus_recent_upto_7d`
  - `same_day_plus_recent_upto_8d`
- `recent_impulse_1d ~ recent_impulse_8d` remain Step-A event-lane ids only; do not reuse them as the cumulative discovery-universe id
- widened `same_day_plus_recent_upto_Nd` always includes `same_day_high8` plus `recent_impulse_1d ~ recent_impulse_Nd`
- each discovery universe must build its own pack, exact index, mined catalog, and OOS/live replay inputs
- each frozen catalog must be applied only to the matching universe pack; pack/catalog universe mismatch must fail fast
- final union happens after per-universe apply results are produced
- operating output for the A-free after-close path is now the full symbol-day deduped set under `union_all`, not a day-level top-2 cap
- widened plus-lite research lines are not part of the pinned A-free 7-rule operating subset unless they are explicitly frozen and promoted later
- widened plus-lite date-breadth controls split into three layers:
  - `minTrainMatchedDates` is an explicit search-time pruning control
  - `top1DateHitShare` / `top3DateHitShare` are final rule gates only
  - `maxRulesPerMatchedDateSignature` is a post-collection cap only
- do not silently enable date-breadth pruning on A-free or generic plus-lite runs; use explicit opt-in only

## Run Step-B D+1 baseline train/OOS

This is a separate legacy baseline line for fast exact Step-B rule mining. It does not replace or modify the predictive primary path.

```bash
tools/run_server_stepb_dplus1_baseline.sh \
  --split-policy=decision_date_only \
  --run-id=<run_id>
```

Required split policies:

- `decision_date_only`
  - train/OOS windows are interpreted by `decisionDate`
  - use this for historical comparison against the old Step-B no-gap high-rule-count line
- `strict_label_boundary`
  - train/OOS windows require `eventOutcome.entryDateKey` and `eventOutcome.exitDateKey` to stay inside the same window
  - use this when leakage across the train/OOS boundary must be excluded

Baseline wrapper outputs must be read together:

- `baseline_manifest.json`
- `train_reapply_summary.json`
- `leaderboard.csv`
- `leaderboard.json`
- `precision_bucket_summary.json`
- `oos_guardrail_summary.json`
- `date_concentration_leaderboard.json`
- `symbol_concentration_leaderboard.json`
- `oos_collapse_leaderboard.json`
- `oos_overlap_rows.jsonl`
- `raw_vs_close28_delta.json`

Guardrail reading is mandatory. Rule count alone is not enough because legacy Step-B lines can inflate by concentrating on a few dates or symbols.

Exactness reading rules:

- `catalog.json` is the mined exact-only train catalog
- `train_reapply_summary.json` is the honesty check for that exactness claim
- `baseline_manifest.json` now carries:
  - `baselineExactnessClaimable`
  - `trainExactnessDriftSummary`
  - explicit `selectionMode`
  - explicit `close28FilterPct`
  - explicit train/OOS windows
- `leaderboard.json` / `leaderboard.csv` now carry both:
  - catalog train metrics
  - train reapply metrics
- if `trainExactnessDriftRuleCount > 0`, do not describe the baseline output as a pure exact train catalog without also naming the drift count
- `baselineExactnessClaimable=true` now means:
  - train reapply drift is zero across match/hit/negative counts
  - `maxGapTradingDays`, `firstHitDate`, `lastHitDate`, and `matchedDateCount` also match
  - no train catalog fallback rows were needed during leaderboard assembly
- the historical high-rule-count Step-B comparison line is explicitly `no-gap`, so the D+1 baseline wrapper must pass `maxGapTradingDays=100000`
- server speed sanity `perfect_proto_stepb_dplus1_speed_sanity_20260319_013000` already cleared the historical ~3k-rule cadence gate under aligned `no-gap` conditions:
  - train Step-B rows: `89781`
  - exact catalog rules: `4000` (`maxRules` cap hit)
  - explored states: `20000140`
  - wrapper wall time: `1266.8s`
  - `baselineExactnessClaimable=true`
  - OOS guardrail: `oosZeroNegativeRules=741`, `oosHit2ZeroNegativeRules=334`
- immediate legacy speed patches are not required just to recover the old no-gap cadence
- Step-B baseline interpretation hardening is now closed for long-running train/OOS reference runs:
  - baseline config is self-contained for `featureAsOf=t-1` and `exactCollectionMode=train_precision_1_only`
  - `stepb_dplus1_baseline` is locked to historical `no-gap` semantics with `maxGapTradingDays=100000`
  - `selectionMode` must agree across train report, OOS report, raw apply, `close28` apply, and leaderboard manifest
  - `decision_date_only` now emits explicit provenance that boundary filtering was intentionally skipped
  - leaderboard fields no longer mix train/OOS aliases or raw/dedup coverage names ambiguously
  - a tiny wrapper end-to-end smoke now guards the Step-B baseline orchestration helper path
- the remaining baseline contract gap is now closed:
  - the real server wrapper now sources the shared helper library, so wrapper/helper logic cannot drift
  - direct Step-B baseline execution now fails fast on invalid `contractVersion`, invalid `strategyMode`, and any top-level `template/backtest` values that disagree with the explicit baseline contract
  - the recovered `perfect_proto_stepb_dplus1_speed_sanity_20260319_013000` cadence remains intact after the closure bundle and server `npm run verify`
- long reference run `perfect_proto_stepb_dplus1_long_reference_20260319_142559` completed under the hardened baseline contract:
  - train mining stayed on the recovered no-gap cadence: `89781` Step-B rows, `4000` exact rules, `20000140` explored states
  - train reapply remained exact: `baselineExactnessClaimable=true`, `trainExactnessDriftRuleCount=0`
  - OOS guardrail headline: `3412` matched rules, `741` zero-negative rules, `334` hit>=2 zero-negative rules, `116` hit>=3 zero-negative rules
  - concentration stayed broad enough to avoid the old “few dates only” failure mode: `245` unique matched dates, `417` unique matched symbols, `top1DateShare=0.00881`, `top5DateShare=0.04405`, `top10SymbolShare=0.08664`
  - `close28` filter delta remained material and should stay part of operational reading: `rawMatchDelta=198`, `zeroNegativeRuleDelta=40`, `uniqueMatchedSymbolsDelta=81`
- public daily fill integrity hardening is now required for candle source refresh:
  - recurring upstream placeholder rows with `open=high=low=0`, `close>0`, `volume=0` are treated as invalid candle data, not “partial fill”
  - `tools/fill_public_kr_daily.py` now aborts before rewriting `data/candle_daily.jsonl` / `data/universe_daily.jsonl` when such rows appear
  - the abort writes an explicit audit JSON under `artifacts/data_quality/` so the offending symbols/dates/sources are visible without rerunning ad hoc probes
  - existing historical bad rows are handled separately:
    - audit: `python3 tools/audit_public_kr_invalid_candles.py --data-dir=data --audit-dir=artifacts/data_quality`
    - dry-run scrub: `python3 tools/scrub_public_kr_invalid_candles.py --data-dir=data --audit-dir=artifacts/data_quality`
    - apply scrub: `python3 tools/scrub_public_kr_invalid_candles.py --data-dir=data --audit-dir=artifacts/data_quality --apply`
  - scrub removes invalid rows from both `candle_daily.jsonl` and matching `universe_daily.jsonl` pairs, and creates backups under `artifacts/backups/`
  - after any real scrub, rebuild candle-derived sidecars before filtered apply paths
  - current server scrub state:
    - historical dry-run audit found `2588` invalid candle rows across `579` symbols, with `2131` matching universe pairs
    - server scrub apply removed all `2588` invalid candle rows and `2131` matching universe rows
    - post-scrub historical audit is clean: `invalid_rows=0`, `invalid_symbols=0`, `invalid_universe_pairs=0`
    - backup root: `/home/moltook/apps/stockdesk-lab-lite/artifacts/backups/invalid_candle_scrub_20260319_072007`
  - after scrub and recommendation close-return sidecar rebuild, long reference run `perfect_proto_stepb_dplus1_long_reference_post_scrub_20260319_ko` completed:
    - train cadence stayed intact: `89768` Step-B rows, `4000` exact rules, `trainExactnessDriftRuleCount=0`
    - OOS headline improved on exact survivorship: `3402` matched rules, `768` zero-negative rules, `351` hit>=2 zero-negative rules, `127` hit>=3 zero-negative rules
    - delta vs pre-scrub long reference: `trainStepBRows=-13`, `oosMatchedRules=-10`, `oosZeroNegativeRules=+27`, `oosHit2ZeroNegativeRules=+17`, `oosHit3ZeroNegativeRules=+11`
- next Step-B expression experiment should stay on a fixed-budget legacy comparison before any higher-budget sweep:
  - baseline compare run: `v3_contextual`, `maxRules=10000`, `maxSearchStates=20000000`
  - expression compare run: `v3_contextual_plus_lite`, `maxRules=10000`, `maxSearchStates=20000000`
  - keep the later `30000 / 120000000` budget sweep closed until this fixed-budget expression comparison is implemented and read on the clean post-scrub baseline
  - the first `plus_lite` legacy surface should add only these 15 snapshot expressions:
    - `pattern.insideBarCount3`
    - `pattern.nr4`
    - `pattern.nr7`
    - `pattern.closeClusterTightness3`
    - `pattern.closeClusterTightness5`
    - `shape.sidewaysScore3`
    - `shape.sidewaysScore5`
    - `shape.sidewaysScore10`
    - `volume.lowVolumeCount3`
    - `volume.lowVolumeCount5`
    - `volume.volumeVsRecentPeak`
    - `level.closeNearHigh20`
    - `level.closeNearHigh60`
    - `level.touchRecentHighCount10`
    - `level.rejectionFromRecentHighCount10`
  - do not backport `anchor.*`, `chain.*`, or `score.*` in the first legacy expression run
  - if the surface changes, rerun Step-B from the existing Step-A events before mining; Step-A does not need to be rebuilt when the event definition is unchanged
  - fixed-budget comparison is now completed:
    - baseline `perfect_proto_stepb_dplus1_budget10k_20m_20260319`
      - `5000` exact rules, `20000065` explored states
      - OOS: `4192` matched rules, `996` zero-negative rules, `429` hit>=2 zero-negative rules, `150` hit>=3 zero-negative rules
      - coverage: `246` unique matched dates, `430` unique matched symbols, `top1DateShare=0.00849`, `top5DateShare=0.04243`, `top10SymbolShare=0.08487`
      - `close28`: `499` matched rows, `3591` matched rules, `921` zero-negative rules
    - plus-lite `perfect_proto_stepb_dplus1_plus_lite_budget10k_20m_heap8g_rerun_20260319`
      - `5000` exact rules, `20000221` explored states
      - OOS: `4274` matched rules, `999` zero-negative rules, `435` hit>=2 zero-negative rules, `175` hit>=3 zero-negative rules
      - coverage: `241` unique matched dates, `367` unique matched symbols, `top1DateShare=0.01176`, `top5DateShare=0.05378`, `top10SymbolShare=0.09244`
      - `close28`: `395` matched rows, `3580` matched rules, `1017` zero-negative rules
  - current read:
    - plus-lite improves stronger exact survivorship, especially `hit>=3` and `close28` zero-negative rules
    - plus-lite narrows surfaced breadth and worsens date/symbol concentration
    - plus-lite mining requires explicit `NODE_OPTIONS=--max-old-space-size=8192` at this budget
    - keep `v3_contextual` as the default Step-B baseline for now; only use plus-lite when stricter exact-rule harvesting is more important than breadth
  - Step-B after-close live apply must use a runtime config whose Step-B surface matches the frozen catalog surface:
    - baseline catalogs require `v3_contextual`
    - plus-lite catalogs require `v3_contextual_plus_lite`
    - `tools/server_stepb_curated_perfect_prototypes_after_close.sh` now fail-fast checks `manifest.surface` against `step-b/summary.json`
- plus-lite is now split into four contracts and they must not be read as one number:
  - discovery:
    - `Step-A + Step-B + v3_contextual_plus_lite`
    - purpose: fast exact-rule harvesting only
    - the widened research family generalizes the original `1~3일` line into `same_day_plus_recent_upto_1d ~ same_day_plus_recent_upto_8d`
    - for each widened line:
      - keep `same_day_high8`
      - additionally allow `recent_impulse_1d` through `recent_impulse_Nd`
      - meaning: the current decision day `D` is discovery-eligible when `D` itself is `HIGH8` or when `D-1 .. D-N` had a `HIGH8` impulse
    - the historical anchor for `same_day_plus_recent_upto_3d` is the widened `1~3일` line:
      - same-day-only Step-B train rows: `89,768`
      - widened `1~3일` Step-B train rows: `171,756`
      - widened `171,756` is not a pure event-row count; it decomposes into `92,555` accepted event-side rows plus `79,201` legacy synthetic negative templates
    - baseline `stepb_dplus1_baseline` must stay same-day `HIGH8` only
  - open-market evaluation:
    - reuse the frozen plus-lite discovery catalog
    - replay it on `Step-A`-free train/OOS packs with the same `D+1 open / 3-day / +8% / -4%` semantics
    - purpose: measure rule quality without the Step-A entrance gate
  - selection:
    - choose rules from the open-eval leaderboard
    - final truth is `open-OOS`, with `open-train` treated as sanity/supporting context
  - deploy:
    - dedupe surfaced output by `symbol + decision date`
    - keep all matching rules as support metadata instead of deleting near-duplicate rules from research artifacts
  - do not compare these counts directly without labels:
    - discovery rule count
    - open-eval matched-rule count
    - selection leaderboard rule count
    - deploy deduped symbol count
  - open-market eval must fail fast on any frozen-catalog / pack surface mismatch
  - keep this line exact-only for now; relaxed precision is intentionally excluded
  - Step-A / Step-B artifacts on the widened plus-lite line must preserve recent-impulse provenance:
    - `stepALaneId`
    - `impulseSourceDateKey`
    - `impulseLookbackDays`
    - `impulseJumpPct`
    - `impulseJumpPctFromPrevClose`
    - `impulseJumpPctFromOpen`
  - plus-lite server discovery wrappers must fail fast unless:
    - `event.recentImpulseDiscovery.enabled=true`
    - `event.recentImpulseDiscovery.lookbackTradingDays=3`
  - current widened-discovery rescue target is legacy miner memory/throughput, not a semantics rollback:
    - same-day-only train Step-B templates: `89768`
    - widened `1~3일` train Step-B templates: `171756`
    - widened `200k / 4GB` probe baseline: `700` exact rules, `200180` explored states, `533.92s`, `4294704 KB`
    - widened `20M / 4GB` currently OOMs
  - rescue scope for this bundle is exact-safe legacy miner optimization only:
    - reduce prepare-pipeline copies before search starts
    - compact tokenized mining rows down to `sourceType/sourceId/dateKey/symbol/outcomeHitTarget/tokens`
    - compact token postings into typed numeric containers
    - replace same-signature string keys with hash buckets plus exact equality checks
    - add an exact-safe intersection fastpath
  - the bounded-heap seed-selector pattern is intentionally not part of the retained rescue bundle because legacy diversified ranked-list merge needs full ranking depth to stay exact-equivalent under state caps
  - do not shrink widened discovery back to `1~2일` or same-day-only during the rescue bundle
  - keep child-ordering search reordering deferred until the exact-safe memory rescue bundle is validated
  - the final exact-safe rescue result is:
    - widened `200k / 4GB` post-fix probe: `700` exact rules, `200180` explored states, `504.69s`, `3992324 KB`
    - improvement vs canonical baseline: `-29.23s`, `-302380 KB`
  - root cause of the temporary `701 / 200083` drift seen during intermediate rescue probes:
    - the first galloping intersection fastpath skipped a valid match when the larger-array start cursor already satisfied the target
    - fixing that start-index bug restored canonical exactness while keeping the retained compaction changes
  - next exact-safe search-cost bundle now targets the remaining inner-loop overhead on the widened `1~3일` line:
    - canonical before/after benchmark remains the widened `200k / 4GB` probe at `700` exact rules, `200180` explored states, `504.69s`, `3992324 KB`
    - split search-time rule creation into `ruleCore` vs final rule materialization so `ruleId/matchedSymbols/sampleMatchIds` no longer require full rule objects during the recursive search
    - build and reuse a single `calendarDateKey -> index` cache for gap calculations instead of rebuilding it per collected rule
    - replace repeated seed ranking object copies with exact-equivalent index-array rankings
    - add a positive-count fastpath so branches that fail `minHitCount` do not allocate full positive intersections
  - this second widened-line bundle is now completed with another exact-safe canonical remeasure:
    - post-bundle widened `200k / 4GB` probe: `700` exact rules, `200180` explored states, `495.70s`, `3986780 KB`
    - delta vs the previous canonical probe: `-8.99s`, `-5544 KB`
  - a widened `1M / 4GB` follow-up probe was explicitly cancelled by the user after launch; the local wrapper and server-side run were terminated and should not be treated as a completed benchmark
  - still keep these out of scope for the current widened-line rescue:
    - bounded-heap seed selection
    - child-ordering search reordering
    - token-id internalization
    - DuckDB/bitset miner rewrites
  - the first full `speed50` candidate bundle was implemented and benchmarked on widened `200k / 4GB`:
    - exactness held:
      - `700` exact rules
      - `200180` explored states
      - identical `ruleIdsSha256`
      - identical rule payload hash: `f6fb38dbdc58355f30caacd05928bfad487e3f337caed9c1c9eda5de676cb512`
    - performance regressed instead of improving:
      - wall time: `500.35s` vs canonical `495.70s`
      - max RSS: `4323096 KB` vs canonical `3986780 KB`
    - verdict:
      - do **not** promote the candidate bundle as the new canonical widened performance line
      - keep `v6` as the active widened `200k / 4GB` baseline until a later speed bundle proves strictly better
  - the `speed50` runtime hot path is now rolled back from the active legacy miner line:
    - keep the failed token-id / hybrid-rowset bundle in experiment history only
    - active widened runtime path is back on the `v6` array-based miner with retained exact-safe compaction wins
    - rollback closure is now confirmed on server:
      - server `npm run verify` passed after the targeted rollback sync
      - widened `200k / 4GB` rollback-confirm probe preserved `700` exact rules and `200180` explored states
      - rollback-confirm rule-id hash and full rule payload hash matched the prior `v6` canonical run exactly
  - the explicit `selection_first_exact_v1` search-mode split was implemented, benchmarked, and then rolled back:
    - goal: find stronger exact rules earlier under the same widened `1~3일 / 200k / 4GB` state budget
    - benchmark method: one server mining-only canonical run against an apples-to-apples legacy mining-only rerun
  - outcome:
    - exact output was unchanged:
      - `700` exact rules
      - `200180` explored states
      - identical full rule-id hash
      - identical full rule payload hash
      - identical top100 hit-quality summary
    - performance was not better:
      - legacy mining-only rerun: `88.67s`, `3991956 KB`
      - `selection_first_exact_v1`: `93.22s`, `3931124 KB`
    - because top-rule quality did not improve and elapsed regressed, the mode is **not** promoted
  - active widened search path now defaults to:
    - `exact_indexed_kernel_v1`
    - `legacy_exact_catalog_v6` remains available only as an explicit compatibility override
    - failed selection-first experiment stays in registry/history only
  - next large performance experiment is now narrowed to an explicit exact-indexed kernel promotion only:
    - new candidate mode: `exact_indexed_kernel_v1`
    - goal: move Step-B exact mining onto the existing indexed/native exact rowset kernel instead of further tuning the legacy JS array miner
    - widened `1~3일` discovery semantics stay fixed
    - heavy validation is limited to one server-only canonical benchmark:
      - widened `1~3일`
      - `200k / 4GB`
    - this bundle must preserve the current canonical exact output exactly:
      - `700` exact rules
      - `200180` explored states
      - identical rule-id hash
      - identical full rule payload hash
    - this bundle must also beat the active widened baseline:
      - elapsed `< 495.70s`
      - max RSS `< 3986780 KB`
    - `1M`, `5M`, and `20M` probes remain out of scope until the single canonical `200k / 4GB` gate passes
    - server mining-only apples-to-apples benchmark result on widened `1~3일 / 200k / 4GB`:
      - exactness held at `700` exact rules and `200180` explored states with identical rule-id/payload hashes
      - legacy apples baseline: `88.67s`, `3991956 KB`
      - exact indexed kernel candidate: `75.19s`, `3994760 KB`
      - elapsed improved by `13.48s` (`15.2%`) while RSS regressed by `2804 KB`
    - operational decision:
      - promote `exact_indexed_kernel_v1` to the active widened Step-B exact mining default
      - keep `legacy_exact_catalog_v6` only as an explicit compatibility override
      - rationale: exactness is byte-for-byte identical and mining-only elapsed improved by `15.2%`; the small `+2804 KB` RSS delta is acceptable for active promotion
  - next indexed-throughput reduction chain is fixed and must stay on the active exact indexed path:
    - `perfect_proto_stepb_exact_phase_timing_v1`
    - `perfect_proto_stepb_exact_postings_cache_v1`
    - `perfect_proto_stepb_exact_compiled_input_v1`
    - `perfect_proto_stepb_exact_parallel_frontier_v1`
  - widened discovery semantics remain fixed:
    - recent-impulse `1~3일`
  - heavy validation contract for this chain:
    - server-only
    - `200k / 4GB` only
    - no `1M`, `5M`, or `20M` until all four bundles finish
  - common exactness gate for every bundle:
    - `700` exact rules
    - `200180` explored states
    - identical rule-id hash
    - identical full payload hash
  - active indexed mining-only apples baseline for the chain:
    - `75.19s`, `3994760 KB`
  - numeric success gates:
    - phase timing bundle:
      - `elapsed <= 75.19s`
      - `summary.json.phaseTimings` populated
    - prep-cache bundle:
      - warm `200k / 4GB` run `<= 60s`
    - compiled-input bundle:
      - cold `200k / 4GB` run `<= 56s`
    - parallel-frontier bundle:
      - `200k / 4GB` run `<= 45s`
  - implementation contract:
    - do not reintroduce legacy JS-array tuning
    - do not retry token-id wrapper shims
    - compiled input must be explicit via `--index-dir`
    - parallel frontier must stay deterministic and fail fast on any exactness drift
  - Bundle 2 result on the active exact indexed path:
    - `perfect_proto_stepb_exact_postings_cache_v1`
    - exactness remained byte-for-byte identical on both cold and warm `200k / 4GB` runs:
      - `700` exact rules
      - `200180` explored states
      - identical rule-id hash: `b8721e05bbd68e6c1371d88c95b500d4fdad2cf4f5bbb2b521fef7440088f3a7`
      - identical payload hash: `dd2e55171f6b085a78274d4bfb82514d5aae0c94032f9d21e52b38599e723037`
    - cold run was not promotable:
      - `133.52s`, `5327852 KB`
      - input hashing and snapshot write dominated the overhead:
        - `hashInputSec=14.12s`
        - `cacheWriteSec=39.87s`
    - warm run was strongly positive:
      - `29.98s`, `3667572 KB`
      - `cacheHit=true`
    - operational decision:
      - keep prep cache as an exact experimental accelerator for reruns
      - do not use it as the primary cold-path optimization
      - continue to compiled indexed input so the primary path no longer pays JSONL read/hash/snapshot serialization
  - Bundle 3 result on the active exact indexed path:
    - `perfect_proto_stepb_exact_compiled_input_v1`
    - exactness remained byte-for-byte identical on the server `200k / 4GB` cold benchmark:
      - `700` exact rules
      - `200180` explored states
      - identical rule-id hash: `b8721e05bbd68e6c1371d88c95b500d4fdad2cf4f5bbb2b521fef7440088f3a7`
      - identical payload hash: `dd2e55171f6b085a78274d4bfb82514d5aae0c94032f9d21e52b38599e723037`
    - explicit compiled-index build step:
      - `97.01s`, `5298772 KB`
      - one-time artifact creation only; not part of the mining-only apples gate
    - compiled-input cold mining-only run:
      - `10.80s` wall, `10.336s` summary elapsed
      - `3666824 KB`
    - comparison vs active direct indexed baseline:
      - direct indexed baseline: `61.73s`, `3994760 KB`
      - compiled input cold mining: `10.336s`, `3666824 KB`
      - elapsed improved by `51.39s` (`83.3%`) and RSS improved by `327936 KB`
    - operational decision:
      - compiled indexed input is now the primary throughput path for heavy Step-B exact experiments
      - promote the Step-B plus-lite heavy wrapper so train mining builds a compiled exact index first and then runs `mine_perfect_prototypes.mjs --index-dir=...`
      - keep `--index-dir` explicit and fail fast on contract mismatch
      - continue directly to deterministic parallel frontier on the compiled artifact
  - Bundle 4 result on the compiled exact path:
    - `perfect_proto_stepb_exact_parallel_frontier_v1`
    - local+server verify and exact equivalence smokes passed
    - server `200k / 4GB` heavy benchmark was not promotable:
      - run stopped with `global_budget_exhausted`
      - no final exact catalog was emitted for apples comparison
      - wall `37.37s`, `1349088 KB`
    - observed failure progress:
      - reclaimed completed chunk search states: `101262`
      - active in-flight explored states: `98304`
      - total observed parallel search states at failure: `199566`
      - remaining nominal search budget: `434`
      - remaining grantable search budget: `0`
    - follow-up fix attempt:
      - `perfect_proto_stepb_exact_parallel_frontier_initial_lease_fix_v1`
      - initial launch leases were capped to request-headroom/tranche windows
      - verify remained green, but the heavy benchmark still failed because the live control plane cannot reclaim active sibling leases
    - operational decision:
      - do not promote `exact_parallel_frontier_v1`
      - keep compiled-input direct mining as the primary heavy Step-B exact throughput path
  - A-free open-train discovery follow-up:
    - existing open-train `daily_pack.jsonl` can be reused as the market-wide input pack
    - direct Step-B compiled builder is not viable on the A-free `1081567`-row pack:
      - default heap OOM
      - `4GB` OOM
      - `6GB` OOM
    - root cause:
      - `build_stepb_exact_index.mjs` still builds a full in-memory snapshot and writes `snapshot.bin`
      - the A-free open pack now exceeds the direct builder's memory envelope before search even starts
    - required operating contract:
      - introduce a streamed Step-B exact indexed builder for large JSONL/open-pack inputs
      - streamed builder must require an explicit tokenizer spec path and must not silently fall back to the direct snapshot path
      - A-free exact discovery must mine the resulting artifact through `mine_perfect_prototypes_indexed.mjs`
- apply-side recommendation close-return lookup is now hardened against post-scrub candle row reordering:
  - root cause: `tools/apply_perfect_prototypes.mjs` assumed chronological candle rows per symbol when building the `close28` lookup
  - symptom: plus-lite close28 apply failed on `Missing recommendation-date close return lookup ...`
  - fix: targeted close-return lookup is now order-independent and verify includes an unsorted-candle smoke
- keep relaxed precision as an explicit later mode, not part of baseline v1

Legacy Step-B reapply/apply must recompute contextual features from the input rows instead of trusting rounded `templates_lite.jsonl` context vectors. This keeps train reapply and OOS apply aligned with the legacy miner semantics.

## Run legacy combined after close

```bash
tools/run_combined_curated_perfect_prototypes_after_close.sh \
  --parent-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --parent-expected-catalog-sha256=<parent_catalog_sha256> \
  --parent-expected-rule-ids-sha256=<parent_rule_ids_sha256> \
  --stepb-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --stepb-expected-catalog-sha256=<stepb_catalog_sha256> \
  --stepb-expected-rule-ids-sha256=<stepb_rule_ids_sha256> \
  --date=YYYY-MM-DD
```

Example:

```bash
tools/run_combined_curated_perfect_prototypes_after_close.sh \
  --parent-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --parent-expected-catalog-sha256=<parent_catalog_sha256> \
  --parent-expected-rule-ids-sha256=<parent_rule_ids_sha256> \
  --stepb-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json \
  --stepb-expected-catalog-sha256=<stepb_catalog_sha256> \
  --stepb-expected-rule-ids-sha256=<stepb_rule_ids_sha256> \
  --date=2026-03-13
```

This runs both paths and then merges them into one final candidate file.

Hashes must be copied from a trusted frozen-catalog freeze event and supplied explicitly.
Do not auto-read the sibling `manifest.json` at live runtime as the trust anchor.

## Outputs

Predictive run prints:

- `prejump_pack.parquet`
- `summary.json`
- `deduped_symbols.jsonl`
- `excluded_matches_recommendation_close_ret_gte.jsonl`

Legacy parent run prints:

- `daily_pack.jsonl`
- `summary.json`
- `deduped_symbols.jsonl`
- `excluded_matches_recommendation_close_ret_gte.jsonl`

Step-B run prints:

- `templates_lite.jsonl`
- `summary.json`
- `deduped_symbols.jsonl`
- `excluded_matches_recommendation_close_ret_gte.jsonl`

Step-B D+1 baseline train/OOS runs additionally print:

- frozen train catalog + manifest
- train reapply OOS-style report outputs
- OOS raw report outputs
- OOS `close28` filtered apply outputs
- leaderboard + guardrail summaries listed above

Operationally, the main file to read in both cases is `deduped_symbols.jsonl`.

The combined run prints these paths:

- `combined_summary.json`
- `combined_deduped_symbols.jsonl`

For the predictive primary operation, the main file to read is `deduped_symbols.jsonl`.
For legacy combined comparison, the main file to read is `combined_deduped_symbols.jsonl`.

## Guardrail

- [server_prejump_curated_perfect_prototypes_after_close.sh](/home/saida/code/stockdesk-lab-lite/tools/server_prejump_curated_perfect_prototypes_after_close.sh) fails fast unless the catalog surface is `v5_prejump_contextual`.
- [server_curated_perfect_prototypes_after_close.sh](/home/saida/code/stockdesk-lab-lite/tools/server_curated_perfect_prototypes_after_close.sh) fails fast if the curated catalog is not parent-rule based.
- [server_stepb_curated_perfect_prototypes_after_close.sh](/home/saida/code/stockdesk-lab-lite/tools/server_stepb_curated_perfect_prototypes_after_close.sh) fails fast if the curated catalog is not a child `PP_*` Step-B catalog.
- Step-B D+1 baseline wrapper must fail fast unless:
  - the split policy is explicit
  - the train catalog is frozen before train reapply/OOS
  - train/OOS reports carry catalog hash + rule-id hash
  - leaderboard output is accompanied by concentration/OOS guardrails
  - train exactness drift is surfaced explicitly in `train_reapply_summary.json` / `baseline_manifest.json`
- Legacy combined operation does not merge the catalogs themselves. It merges the final per-day matched symbol outputs.
- Research note:
  - the current plus-lite widened `2d/3d` diagnosis is an exact-overfit issue on a few train-date clusters, not an OOS apply-path failure
  - the next research run should add date breadth gates (`min train matched dates`, `top1/top3 date share`, `matched-date signature cap`) and fix the OOS matched-date count report metric
  - the next-stage widened-line root-cause patch goes beyond date-count gating:
    - add temporal breadth metrics for months and quarters
    - promote `minTrainMatchedMonths` / `minTrainMatchedQuarters` to safe search-time pruning, just like `minTrainMatchedDates`
    - preserve `top1/top3 date share` as final gates only
    - keep the current exact DFS/indexed miner path and add diverse candidate ordering/frontier bucketing inside that path instead of introducing a new engine
    - add a set-level diverse catalog selector so final frozen catalogs optimize coverage breadth and redundancy, not only train hit count
    - add an explicit experimental KRIMP / MDL selector branch as a research alternative to the greedy diverse selector
    - validate this first on widened plus-lite `same_day_plus_recent_upto_3d` with existing server pack/index artifacts reused at `200k`
  - A-free stays unchanged for now; keep the reusable A-free artifacts and operating subset pinned until a separate A-free breadth-gate experiment is explicitly planned
- persistent worker slot bundle must also expose:
  - `parallelWorkerSpawnCount`
  - `parallelWorkerSlotReuseCount`
  - `parallelWorkerWarmLaunchCount`
  - `parallelWorkerColdStartMs`
  - `parallelWorkerWarmLaunchMs`
- persistent worker slots must preserve:
  - exact final rule set / champion / matches / coverage
  - existing chunk-local `progress.json`, `summary.json`, `live_budget.json`, `budget_request.json`, `budget_decision.json`, and `live_partial_rules.json` contracts
  - existing request/ack and reclaim-fastpath semantics on the canonical runtime path
- current next blocker is slot control-plane latency:
  - commit-stage active reclaim gating is closed and canonical server `npm run verify` now includes the positive persistent-slot smoke
  - live ops must treat `parallelRemainingGrantableSearchBudget` as the primary budget headroom metric
  - outstanding allowance telemetry should be watched alongside grantable budget during probes
- A-free open-train exact discovery status:
  - the streamed indexed build contract is now valid for the `1081567`-row open pack
  - a zero-state rerun was traced to `tools/mine_perfect_prototypes_indexed.mjs` coercing omitted `--root-end` / `--worker-chunk-index` flags to `0`
  - after fixing optional numeric flag parsing, the same A-free indexed artifact produced:
    - `53` exact rules
    - `200000` explored states
    - budget stop `allocated_budget_exhausted`
  - operational meaning:
    - A-free indexed discovery is now a valid runnable path
    - any further A-free discovery work should tune search budget or search quality, not rebuild the streamed index contract again
  - current A-free direct `200k / 4GB` canonical throughput baseline:
    - `105.16s`
    - `1362276 KB`
    - `53` exact rules
    - `200000` explored states
    - `ruleIdsSha256=5bffcdbc8b25129f5632a104114f8e1897d05ebaa9459d7332b8e76dd41e2abf`
  - current A-free direct states/sec hotspot breakdown:
    - `candidateDescriptorBuildMs=26193`
    - `rowsetIntersectionMs=10463.194`
    - `memoLookupMs=7917.739`
    - `orderingHeadRerankMs=2967`
    - `negativeCountResolutionMs=2373`
  - current optimization contract for the A-free direct exact path:
    - keep the reusable indexed artifact fixed
    - keep the heavy gate at server-only `200k / 4GB`
    - treat exactness drift as hard failure
    - target JS-side candidate generation / rerank / memo overhead before revisiting rowset-kernel changes
  - current accepted partial optimization result on that A-free path:
    - `perfect_proto_stepb_afree_seed_posting_pin_v1`
    - `perfect_proto_stepb_afree_streaming_candidate_head_v1`
    - canonical rerun outcome:
      - `97.99s`
      - `1331668 KB`
      - `53` exact rules
      - `200000` explored states
      - identical `ruleIdsSha256`
    - visible hotspot movement:
      - `candidateDescriptorBuildMs=22983`
      - `orderingHeadRerankMs=1075`
      - `negativeCountResolutionMs=2281`
      - `rowsetIntersectionMs=10291.749`
      - `memoLookupMs=7869.223`
    - operating conclusion:
      - full seed pinning plus primitive candidate-head handling is worth keeping
      - next large A-free throughput gains still need deeper candidate-universe reduction, not another rowset backend rewrite
  - next exact-safe A-free follow-up now queued:
    - `perfect_proto_stepb_afree_memo_full_rowset_hash_v1`
  - memo full-rowset-hash follow-up result:
    - exactness held, but the canonical A-free `200k / 4GB` rerun regressed:
      - `97.99s -> 102.75s`
      - `1331668 KB -> 1341416 KB`
      - `memoLookupEntryScanCount` stayed at `3591167`
    - operating conclusion:
      - do not promote full-rowset-hash memo keys on this line
      - the remaining large win still has to come from candidate-universe reduction
  - current remaining parallel contract on the A-free line:
    - patch key: `perfect_proto_stepb_afree_parallel_live_budget_reclaim_v1`
    - treat the earlier `perfect_proto_stepb_afree_parallel_reclaim_v2` microtranche/slack-cap attempts as inconclusive
    - root cause is not rowset math:
      - the parent/worker control-plane can measure active sibling reclaimable budget but cannot actually transfer it
      - worker-side external budget handling is monotonic and rejects downward live-budget revisions
    - required fix direction:
      - deterministic donor reclaim via downward live-budget revision
      - worker acceptance of monotonic revision / non-monotonic allocated budget
      - direct vs parallel `maxSearchStates` semantics must remain aligned
    - validation gate:
      - same reusable A-free exact index
      - server-only `200k / 4GB`
      - exactness locked to the canonical `53 / 200000 / ruleIdsSha256`
  - parallel live-budget reclaim implementation result:
    - `perfect_proto_stepb_afree_parallel_live_budget_reclaim_v1`
    - root-cause fix shipped:
      - worker-side external budget refresh now accepts deterministic downward live-budget revisions as long as the new lease stays above the guard-band floor
      - parent reclaim path now performs real donor reclaim commits instead of only measuring reclaimable budget
      - verify now runs `tools/smoke_prejump_parallel_live_budget_regression_acceptance.mjs` to prove a worker actually applies live-budget decreases
    - server verify result:
      - `npm run verify` passed with the new regression-acceptance smoke enabled
    - server heavy benchmark result:
      - run id:
        - `perfect_proto_stepb_plus_lite_recent_impulse_3d_afree_train_parallel_live_budget_reclaim_200k_v1_20260321`
      - outcome:
        - failed with `global_budget_exhausted`
      - wall / RSS:
        - `81.33s`
        - `1166088 KB`
      - observed budget state at stop:
        - `parallelCompletedChunkReclaimSearchStates=45057`
        - `parallelActiveWaveExploredStates=154624`
        - observed total completed+in-flight states: `199681`
        - `parallelRemainingSearchBudget=319`
        - `parallelRemainingGrantableSearchBudget=0`
        - `parallelActiveReclaimAttemptCount=39`
        - `parallelActiveReclaimCommitCount=11`
        - `parallelActiveReclaimSearchStates=53268`
    - operating conclusion:
      - deterministic live-budget reclaim is now real and verified, but it is still insufficient to let the multi-worker run finish under the same nominal `200k` contract
      - keep the direct A-free accepted line active at `84.31s / 1664284 KB`
      - the next parallel follow-up has to reduce simultaneous frontier overcommit and align direct vs parallel completion semantics before any `20M+` promotion
  - next exact-safe A-free follow-up now queued:
    - `perfect_proto_stepb_afree_row_projected_candidate_generation_v1`
    - rationale:
      - the accepted baseline still spends most of its wall time in JS candidate creation:
        - `candidateDescriptorBuildMs=22983`
        - `rowsetIntersectionMs=10291.749`
        - `memoLookupMs=7869.223`
  - row-projected candidate-generation follow-up result:
    - `perfect_proto_stepb_afree_row_projected_candidate_generation_v1`
    - root-cause fix:
      - unify row-token token-id assignment with token dictionary write order in the streamed A-free exact index builder
      - fail fast if the miner sees non-ascending or duplicated token dictionary order while reconstructing row-projected token ids
    - rebuilt reusable A-free streamed index:
      - `perfect_proto_stepb_plus_lite_recent_impulse_3d_afree_train_stream_index_build_v3_20260321`
      - `1081567` rows
      - `623` tokens
      - `150337813` token postings
    - canonical direct A-free `200k / 4GB` rerun with `--row-projected-candidate-threshold=128`:
      - `53` exact rules
      - `200000` explored states
      - identical `ruleIdsSha256`
      - `87.29s`
      - `1614868 KB`
    - interpretation:
      - exactness is locked again after the token-id contract repair
      - row-projected candidate generation materially reduces wall time on the A-free direct path
      - RSS rose to about `1.61 GB`, which is still operationally acceptable on the current server but should be watched before larger-state promotion
  - next exact-safe A-free follow-up now queued:
    - `perfect_proto_stepb_afree_native_batch_threshold_scoring_v1`
    - rationale:
      - the next major cost is still JS-side threshold scoring and candidate scan churn
      - native batched `countAtLeast/hasAny` scoring is the next direct states/sec lever after row-projected universe reduction
      - low-support states should stop scanning the full remaining seed list and only consider tokens that actually appear inside the current positive rows
    - patch contract:
      - keep the reusable A-free exact index fixed except for adding row-to-token adjacency artifacts
      - preserve existing rule ordering and exact rule-id hash
      - gate on the same canonical server `200k / 4GB` benchmark with identical rule hash
  - native batch threshold-scoring follow-up result:
    - `perfect_proto_stepb_afree_native_batch_threshold_scoring_v1`
    - root-cause fix:
      - add exact native batch count APIs for sparse/sparse, sparse/bitmap, bitmap/sparse, and bitmap/bitmap rowset comparisons
      - batch-score positive candidate counts and exact negative counts inside the direct A-free indexed miner before the final candidate loop
      - delay negative rowset materialization until a candidate is actually accepted or sampled instead of materializing every surviving candidate eagerly
    - canonical direct A-free `200k / 4GB` rerun on the reusable streamed v3 index:
      - `53` exact rules
      - `200000` explored states
      - identical `ruleIdsSha256`
      - rules payload identical after normalizing away catalog-envelope metadata fields
      - `84.31s`
      - `1664284 KB`
    - interpretation:
      - exactness stayed locked
      - wall time improved by about `3.4%` versus the accepted `87.29s` row-projected baseline
      - RSS rose by about `3.1%`, which is still within the current operating budget
      - the next visible bottleneck is now memo lookup/control-plane overhead, not JS rerank churn
    - default contract update:
      - direct indexed Step-B discovery defaults now keep `rowProjectedCandidateThreshold=128` unless a run explicitly overrides it
  - capped parallel semantics-align follow-up result:
    - `perfect_proto_stepb_afree_parallel_microchunk_semantics_align_v1`
    - root-cause fix that did land:
      - `tools/mine_perfect_prototypes.mjs` now applies the indexed no-gap defaults to `--index-dir` parallel runs too, so the corrected rerun restored `selectedSeedCount=623` instead of the stale `192`
    - corrected server `200k / 4GB` rerun was still not promotable:
      - run id:
        - `perfect_proto_stepb_plus_lite_recent_impulse_3d_afree_train_parallel_microchunk_semantics_align_200k_v3_20260321`
      - `1639` exact rules
      - `199683` observed explored states at truncation
      - `ruleIdsSha256=aa7c6558883921697c806dd67173f5008ecbcf305a10cfd9e1ff1a1db49fcdc6`
      - `96.92s`
      - `1114660 KB`
    - control-plane evidence:
      - `parallelAcceptedGlobalBudgetTruncation=true`
      - `parallelDispatchCount=4`
      - `parallelCompletedChunkCount=1`
      - `parallelObservedTotalExploredStatesAtTruncation=199683`
    - interpretation:
      - the direct-vs-parallel seed/default contract mismatch is fixed, but capped multi-root parallel search still produces a different catalog under the same nominal `200k` budget
      - the corrected rerun is also slower than the accepted direct A-free line at `84.31s / 1664284 KB`
      - keep the direct A-free path active
      - do not promote or repeat this capped-`200k` semantics-align bundle; any future multi-worker promotion must either preserve strict direct-order root progression or move to an explicit large-state throughput contract
  - accepted direct A-free `53`-rule catalog open-OOS replay:
    - patch key: `perfect_proto_stepb_afree_53rule_open_oos_eval_v1`
    - frozen catalog reused:
      - `53` exact rules
      - `ruleIdsSha256=5bffcdbc8b25129f5632a104114f8e1897d05ebaa9459d7332b8e76dd41e2abf`
    - OOS open pack:
      - `2025-01-01 .. 2026-01-31`
      - `strict_label_boundary`
      - `253743` usable rows
    - report contract note:
      - default-heap `report_perfect_prototypes_oos.mjs` OOMed on the OOS pack
      - exact replay completed successfully with `NODE_OPTIONS=--max-old-space-size=6144`
    - OOS outcome:
      - `dedupedMatches=24`
      - `dedupedHits=7`
      - `dedupedPrecision=29.17%`
      - `uniqueMatchedSymbols=24`
      - `uniqueMatchedDates=2`
      - `matchedRuleCount=22`
      - `zeroNegativeRuleCount=3`
      - `hit2ZeroNegativeRuleCount=0`
    - top precision rules:
      - `PP_00d5b9b7b2d2`: `1/1`
      - `PP_010af475ec31`: `1/1`
      - `PP_cacd580ca02d`: `1/1`
  - stricter A-free `minHitCount=10` open-OOS replay:
    - patch key:
      - `perfect_proto_stepb_afree_33rule_minhit10_open_oos_eval_v1`
    - reused catalog:
      - `33` exact rules
      - `ruleIdsSha256=14ababf24199d0fcad5b319665ec4566a3aeb13324684de91c23e937250b8cac`
    - reused the same open OOS pack:
      - `2025-01-01 .. 2026-01-31`
      - `253743` source rows
    - exact report outcome:
      - `dedupedMatches=0`
      - `dedupedHits=0`
      - `matchedRuleCount=0`
    - interpretation:
      - raising the train exact hit floor to `10` improved train-side selectivity but overshot OOS coverage for the current open-market window
  - wrapper default promotion:
    - patch key:
      - `perfect_proto_stepb_afree_wrapper_promote_v1`
    - primary server heavy wrapper:
      - [server_run_stepb_dplus1_plus_lite.sh](/home/saida/code/stockdesk-lab-lite/tools/server_run_stepb_dplus1_plus_lite.sh)
    - new default contract:
      - A-free open-pack discovery is the primary path
      - train side now builds `daily_pack.jsonl`, compiles the exact index from that open pack, mines on the compiled index, freezes the catalog, and replays it on open train/OOS packs
      - the wrapper no longer uses Step-A/Step-B `templates_lite.jsonl` discovery as its default runtime path
    - heap contract:
      - open-pack report/apply/leaderboard stages now run with explicit `NODE_OPTIONS=--max-old-space-size=6144`
      - this bakes in the already-proven root-cause fix for default-heap open-pack OOMs instead of relying on ad hoc reruns
  - day-capped top-2 contract implemented:
    - patch key:
      - `perfect_proto_stepb_daycap2_v1`
    - contract name:
      - `day_capped_top2_v1`
    - discovery contract:
      - hit counting switches from raw matched rows to `day_capped_symbol_count`
      - cap:
        - `2` symbols per date
      - rule payloads retain both:
        - `trainHitCountRaw`
        - `trainHitCountCapped`
      - comparator now prefers:
        - capped hit count
        - matched date count
        - raw hit count
    - apply/OOS contract:
      - selection mode:
        - `top2_per_day_union`
      - selection pipeline:
        - union all matched rules
        - dedupe by symbol/day
        - rank within each date bucket
        - keep at most `2` symbols per date
    - canonical server validation:
      - reusable A-free exact index only
      - reusable open OOS pack only
      - discovery `200k / 4GB`:
        - `9` rules
        - `200000` explored states
        - `ruleIdsSha256=e0c391269da6fa5f350d71f8fe7a1ff257f6d3a3477eae0ebbbb17423e0b74a1`
        - `46` matched train rows across `46` dates
      - open OOS replay under `top2_per_day_union`:
        - `31` selected rows
        - `8` hits
        - selected precision:
          - `25.81%`
    - 200k day-cap calibration on the same reusable A-free index:
      - `minHitCount=4`
        - `78` rules
        - OOS selected rows:
          - `137`
        - OOS hits:
          - `52`
        - selected precision:
          - `37.96%`
      - `minHitCount=6`
        - `9` rules
        - OOS selected precision:
          - `25.81%`
      - `minHitCount=8`
        - `1` rule
        - OOS selected rows:
          - `2`
        - OOS hits:
          - `0`
      - `minHitCount=10`
        - `0` rules
    - operating interpretation:
      - the contract fixed the earlier one-day multi-symbol spike inflation
      - surviving rules now require repeated cross-date behavior
      - current recommended day-cap cutoff:
        - `minHitCount=4`
  - max-rules unclamp root-cause fix:
    - patch key:
      - `perfect_proto_stepb_max_rules_unclamp_v1`
    - root cause:
      - [perfect_prototype_miner.mjs](/home/saida/code/stockdesk-lab-lite/src/lib/perfect_prototype_miner.mjs) had been clamping `maxRules` to `5000` inside `normalizeMinerOptions()`, even when the CLI explicitly requested a larger value
    - fix:
      - removed the `5000` hard cap
      - persisted requested `maxRules` and `maxSearchStates` into catalog metadata
      - strengthened [smoke_stepb_exact_compiled_input.mjs](/home/saida/code/stockdesk-lab-lite/tools/smoke_stepb_exact_compiled_input.mjs) so this cannot silently regress
    - server validation:
      - `npm run verify` passed after the fix
    - unclamped A-free `20M` result:
      - run id:
        - `perfect_proto_stepb_afree_daycap2_train_discovery_20m_minhit2_maxrules100k_unclamped_v1_20260321`
      - reusable exact index:
        - reused the pinned A-free train index
      - contract:
        - `day_capped_top2_v1`
        - `minHitCount=2`
        - `maxRules=100000`
        - `maxSearchStates=20000000`
        - `rowProjectedCandidateThreshold=128`
        - heap cap:
          - `6144 MB`
      - final result:
        - `68226` saved rules
        - `20000000` explored states
        - `ruleIdsSha256=a3305d82f74cc480460a0be3894ec67ca140e836ac6addd847679b83c283b84d`
        - `catalogContentSha256=7564458bd465a57916b566259045c3cb741d739a6032a68ba563ffbc8aaf4fba`
        - wall:
          - `1:59:38`
        - max RSS:
          - `6026936 KB`
      - operating conclusion:
        - the old “request `100000`, save `5000`” failure mode is removed
        - future high-cap discovery runs can trust the manifest/catalog metadata to reflect the actual requested `maxRules`
  - `2026-03-21` 68,226-rule A-free OOS replay
    - run id:
      - `perfect_proto_stepb_afree_daycap2_68226_open_oos_eval_v1_20260321`
    - reused artifacts:
      - frozen train catalog:
        - `perfect_proto_stepb_afree_daycap2_train_discovery_20m_minhit2_maxrules100k_unclamped_v1_20260321`
      - reusable OOS pack:
        - `perfect_proto_stepb_afree_53rule_open_oos_eval_v1_20260321`
    - contract:
      - `day_capped_top2_v1`
      - `top2_per_day_union`
      - OOS window:
        - `2025-01-01 ~ 2026-01-31`
      - heap cap:
        - `6144 MB`
    - selected portfolio result:
      - `512` selected rows
      - `202` hits
      - precision:
        - `39.453125%`
      - `260` matched dates
      - `316` matched symbols
    - rule-level note:
      - `47496` rules matched at least once
      - `9604` rules were `100%` on rule-level OOS precision
      - top practical rules included:
        - `PP_6c4f08a16fbd` `12/20`
        - `PP_1021023d4f2c` `11/17`
        - `PP_4771a0150f43` `11/18`
  - `2026-03-23` widened plus-lite `3d` root-cause note
    - staged `200k` validation showed that:
      - breadth pruning, diverse beam ordering, diverse selector, and MDL selector all reduced redundancy
      - but none of those stages increased the widened plus-lite `3d` train date footprint beyond roughly `17` dates
      - OOS raw matches remained `0`
    - operating interpretation:
      - the primary defect is upstream candidate generation and support semantics, not frozen-catalog selection
      - selector and MDL modes remain valid compression options, but they should not be treated as the first-line rescue path for widened plus-lite `3d`
    - next root-cause patch family:
      - add chronological fold-stability metrics and pruning
      - add fold-share final gates
      - run widened plus-lite `3d` probes with explicit `day_capped_symbol_count`
      - add Step-A lane provenance to the direct exact index and interleave root-seed exploration by lane
    - validation rule:
      - widened plus-lite heavy probes stay server-only
      - pack reuse remains preferred
      - direct exact index rebuild is acceptable when lane provenance must be materialized into the indexed artifact
