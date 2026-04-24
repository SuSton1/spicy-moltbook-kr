# Predictive Indexed Mining Checklist

## Goal

Keep predictive prototype mining semantics unchanged while replacing the slow JSONL full-load path with a parquet-first indexed mining path.

This checklist is predictive-only. The legacy `Step-B D+1 baseline` line is a separate reference path and must not be mixed into predictive catalogs, wrappers, or runtime decisions.

## Current Mining Throughput Bundle

- canonical research target is now the full-range exact train window:
  - `2020-11-27 .. 2024-12-31`
  - exact label semantics remain fixed:
    - `decisionDate=D`
    - `entry=D+1 open`
    - `3-day / +8% / -4%`
  - target catalog questions:
    - `precision=1.0` and `trainMatchCount>=6`
    - later follow-up catalog on the same full-range index:
      - `precision>=0.8` and `trainMatchCount>=6`
- latest valid partitioned predictive index for mining-only reprobe remains:
  - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_reprobe_walltime_baseline_v1_20260316_3/step-perfect-prototype-index`
  - this 3-month index is validation-only for throughput/control-plane work
  - it is not the canonical production target for the full-range exact rule search
- restored usable merged full-range index is now:
  - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_fullrange_exact_target_restore_20260317_073337/step-perfect-prototype-index`
  - current effective trading coverage is `2020-11-27 .. 2024-12-30`
  - canonical calendar target remains `2020-11-27 .. 2024-12-31`
  - `2024-12-31` is a KRX holiday, so an effective trading end at `2024-12-30` does not by itself imply missing source rows
- legacy full-range shard indexes under:
  - `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_prejump_index_probe_20260315_145221/step-perfect-prototype-prejump/*/step-perfect-prototype-index`
  remain the canonical reuse target for the restored full-range run
  - legacy tokenizer fingerprint metadata and direct input provenance repair is closed
  - legacy shard `token_dictionary.parquet` schema v1 -> v2 upgrade is also closed
  - the existing monthly shards are now reusable for exact partition merge
- latest live mining reprobe signal shows sparse-state dominance:
  - root states may start as `bitset`
  - actual search states remain overwhelmingly `sparse`
  - sparse CPU v4 is complete and memo skyline v6 is now complete
- latest exact-safe hardening bundle completed:
  - `perfect_proto_sparse_bitmap_universe_contract_guard_v1`
  - `perfect_proto_memo_budget_compaction_integrity_v1`
- latest memo throughput hardening bundle completed:
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
  - parent grants request-scoped budget allowances first and records committed top-ups only after worker `budget_commit.json` ack
  - manifest/progress top-up telemetry now reflects applied commits instead of speculative pre-use reservations
- current full-run blocker is:
  - no fresh exact-safe blocker is open in the current parallel budget control-plane path
  - the full-range chunk rebalance bundle is now closed in canonical verify:
    - full-range skewed seed-cost planning no longer collapses into an all-bootstrap head-only plan in verify
  - the effective-trading coverage contract bundle is now closed:
    - canonical exact target remains `2020-11-27 .. 2024-12-31`
    - restored merged effective trading coverage is now explicitly modeled as `2020-11-27 .. 2024-12-30`
    - `2024-12-31` is a KRX holiday, not a confirmed source-gap day
    - canonical local/server `npm run verify` now pass with the holiday-aware effective-trading coverage smoke
    - fresh 180-second full-range probe `perfect_proto_timeprobe_fullrange_effective_coverage_20260317_082819` did not fail on coverage contract semantics
    - fresh 180-second full-range probe observed:
      - `parallelChunkPlannerImbalanceRatio=24.7161`
      - `parallelFirstChunkCompletionElapsedMs=null`
      - top-level live `precision=1.0` / `trainMatchCount>=6` candidates before first chunk completion: `8`
  - canonical server `npm run verify` now executes the positive persistent-slot smoke plus request/ack, reclaim/ack, live-topup, and guardband budget smokes
  - do not treat this as a reason to shrink `maxSeedTokens`, `maxRules`, or `maxSearchStates`
- latest target-restoration bundle completed:
  - `perfect_proto_fullrange_shard_dictionary_v2_upgrade_v1`
  - legacy full-range shard token dictionaries are now upgraded from schema v1 -> v2
  - the merged full-range exact index was restored
  - 180-second full-range probe observed `8` live `precision=1.0` / `trainMatchCount>=6` candidates before first chunk completion
- latest exact-safe full-range coverage/chunk bundle completed:
  - `perfect_proto_fullrange_target_coverage_chunk_rebalance_v1`
  - full-range chunk planning now preserves a global target chunk plan and bounded head/tail rebalance in verify
- latest exact-safe full-range coverage-contract bundle completed:
  - `perfect_proto_fullrange_effective_trading_coverage_contract_v1`
  - requested calendar range and effective trading coverage are now modeled separately on the canonical full-range path
- latest exact-safe full-range chunk-cost bundle completed:
  - `perfect_proto_fullrange_chunk_cost_calibration_v1`
  - planner cost now consumes token-dictionary byte/span metadata
  - bootstrap-head ordering now uses `bootstrapDispatchScore`
  - worker-slot ready timeout now tolerates full-range cold-starts above 30s
  - commit-pending allowances are no longer re-granted from the same `budget_request.json`
  - local/server `npm run verify` now pass with the cost-calibration smoke and repaired low-budget request/commit contract
- current blocker before the first exact full production run is:
  - full-range first-wave dispatch still misranks head chunks on the restored 4-year index
  - latest 180-second full-range probe `perfect_proto_timeprobe_fullrange_chunk_cost_calibration_v4_20260317_091243` showed:
    - `parallelChunkPlannerImbalanceRatio=9.5184`
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelWorkerSlotReuseCount=0`
    - `worker_000.exploredStatesPerSec=2.218`
    - `worker_001.exploredStatesPerSec=20.556`
    - top-level live `precision=1.0` / `trainMatchCount>=6` candidates before first chunk completion: `8`
- next canonical runtime patch is:
  - `perfect_proto_fullrange_head_microprobe_dispatch_v1`
  - remove the hard all-head ready-queue prefix so stronger tail chunks may preempt weaker head chunks inside the first dispatch band
  - add deterministic first-wave head microprobe scoring/splitting so the first two launched chunks track real search cost better before the next `15~20 minute` probe
  - preserve a bootstrap-head launch quota in the initial dispatch band instead of preserving an absolute head-first queue
- latest exact-safe full-range first-wave bundle completed:
  - `perfect_proto_fullrange_first_wave_completion_target_split_v1`
  - deterministic completion-target splitting now applies to the first `workerCount` launch chunks
  - canonical verify now includes `smoke_prejump_parallel_fullrange_first_wave_completion_target_split.mjs`
  - fresh 180-second probe `perfect_proto_timeprobe_fullrange_first_wave_completion_target_split_20260317_111339` showed:
    - smaller initial leases on the first pair
    - live `precision=1.0` / `trainMatchCount>=6` rules before first completion
    - real budget request/grant/commit/top-up activation
    - but still `parallelCompletedChunkCount=0`
    - and `parallelFirstChunkCompletionElapsedMs=null`
  - fresh 20-minute probe `perfect_proto_midprobe_fullrange_first_wave_completion_target_split_20260317_111658` still showed:
    - `parallelCompletedChunkCount=0`
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelBudgetTopupCount=17`
    - `parallelWorkerSlotReuseCount=0`
- memo cache resident-byte contract now requires:
  - `memoCacheBytes` must equal the live resident bytes of positive buckets plus frontier entries
  - bucket eviction must subtract both bucket base bytes and frontier entry bytes
  - insertion-path frontier compaction must increment `memoFrontierCompactionCount`
- short mining-only reprobe throughput readings taken before the resident-byte fix are not canonical
- current objective is one exact production mining run that finishes sooner, not measurement-only reprobe
- current blocker before the first exact full production run is now:
  - latest fresh 180-second probe `perfect_proto_timeprobe_fullrange_multi_root_completion_ranking_20260317_172733` still showed:
    - `parallelCompletedChunkCount=0`
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelBudgetTopupCount=4`
    - `parallelFirstWaveSingletonRootChunkCount=2`
    - `parallelFirstWaveMultiRootChunkCount=0`
  - slot command inspection on that probe showed the first launch pair reverted to singleton-root scope:
    - `rootSeedStartIndex=962`, `rootSeedEndIndexExclusive=963`
    - `rootSeedStartIndex=89`, `rootSeedEndIndexExclusive=90`
  - worker progress on that probe still split badly even with singleton ranking active:
    - one worker ran at `151.287 states/s`
    - the other ran at `6.325 states/s`
  - latest exact-safe runtime bundle completed:
    - `perfect_proto_fullrange_first_wave_forced_singleton_microshard_v1`
    - canonical verify now includes `smoke_prejump_parallel_fullrange_forced_singleton_microshard.mjs`
    - fresh 180-second probe `perfect_proto_timeprobe_fullrange_forced_singleton_microshard_20260317_175750` observed:
      - `parallelFirstWaveForcedSingletonMicroshardCount=4`
      - `parallelFirstWaveSingletonRootChunkCount=2`
      - `parallelFirstWaveMultiRootChunkCount=0`
      - first launch pair:
        - `rootSeedStartIndex=949`, `rootSeedEndIndexExclusive=950`
        - `rootSeedStartIndex=88`, `rootSeedEndIndexExclusive=89`
      - `parallelCompletedChunkCount=0`
      - `parallelFirstChunkCompletionElapsedMs=null`
      - `worker_000.exploredStatesPerSec=103.392`, `etaSeconds=57.4`
      - `worker_001.exploredStatesPerSec=7.078`, `etaSeconds=1827.2`
  - the active blocker is now:
    - launch binding is now live: the final first-wave pair stays bound to completion-target singleton descendants
    - but even after that, a materially heavy singleton root can keep absorbing live top-ups without producing the first real completion
    - fresh canonical probes observed:
      - `perfect_proto_timeprobe_fullrange_completion_target_launch_binding_20260317_192101`
      - `perfect_proto_midprobe_fullrange_completion_target_launch_binding_20260317_192439`
    - the 20-minute probe still ended with:
      - `parallelCompletedChunkCount=0`
      - `parallelFirstChunkCompletionElapsedMs=null`
      - `parallelFirstWaveCompletionTargetLaunchCount=2`
      - `parallelFirstWaveSingletonRootChunkCount=2`
      - `parallelFirstWaveMultiRootChunkCount=0`
      - `parallelBudgetTopupCount=23`
- latest canonical runtime bundle completed:
  - `perfect_proto_fullrange_singleton_root_exact_completion_microprobe_v1`
  - the full bound singleton-root first-wave candidate pool is now probed and static-score fallback is fail-fast on the live path
  - fresh canonical probes observed:
    - `perfect_proto_timeprobe_fullrange_singleton_exact_completion_microprobe_20260317_215330`
    - `perfect_proto_midprobe_fullrange_singleton_exact_completion_microprobe_20260317_215701`
  - the 180-second probe still ended before worker search materially advanced:
    - `parallelFirstWaveExactCompletionProbeCount=17`
    - `parallelFirstWaveExactCompletionProbeSingletonCandidateCount=17`
    - `parallelCompletedChunkCount=0`
    - `parallelFirstChunkCompletionElapsedMs=null`
  - the 20-minute probe showed the exact-probe path is live but still no first completion:
    - `parallelFirstWaveExactCompletionProbeCount=17`
    - `parallelFirstWaveExactCompletionProbeReachedTerminalCount=0`
    - `parallelCompletedChunkCount=0`
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelBudgetTopupCount=19`
    - `parallelWorkerSlotReuseCount=0`
    - `worker_000.rulesCollected=0` after `166302` explored states
    - `worker_001.rulesCollected=18` after `12960` explored states
- latest exact-safe runtime bundle completed:
  - `perfect_proto_fullrange_stage1_exact_probe_collapse_v1`
  - keep the startup `progress.json` telemetry path on the primary path
  - move the stage-1 singleton exact-probe off the array-intersection path and onto native rowset/count primitives
  - keep the live stage-1 heartbeat telemetry and the shared planning cache path intact
  - keep exact semantics and deterministic first-wave planning contracts intact
  - harden worker-slot command dispatch by re-asserting `_slot` directory existence before every control-plane write
  - canonical verify gates now cover the same startup/reuse smokes plus the rowset-native singleton exact-probe smoke path
  - local `npm run verify`: passed
  - server `npm run verify`: passed
  - full production run remains blocked until a fresh canonical probe shows non-null `parallelFirstChunkCompletionElapsedMs`
- latest fresh canonical 180-second probe after the stage-1 exact-probe collapse bundle:
  - `perfect_proto_timeprobe_fullrange_stage1_exact_probe_collapse_20260318_143730`
  - ran with canonical native/runtime env and the same restored full-range exact index
  - `EXIT_STATUS=124`
  - stage-1 startup/probe wall is effectively removed from the canonical path:
    - latest observed parent phase before timeout: `search_ready_queue`
    - `parallelPlanningExactProbeStage1ElapsedMs=8141`
    - `parallelPlanningExactProbeStage1ChunksCompleted=24`
    - `parallelPlanningExactProbeStage1ChunkCount=24`
    - `parallelPlanningExactProbeStage2Ms=334`
    - `parallelPlanningReadyQueueMs=5`
    - `parallelDispatchCount=2`
    - `parallelActiveChunkCount=2`
    - `parallelReadyQueueDepth=55`
  - the run still timed out at `180s` with:
    - `parallelCompletedChunkCount=0`
    - `parallelFirstChunkCompletionElapsedMs=null`
    - `parallelWorkerSlotReuseCount=0`
    - `exploredStates=12076`
    - `mergedObservedRuleCount=0`
  - top-level terminal artifacts still did not land before timeout:
    - `parallel_manifest.json`
    - `summary.json`
  - top-level `live_floor.json` was emitted after worker-slot spawn
  - worker-local state on the two launched chunks before timeout:
    - `worker_000 / chunk_003 / rootSeed[38,39) / maxSearchStates=9925 / exploredStates=9031 / rulesCollected=0`
    - `worker_001 / chunk_021 / rootSeed[56,57) / maxSearchStates=14227 / exploredStates=3045 / rulesCollected=0`
  - therefore the active blocker moved again:
    - no longer stage-1 singleton probe planning
    - now the first launched chunk pair fails to reach completion inside the canonical `180s` probe
  - next exact-safe runtime patch is now:
    - `perfect_proto_fullrange_first_chunk_exact_search_collapse_v1`
    - keep this as a one-hypothesis-only bundle:
      - do not retune ranking or launch shape in the same patch
      - do not mix candidate-pool shrink with the control-plane churn fix
    - target the worker-side exact-search wall after `search_ready_queue` without shrinking the candidate pool
    - surface launched chunk identity and per-chunk search telemetry clearly at the parent level
    - use the direct single-chunk baseline `perfect_proto_singlechunk_probe_chunk003_20260318_144923` as the control comparison:
      - `rootSeed[38,39)` with `allocatedMaxSearchStates=9925` completed in `31.60s`
      - the same logical chunk under the canonical parallel probe only reached `exploredStates=9031` before the `180s` timeout
    - therefore treat steady-state control-plane churn as the first runtime hypothesis to clear:
      - parent no-request budget fastpath polling
      - parent worker-slot completion polling
      - missing parent-visible active chunk telemetry during `search_ready_queue`
    - treat `parallelBudgetFastpathTickCount`, `parallelBudgetFastpathServiceMs`, and parent-emitted active chunk telemetry as the first root-cause counters to watch on the next canonical `180s` probe
    - bundle scope before any further probe expansion:
      - idle fastpath ticks must not call the budget service when no request/commit activity exists
      - worker-slot completion polling must become progress-aware instead of unconditional fixed-rate polling
      - expose `parallelBudgetFastpathIdleSkipCount` so the canonical probe can prove idle ticks were short-circuited instead of serviced
      - split worker-slot completion polling into hot vs steady counters so the canonical probe can prove long-running active chunks are no longer polled at the old fixed cadence
      - promote `tools/smoke_prejump_parallel_active_chunk_telemetry.mjs` and `tools/smoke_prejump_search_state_cache_incremental_range_summary.mjs` into the verify gate for this bundle
    - current status:
      - local `npm run verify` passed after the idle-fastpath skip and progress-aware completion-poll patch
      - targeted server smokes for `indexed_acceleration_adversarial`, `parallel_active_chunk_telemetry`, and `parallel_slot_request_grant_integrated` passed in isolation
      - fresh canonical `180s` probe is still blocked on obtaining one clean end-to-end server `npm run verify` sweep because unrelated DuckDB/index smoke flakes are still appearing in the shared server verify loop
    - add worker-side live exact-search counters before retrying any deeper algorithmic collapse:
      - root-seed span / worker chunk identity
      - `currentSearchDepth` / `maxSearchDepth`
      - `candidateDescriptorCount` / `acceptedCandidateCount`
      - worker `updatedAt` and parent-observed `progressAgeMs`
      - cumulative rowset runtime counters during active search, not only in terminal summaries
    - launched-pair comparison against the direct single-chunk control must also carry budget context:
      - `baseAllocatedMaxSearchStates`
      - `guardBandAllocatedSearchStates`
      - `allocatedMaxSearchStates`
      - `effectiveAllocatedMaxSearchStates`
      - `remainingGlobalSearchBudgetAtLaunch`
    - the parent must expose the launched pair individually during `search_ready_queue`, not only as wave aggregates
    - keep the new rowset-native stage-1 path intact
    - do not re-open previously failed ranking-only patch lines
    - next canonical `180s` probe only becomes a `Go` for the following bundle if:
      - parent `progress.json` shows non-stale `parallelActiveChunks` detail for the launched pair
      - at least one launched chunk emits the new worker-side live exact-search counters while still active
      - `parallelBudgetFastpathIdleSkipCount > 0` when no worker writes a budget request or commit file
      - `parallelWorkerSlotCompletionSteadyPollCount > 0` while at least one launched chunk remains in active exact search
      - either `parallelFirstChunkCompletionElapsedMs` becomes non-null or the remaining worker-local wall is directly attributable from parent-visible telemetry
  - do not advance to the `15~20 minute` probe or the first exact production full run from this result
- latest exact-safe runtime bundle completed:
  - `perfect_proto_fullrange_first_chunk_exact_search_collapse_v1`
  - keep ranking, launch shape, and candidate-pool size unchanged
  - keep the rowset-native stage-1 exact-probe path intact
  - collapse worker-side memo frontier range-summary churn on the exact-search path
  - surface launched chunk identity and live worker search telemetry through parent `parallelActiveChunks`
  - local `npm run verify`: passed
  - server `npm run verify`: passed
- latest fresh canonical 180-second probe after the first-chunk exact-search collapse bundle:
  - `perfect_proto_timeprobe_fullrange_first_chunk_exact_search_collapse_20260318_150309`
  - ran with the canonical native/runtime env and the same restored full-range exact index
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
  - top-level live control-plane counters before timeout:
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
    - `parallel_manifest.json`: not emitted before timeout
    - `summary.json`: not emitted before timeout
  - launched pair surfaced at the parent level:
    - `worker_000 / chunk_017 / rootSeed[52,53) / allocatedMaxSearchStates=14236 / effectiveAllocatedMaxSearchStates=22428 / exploredStates=20480 / exploredStatesPerSec=163.816 / etaSeconds=11.9 / memoLookupMs=1579.254 / rowsetIntersectionMs=1300.129 / orderingNegativeLoads=21832 / seedCacheHitRate=0.497444 / memoRangeSummaryRebuildCount=0 / currentSearchDepth=6 / maxSearchDepth=6 / candidateDescriptorCount=24193 / acceptedCandidateCount=20480 / rulesCollected=0`
    - `worker_001 / chunk_023 / rootSeed[58,59) / allocatedMaxSearchStates=10464 / effectiveAllocatedMaxSearchStates=18656 / exploredStates=13318 / exploredStatesPerSec=111.835 / etaSeconds=47.7 / memoLookupMs=1363.825 / rowsetIntersectionMs=1126.366 / orderingNegativeLoads=13630 / seedCacheHitRate=0.082609 / memoRangeSummaryRebuildCount=0 / currentSearchDepth=6 / maxSearchDepth=6 / candidateDescriptorCount=18344 / acceptedCandidateCount=13318 / rulesCollected=0`
  - therefore the previous runtime hypothesis is only partially confirmed:
    - parent-visible launched-pair telemetry is now live
    - `memoRangeSummaryRebuildCount=0` on both active workers, so the prior memo frontier rebuild wall is cleared on the live path
    - no first completion still means the remaining blocker is inside the worker exact-search loop after `search_ready_queue`
  - `perfect_proto_fullrange_worker_exact_search_wall_v1` is now completed:
    - local `npm run verify` passed
    - server `npm run verify` passed
    - fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_exact_search_wall_20260319_053613` observed:
      - `EXIT_STATUS=124`
      - top-level parent state before timeout:
        - `phase=search_ready_queue`
        - `parallelDispatchCount=2`
        - `parallelActiveChunkCount=2`
        - `parallelReadyQueueDepth=55`
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - `parallelWorkerSlotReuseCount=0`
        - `exploredStates=126897`
        - `mergedObservedRuleCount=0`
      - top-level parent telemetry gap is now closed on the canonical path:
        - `parallelBudgetFastpathIdleSkipCount=564`
        - `parallelWorkerSlotCompletionHotPollCount=181`
        - `parallelWorkerSlotCompletionSteadyPollCount=236`
        - launched-pair `parallelActiveChunks` now include:
          - `baseAllocatedMaxSearchStates`
          - `guardBandAllocatedSearchStates`
          - `remainingGlobalSearchBudgetAtLaunch`
          - `seedPositiveLoadCount`
          - `seedNegativeLoadCount`
          - `seedPostingLoadMs`
          - `candidateDescriptorBuildMs`
          - `negativeCountResolutionMs`
          - `childRowsetMaterializeMs`
      - launched worker exact-search telemetry now attributes the remaining wall directly:
        - worker `chunkIndex=17`: `seedPostingLoadMs=122108`, `candidateDescriptorBuildMs=55503`, `negativeCountResolutionMs=66299`, `childRowsetMaterializeMs=2149`, `rowsetIntersectionMs=3916.203`, `seedCacheHitRate=0.73533`
        - worker `chunkIndex=23`: `seedPostingLoadMs=132350`, `candidateDescriptorBuildMs=44744`, `negativeCountResolutionMs=87587`, `childRowsetMaterializeMs=1215`, `rowsetIntersectionMs=1849.407`, `seedCacheHitRate=0.114714`
      - conclusion:
        - the remaining blocker is the worker-side seed posting load / negative-count resolution path inside the exact-search loop
        - `materializeChildRowsets` / rowset intersection time is now clearly secondary on the canonical path
  - `perfect_proto_fullrange_worker_seed_posting_load_collapse_v1` is now completed:
    - local `npm run verify` passed
    - server `npm run verify` passed
    - fresh clean canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_seed_posting_load_collapse_20260319_055500` observed:
      - `EXIT_STATUS=124`
      - top-level parent state before timeout:
        - `phase=search_ready_queue`
        - `parallelDispatchCount=2`
        - `parallelActiveChunkCount=2`
        - `parallelReadyQueueDepth=55`
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - `parallelWorkerSlotReuseCount=0`
        - `exploredStates=1164288`
        - `mergedObservedRuleCount=0`
      - launched worker telemetry before timeout:
        - worker `chunkIndex=17`: `seedPostingCacheEntryLimit=1496`, `seedCacheHitRate=0.999353`, `seedPostingLoadMs=3426`, `negativeCountResolutionMs=6290`, `candidateDescriptorBuildMs=20269`, `childRowsetMaterializeMs=12127`, `rowsetIntersectionMs=28349.389`, `memoLookupMs=20561.056`, `orderingNegativeLoads=661072`
        - worker `chunkIndex=23`: `seedPostingCacheEntryLimit=1496`, `seedCacheHitRate=0.998922`, `seedPostingLoadMs=4444`, `negativeCountResolutionMs=10586`, `candidateDescriptorBuildMs=15999`, `childRowsetMaterializeMs=15472`, `rowsetIntersectionMs=31897.987`, `memoLookupMs=28404.305`, `orderingNegativeLoads=576652`
      - deeper worker `progress.json` snapshots now show the next hidden wall directly:
        - worker `chunkIndex=17`: `memoRangeSummaryRebuildCount=461`
        - worker `chunkIndex=23`: `memoRangeSummaryRebuildCount=272`
      - conclusion:
        - the worker seed posting load / negative-count resolution wall is materially reduced on the canonical path
        - `exploredStates` increased from `126897` to `1164288`, so the bundle did unlock substantially deeper exact search
        - no first completion still means the next blocker is deeper in the worker loop:
          - `memoRangeSummaryRebuildCount` is back on the live path once search runs longer
          - `rowsetIntersectionMs` / `childRowsetMaterializeMs` are now co-dominant costs, but they should not be mixed into the next memo-focused bundle
  - next exact-safe runtime patch is now:
    - `perfect_proto_fullrange_worker_memo_range_summary_rebuild_collapse_v1`
    - keep this one-hypothesis-only:
      - do not retune ranking
      - do not rewrite launch shape
      - do not shrink the candidate pool
      - do not rewrite rowset algorithms in the same bundle
    - target:
      - collapse live `memoRangeSummaryRebuildCount` / `memoLookupMs` on the deeper worker exact-search path that became reachable after the seed posting cache fix
      - preserve the improved seed posting cache hit path and exact semantics
    - preserve:
      - the rowset-native stage-1 path
      - the worker seed posting cache entry limit / hit-rate telemetry
      - the parent-visible launched-pair worker telemetry
      - parent-visible `parallelBudgetFastpathIdleSkipCount`
      - parent-visible `parallelWorkerSlotCompletionHotPollCount`
      - parent-visible `parallelWorkerSlotCompletionSteadyPollCount`
      - launched-pair `baseAllocatedMaxSearchStates`
      - launched-pair `guardBandAllocatedSearchStates`
      - launched-pair `remainingGlobalSearchBudgetAtLaunch`
    - next canonical `180s` probe is only a `Go` for any rowset-focused follow-up if:
      - live worker `memoRangeSummaryRebuildCount` materially drops on the launched pair
      - `memoLookupMs` is no longer one of the dominant counters on the active workers
      - the remaining wall is still attributable after the memo bundle without reopening ranking or launch-shape questions
    - that `Go` gate is now satisfied:
      - fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_memo_range_summary_rebuild_collapse_20260319_063229` showed launched-pair `memoRangeSummaryRebuildCount=0/0`
      - the remaining launched-pair wall stayed dominated by `memoLookupMs` and rowset work rather than rebuild churn
    - follow-on runtime patch `perfect_proto_fullrange_worker_rowset_fused_count_fill_v1` is now complete:
      - local `npm run verify` passed
      - server `npm run verify` passed
      - fresh clean canonical `180s` probe `perfect_proto_timeprobe_fullrange_worker_rowset_fused_count_fill_20260319_064709` observed:
        - worker `chunkIndex=17`: `memoRangeSummaryRebuildCount=0`, `memoLookupMs=21300.576`, `rowsetIntersectionMs=28301.895`, `childRowsetMaterializeMs=8829`, `candidateDescriptorCount=617906`, `acceptedCandidateCount=609131`
        - worker `chunkIndex=23`: `memoRangeSummaryRebuildCount=0`, `memoLookupMs=29338.8`, `rowsetIntersectionMs=30208.49`, `childRowsetMaterializeMs=10893`, `candidateDescriptorCount=580309`, `acceptedCandidateCount=569915`
        - versus the seed-posting baseline:
          - `childRowsetMaterializeMs` dropped from `12127/15472` to `8829/10893`
          - `rowsetIntersectionMs` eased from `28349.389/31897.987` to `28301.895/30208.49`
          - `acceptedCandidateCount` increased slightly from `604011/562747` to `609131/569915`
        - top-level result still ended with:
          - `parallelCompletedChunkCount=0`
          - `parallelFirstChunkCompletionElapsedMs=null`
          - `mergedObservedRuleCount=0`
      - conclusion:
        - fused rowset count/fill removed a real duplication cost, especially on child rowset materialization
        - the remaining blocker is still deeper exact-search efficiency, not a merge contract bug
        - feature pruning / row pruning remain blocked until contribution diagnostics prove any low-yield condition or row class is semantically disposable
    - feature/row contribution diagnostics bundle `perfect_proto_fullrange_feature_row_contribution_diagnostics_v1` is now complete:
      - local `npm run verify` passed
      - server `npm run verify` passed
      - fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_feature_row_first_wave_diagnostics_20260318_221626` observed:
        - top-level still ended with:
          - `parallelCompletedChunkCount=0`
          - `parallelFirstChunkCompletionElapsedMs=null`
          - `mergedObservedRuleCount=0`
        - launched worker `chunkIndex=17` tracked `386` features with the heaviest selection/cost concentration on:
          - `feature.pattern.closeClusterTightness3`
          - `feature.pattern.closeClusterTightness5`
          - `feature.shape.sidewaysScore3`
          - `feature.trend.closeOverMa5`
          - `feature.trend.closeNearMa5Pct`
        - launched worker `chunkIndex=23` tracked `385` features with the heaviest selection/cost concentration on:
          - `feature.trend.closeNearMa60Pct`
          - `feature.trend.highNearMa60Pct`
          - `feature.trend.closeNearMa10Pct`
          - `feature.trend.highNearMa20Pct`
          - `feature.trend.highNearMa120Pct`
        - both launched workers still showed:
          - `exactRuleCount=0`
          - `livePartialSnapshotRuleCount=0`
          - empty `rowContributionTopExactSymbols`
          - empty `rowContributionTopExactDates`
        - row diagnostics did prove:
          - `duplicateSourceIdRowCount=0`
          - `duplicateSymbolDateRowCount=0`
          - no contract-safe duplicate-row pruning candidate is currently justified
        - sampled negative concentration was visible, but only as diagnostics:
          - symbols led by `005500`, `099190`, `001510`, `060980`, `002700`
          - dates led by `2022-07-18`, `2022-05-30`, `2023-11-15`, `2022-09-13`, `2022-03-17`
      - conclusion:
        - the bundle now exposes per-feature and per-row cost/yield signals on the canonical path
        - but it still does **not** prove any feature or row class is semantically disposable
        - feature pruning / row pruning remain blocked
    - first-wave exact-yield diagnostics bundle `perfect_proto_fullrange_first_wave_exact_yield_diagnostics_v1` is now complete:
      - local `npm run verify` passed
      - server `npm run verify` passed
      - the same fresh canonical `180s` probe `perfect_proto_timeprobe_fullrange_feature_row_first_wave_diagnostics_20260318_221626` observed:
        - launched worker `chunkIndex=17`:
          - `candidateDescriptorCount=322418`
          - `acceptedCandidateCount=317069`
          - `yieldCandidateAcceptanceRate=0.98341`
          - `yieldRulesPerAcceptedCandidate=0`
          - `yieldLivePartialRulesPerAcceptedCandidate=0`
        - launched worker `chunkIndex=23`:
          - `candidateDescriptorCount=308323`
          - `acceptedCandidateCount=301205`
          - `yieldCandidateAcceptanceRate=0.976914`
          - `yieldRulesPerAcceptedCandidate=0`
          - `yieldLivePartialRulesPerAcceptedCandidate=0`
        - ready-queue head yield telemetry showed:
          - queued `chunkIndex=24` still had `firstWaveCompletionTarget=true` but `firstWaveDispatchScore=0.019356`, slightly below the launched pair `0.019801/0.019695`
          - queued multi-root heads `chunkIndex=35/32/34` were far lower at `0.000145/0.000125/0.000123`
      - conclusion:
        - the diagnostics do **not** support an immediate launch-policy retune
        - the launched pair is already consuming a high-acceptance, high-candidate flow but is still producing zero exact/live-partial rules inside `180s`
        - the remaining blocker is still deeper worker exact-search efficiency or low rule density on the current exact line, not an obvious queued-chunk mislaunch
    - `perfect_proto_fullrange_worker_memo_lookup_fastpath_v1` is now complete:
      - checklist/live-ops/handoff were updated first, then the bundle was implemented and verified
      - local `npm run verify`: passed
      - server `npm run verify`: passed
      - fresh canonical `180s` probe:
        - run id: `perfect_proto_timeprobe_fullrange_worker_memo_lookup_fastpath_20260319_000001`
        - exit status: `124`
        - top-level remained `phase=search_ready_queue`
        - `parallelCompletedChunkCount=0`
        - `parallelFirstChunkCompletionElapsedMs=null`
        - `mergedObservedRuleCount=0`
      - launched-pair worker telemetry on the fresh probe showed:
        - worker `chunkIndex=17`
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
        - worker `chunkIndex=23`
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
        - the bundle succeeded in exposing the missing lookup sub-metrics without changing exact semantics
        - it did **not** deliver the required launched-pair `memoLookupMs` reduction
        - the newly instrumented fingerprint/range/prefix/suffix timings account for only a minority of total `memoLookupMs`, so the next blocker is now the larger memo miss-path outside those scans
        - the remaining likely wall is `getOrCreatePositiveBucket` and non-dominated frontier insertion work, not launch policy, pruning, or row/feature trimming
      - do not advance to the `15~20 minute` probe or full run from this result
    - next exact-safe runtime patch is now:
      - `perfect_proto_fullrange_worker_memo_miss_path_breakdown_v1`
      - preserve launch policy, candidate pool, rowset semantics, and exact semantics
      - instrument and then reduce the uncovered memo miss-path:
        - positive-bucket fingerprint/equality lookup
        - positive collision-bucket scan
        - negative-rowset clone/estimate path
        - frontier insertion/index maintenance path
      - still forbidden in this bundle:
        - feature pruning
        - row pruning
        - launch retune
        - ranking retune
        - candidate-pool shrink
        - rowset algorithm rewrite
- canonical full-range exact production mining inputs are:
  - feature store root: `/home/moltook/apps/stockdesk-lab-lite/artifacts/feature-store/prejump_v5`
  - contextual surface: `v5_prejump_contextual`
  - restored merged exact index: `/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_fullrange_exact_target_restore_20260317_073337/step-perfect-prototype-index`
- canonical full-range exact production mining command, once the blocker is closed, is:
  - `node tools/mine_perfect_prototypes_parallel_indexed.mjs --index-dir=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/perfect_proto_fullrange_exact_target_restore_20260317_073337/step-perfect-prototype-index --out-dir=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/<RUN_ID>/step-perfect-prototype --train-start=2020-11-27 --train-end=2024-12-31 --min-hit-count=6 --max-gap=100000 --max-rule-size=6 --max-seed-tokens=4000 --max-rules=4000 --max-search-states=20000000 --workers=2 --ordering-head-window=8 --search-state-cache-max-bytes=134217728`
- ready-queue live-floor bundle must preserve:
  - exact search semantics
  - exact final rule set / champion / matches / coverage
  - deterministic final rule ranking / champion selection regardless of worker completion timing
  - `< kthHitFloor` prune only; equality remains non-prunable
- prelaunch probe collapse bundle must also preserve:
  - the same full singleton completion-target candidate pool on the canonical primary path
  - no heuristic candidate-pool shrink to make the run finish earlier
  - no replay-only adaptive stage-2 fallback once resume-based stage-2 lands
- ready-queue miner must lease the remaining global `maxSearchStates` budget before each chunk launch
- every launched chunk must receive an explicit `allocatedMaxSearchStates`
- every launched chunk must also record:
  - `baseAllocatedMaxSearchStates`
  - `guardBandAllocatedSearchStates`
  - `effectiveAllocatedMaxSearchStates`
- every chunk run must record `remainingGlobalSearchBudgetAtLaunch`
- no later chunk may launch after a worker truncates at its allocated search-state budget
- a worker must never report `exploredStates` above `effectiveAllocatedMaxSearchStates`
- the chunk guard band is an exact-budget leasing detail only; it must not reduce the global `maxSearchStates` total search allowance
- ready-queue live-floor bundle must emit parent progress / manifest fields:
  - `parallelChunkCount`
  - `parallelWaveCount`
  - `parallelCompletedChunkCount`
  - `parallelCompletedWaveCount`
  - `parallelGlobalKthHitFloor`
  - `parallelFloorSeededChunkCount`
  - `parallelWaveMergeMs`
  - `parallelChunkPlannerImbalanceRatio`
- ready-queue live-floor bundle must also emit:
  - `parallelReadyQueueDepth`
  - `parallelDispatchCount`
  - `parallelImmediateRefillCount`
  - `parallelLiveFloorUpdateCount`
  - `parallelLiveFloorRevision`
  - `parallelFirstGlobalFloorElapsedMs`
  - `parallelActiveAllocatedSearchBudget`
  - `parallelSlotIdleMs`
- active parent progress must continue updating during search, not only at merge points
- active parent progress must expose:
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
- running worker progress / summary must expose:
  - `externalKthHitFloor`
  - `externalKthHitFloorRevision`
  - `externalKthHitFloorPollCount`
  - `externalKthHitFloorAppliedCount`
  - `effectiveKthHitFloor`
  - `externalBudgetRequestCount`
  - `externalBudgetRequestSatisfiedCount`
  - `externalBudgetRequestDeniedCount`
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
- next exact-safe hardening bundle is:
  - `perfect_proto_parallel_atomic_control_plane_v1`
  - control-plane JSON writes for worker progress/summary, parent progress, `parallel_manifest.json`, and `live_floor.json` must be atomic
  - parent active progress polling must fail fast on malformed control-plane JSON after a file exists
  - worker external live-floor polling must fail fast on malformed/unreadable `live_floor.json`
  - bootstrap `ENOENT` before the first parent floor write is the only allowed missing-file case
- live partial-rule floor bundle must preserve:
  - exact final rule set / champion / matches / coverage
  - exact `< kthHitFloor` pruning only
  - no duplicate counting of active worker snapshot revisions in the parent live-floor aggregate
  - per-chunk live snapshots must include at least the local canonical top `maxRules` and may include the local tie band at the snapshot floor
  - parent live-floor aggregate may be more conservative than the final completed merge floor, but must never be more aggressive than exact-safe semantics allow
- validation after memo skyline v6 and memo budget/compaction integrity may reuse the 3-month validation index and run mining-only reprobe
- restoring the canonical production target now requires a usable merged full-range index for `2020-11-27 .. 2024-12-31`
- do not keep using the 3-month validation index as a substitute for the full-range exact target
- do not reduce `maxSeedTokens`, `maxRules`, or `maxSearchStates` to make runs finish sooner
- do not introduce approximate or fallback-style pruning to force early completion
- do not solve chunk-budget overruns by shrinking search-space knobs; fix worker stop semantics and chunk leasing instead
- bootstrap live partial-rule overscan must be control-plane only; it must not change final selection semantics or worker-local exact search
- do not hide live-floor/control-plane corruption behind retry-only or null-return behavior in runtime code
- persistent worker slot bundle must also expose:
  - `parallelWorkerSpawnCount`
  - `parallelWorkerSlotReuseCount`
  - `parallelWorkerWarmLaunchCount`
  - `parallelWorkerColdStartMs`
  - `parallelWorkerWarmLaunchMs`
- first-chunk exact-search collapse bundle must also emit parent-visible active chunk telemetry during `search_ready_queue`:
  - `parallelActiveChunks[].chunkIndex`
  - `parallelActiveChunks[].dispatchOrder`
  - `parallelActiveChunks[].workerSlotIndex`
  - `parallelActiveChunks[].rootSeedStartIndex`
  - `parallelActiveChunks[].rootSeedEndIndexExclusive`
  - `parallelActiveChunks[].phase`
  - `parallelActiveChunks[].exploredStates`
  - `parallelActiveChunks[].exploredStatesPerSec`
  - `parallelActiveChunks[].etaSeconds`
  - `parallelActiveChunks[].memoLookupMs`
  - `parallelActiveChunks[].orderingNegativeLoads`
  - `parallelActiveChunks[].memoRangeSummaryRebuildCount`
  - `parallelActiveChunks[].stateDominancePruneCount`
  - `parallelActiveChunks[].livePartialRuleCount`
  - `parallelActiveChunks[].progressUpdatedAt`
- persistent worker slots must preserve:
  - exact final rule set / champion / matches / coverage
  - existing chunk-local `progress.json`, `summary.json`, `live_budget.json`, `budget_request.json`, `budget_decision.json`, and `live_partial_rules.json` contracts
  - existing request/ack and reclaim-fastpath semantics on the canonical runtime path
- current next blocker is slot control-plane latency and allowance churn visibility, not commit-stage active reclaim gating
- canonical verify gate is now closed for the current parallel budget path:
  - server `npm run verify` runs the positive persistent-slot smoke plus request/ack, reclaim/ack, live-topup, and guardband budget smokes
  - regressions in parallel budget exact-stop/request/reclaim/top-up semantics should no longer bypass the canonical gate
- canonical runtime must fail fast unless the required sparse kernel mode is `adaptive_exact_v4`
- dense sparse/bitset and dense bitset/bitset intersections must fail fast unless:
  - the explicit `universeSize` exactly matches the canonical dense result universe
  - the output word length is exactly `ceil(universeSize / 32)`
  - the last output word has no bits above the declared universe
- clipping or silently ignoring out-of-universe dense bits is forbidden

## Invariants

- `decisionDate = D`
- `entry = D+1 open`
- label contract: `3-day hold / +8% / -4%`
- feature language: `v5_prejump_contextual`
- mining defaults:
  - `maxGapTradingDays = 100000`
  - `maxRuleSize = 6`
  - `maxSeedTokens = 4000`
  - `maxRules = 4000`
  - `maxSearchStates = 20000000`
- ranking / tie-break must remain unchanged
- final `ruleId`, `matches`, and `coverage` must match the legacy JSONL miner for the same predictive fixture

## Exact Pruning Invariants

- `count-first` pruning is exact only for:
  - `minHitCount`
  - `NO_MATCH_CHANGE`
  - `NO_NEGATIVE_SEPARATION_PROGRESS`
  - top-K hit bound with `candidatePositiveCount < kthHitFloor`
- intermediate `PRECISION_REGRESSION` is not exact-safe for conjunctive search and must not be used as a prune gate
- top-K hit bound is allowed on `outputMode = full` and on disjoint-root partial workers only
- top-K hit bound must never prune on equality; `candidatePositiveCount == kthHitFloor` must continue
- dominance memo is exact only when all of the following hold:
  - same positive match set
  - cached negative set is a subset of the new negative set
  - cached `startAt <= nextStartAt`
  - cached `ruleSize < nextRuleSize`
- child ordering may change local traversal order only; it must not change canonical uniqueness or token availability

## Native Exact Runtime Invariants

- native rowset kernel is a required runtime dependency on the predictive indexed primary path
- native postings delta decode is a required runtime dependency on the predictive indexed primary path
- server sync must never overwrite the server-built native rowset kernel artifact
- `scripts/sync_to_server.sh` must exclude `native/perfect_prototype_rowset_kernel/build/`
- canonical server verify/smoke must always load a server-built native kernel binary
- runtime native load must fail fast before `require()` when:
  - the native build manifest is missing
  - current `kernel.cc` hash mismatches manifest `sourceSha256`
  - current `.node` hash mismatches manifest `outputSha256`
  - manifest platform / arch / N-API contract mismatches the current runtime
- current runtime contract is `native exact sparse/plain-bitset`, not a compressed bitmap container engine
- public rowset shape must remain:
  - `mode = sparse`
  - `mode = bitset`
- backend metadata is descriptive only and must not be documented as a separate compressed-container contract
- native load/build failure must fail fast with a remediation message
- hidden JS degraded fallback is forbidden
- validation must prove native vs JS exact equality before server mining runs are allowed
- current runtime-completion bundle intentionally excludes:
  - real compressed bitmap 2-container backend
  - rowset pool / ownership refactor
  - diffset negative-state engine
  - full roaring 3-container / run-container backend
  - approximate bitmap containers

## Index Merge Acceleration Invariants

- the current index-stage primary-path bottleneck is `merge_postings` in `src/lib/perfect_prototype_token_index_merge.mjs`
- partitioned index progress / ETA must use actual merged distinct token counts, not the sum of per-shard token counts
- primary-path partition merge must not depend on one DuckDB FIFO stream per shard
- primary-path dictionary merge must use one canonical global stream ordered by:
  - `token`
  - deterministic `shardIndex` tie-break
- merge completion must fail fast unless:
  - `mergedTokenCount == expectedDistinctTokens`
  - `dictionaryCursorRows == expectedDictionaryRefRows`
- merged-dictionary stats must be materialized in the same DuckDB stage as the canonical merged artifact; do not rescan shard-union inputs just to recompute stats
- the canonical merged-dictionary temp artifact must be emitted as an already ordered direct stream and consumed without a second DuckDB/parquet sort pass
- do not rely on parquet physical row order as a contract for merged-dictionary streaming
- within one merged token group, the same `shardIndex` may appear at most once; duplicate `(token, shardIndex)` refs must fail fast
- partitioned merge must preflight shard token-dictionary schema before merge begins:
  - `tokenDictionarySchemaVersion >= 2`
  - required columns include:
    - `positiveFirstRowIdx`
    - `positiveLastRowIdx`
    - `negativeFirstRowIdx`
    - `negativeLastRowIdx`
- primary-path postings merge must use required native shifted-delta merge
- hidden JS degraded fallback is forbidden on the primary `token_postings.bin` merge path
- debug-only `emitTokenPostingsParquet=true` may remain slower, but it must preserve exact output semantics
- current index merge acceleration bundle intentionally excludes:
  - real compressed bitmap 2-container backend
  - rowset pool / ownership refactor
  - diffset negative-state engine
  - full postings splice-merge optimization
  - DuckDB row-bridge replacement with a non-JSON transport
  - file-to-file postings splice finalization

## Step-Change Output / Memo / Merge Bundle

- the next step-change bundle must close these remaining exact-performance ceilings:
  - output-side JSONL sink replacement for final `row_meta/token_stats/token_dictionary` parquet export
  - partial-merge hit-floor bucket pruning without `Array.prototype.filter()` re-materialization
  - memo skyline insertion/removal without fingerprint-bucket rebuilds
- primary index build/merge output paths must not use JSONL batch sinks on the canonical path
- fixed-schema delimited sinks must:
  - receive explicit column order and DuckDB types
  - fail fast on column-count mismatch
  - fail fast on non-scalar values
  - avoid schema inference
- partial merge hit-floor pruning must compact buckets in place
- memo skyline fingerprint indexes must support delete/update without full bucket rebuild
- current step-change bundle intentionally excludes:
  - compressed bitmap backend
  - SIMD native rowset kernel rewrite
  - diffset negative-state engine

## Step-Change Rowset / Splice Bundle

- the next step-change bundle must close these remaining exact-performance ceilings:
  - rowset intersection/result allocation pressure in indexed mining
  - JS merged-buffer write-back on the primary `token_postings.bin` merge path
- primary mining rowset path must use:
  - pooled scratch buffers
  - explicit `borrowed` vs `owned` ownership
  - fail-fast if a borrowed rowset escapes into long-lived state
- long-lived rowset owners must store owned rowsets only:
  - dominance memo buckets/frontiers
  - any other cache/manifests that outlive one local child expansion
- primary `token_postings.bin` merge must use required native splice-style merge:
  - rewrite the bridge delta / first varint only
  - copy the remainder of each posting segment in native code
  - do not materialize merged posting buffers in JS on the canonical path
- splice merge must validate:
  - monotonic shifted row indexes
  - `firstRowIdx` / `lastRowIdx` metadata consistency
  - malformed/unterminated first-varint input
  - count / empty-segment contract mismatches
- current rowset/splice bundle intentionally excludes:
  - compressed bitmap backend
  - SIMD native rowset kernel rewrite
  - diffset negative-state engine

## Step-Change SIMD Bitset Bundle

- the next step-change bundle must close these remaining exact-performance ceilings:
  - dense/dense exact bitset intersection count still running through scalar native loops
  - dense/dense exact bitset materialization still running through scalar native loops

## Step-Change Query Stream Completion Bundle

- the next step-change bundle must close these remaining exact-performance ceilings:
  - primary parquet reader paths still using DuckDB `FORMAT JSON` fifo streams
  - JSON parse overhead on structured wrapper / partial-rule primary readers
  - schema inference/drift risk on primary parquet query streams
- primary predictive parquet reader paths must use explicit fixed-schema delimited query streams
- structured parquet reader paths must:
  - declare explicit schemas
  - normalize structured columns to canonical JSON text inside DuckDB select expressions before delimited streaming
  - deserialize structured JSON text fields explicitly
  - fail fast on column-count/type/JSON mismatches
  - support legacy typed struct/list/map parquet columns only through that canonical normalization expression
- canonical primary reader paths that must not use JSON query streams:
  - indexed row-meta load
  - token-stats seed selection
  - typed wrapper parquet iteration
  - partial-rule parquet iteration
  - feature-values sidecar parquet iteration
  - recommendation close-return sidecar parquet lookup
  - partitioned index shard row-meta merge
  - predictive token-index build ordered wrapper stream
  - token-dictionary selected-entry stream
- keep the old JSON query-stream helper only for non-primary/debug paths until they are explicitly migrated
- current query-stream completion bundle intentionally excludes:
  - compressed bitmap backend
  - sparse/bitset SIMD microbundle
  - diffset negative-state engine
  - dense/dense equality/subset checks still running through scalar native loops
- the dense primary backend remains the current exact plain-bitset contract:
  - public rowset modes remain `sparse` / `bitset`
  - backend metadata remains descriptive only
  - compressed bitmap container engines are explicitly deferred from this bundle
- canonical SIMD contract for this bundle:
  - x86_64 only
  - AVX2 required
  - POPCNT required
  - missing SIMD support must fail fast at build / verify / runtime
  - hidden scalar degraded fallback is forbidden
- canonical SIMD scope for this bundle:
  - `bitmapBitmapIntersectionCount`
  - `bitmapBitmapIntersectionWordsFill`
  - `bitmapBitmapIntersectionValuesFill`
  - `bitmapEquals`
  - `bitmapSubset`
  - `bitmapMaterializeValues`
- scalar tails for partial vectors are allowed only as an exact tail-handling detail inside the AVX2-required path
- current SIMD bitset bundle intentionally excludes:
  - compressed bitmap backend
  - run-container / roaring-style container expansion
  - diffset negative-state engine
- next structured-sink completion bundle targets:
  - predictive feature-store wrapper parquet
  - predictive feature-store `feature_stats.parquet`
  - predictive feature-values sidecar index parquet
  - predictive pack parquet
  - parallel worker `partial_rules.parquet`
  - all remaining predictive primary-path JSONL parquet sinks must be removed in favor of explicit fixed-schema structured/delimited sinks
  - structured columns must serialize as explicit JSON text under a fixed schema and be parsed explicitly on read
  - `read_json_auto()` sink inference is forbidden on the predictive primary path once this bundle lands

## Next Step-Change Table Stream Completion Bundle

- the next canonical exact-speed bundle after query-stream completion must close these remaining ceilings:
  - primary `token_postings` table readback still using DuckDB `FORMAT JSON` fifo rows
  - JSON parse overhead on the canonical token-postings sort/read/compress path
  - schema-drift risk from implicit JSON-object table streams on the canonical path
- canonical scope for this bundle:
  - migrate `createDuckdbDelimitedToTableSink().streamRows()` to a fixed-schema delimited stream
  - require explicit schema contracts on canonical table-stream readers
  - migrate the primary `token_postings` readback in `src/lib/perfect_prototype_token_index.mjs`
  - expose explicit table-stream metrics in token-index manifests/summaries
- canonical invariants for this bundle:
  - primary `token_postings` table readback must not use JSON fifo rows
  - primary table streams must use explicit schemas and quoted identifiers
  - `token, rowIdx` deterministic ordering must remain unchanged
  - exact output postings / dictionary semantics must remain unchanged
  - hidden JSON degraded fallback is forbidden
- this bundle intentionally excludes:

## Native Runtime Guard / Parallel Telemetry Completion Bundle

- the next hardening bundle must close these remaining exact-runtime gaps:
  - direct server smoke/debug must fail fast on stale native rowset binaries before loading the addon
  - parallel merged mining summaries must aggregate all rowset/sparse/bitmap runtime counters instead of inheriting worker-0 values
  - parallel manifests must preserve the same telemetry needed for mining-only reprobe analysis
- canonical native runtime guard requirements:
  - validate the native build manifest before `require()` loads the `.node`
  - compare current `native/perfect_prototype_rowset_kernel/src/kernel.cc` hash with manifest `sourceSha256`
  - compare current `.node` hash with manifest `outputSha256`
  - fail fast on manifest/runtime `platform`, `arch`, or `nodeApiVersion` mismatch
  - short-circuiting `scripts/build_native_rowset_kernel.sh` as up to date is allowed only when:
    - current `kernel.cc` hash matches manifest `sourceSha256`
    - current `.node` hash matches manifest `outputSha256`
    - manifest runtime-contract fields match the current runtime/build contract
    - `buildInputsHash` still matches
  - `scripts/build_native_rowset_kernel.sh` must rebuild instead of short-circuiting when the existing binary or manifest is stale/corrupt, even if `buildInputsHash` matches
  - keep `scripts/build_native_rowset_kernel.sh` as the only canonical remediation
- canonical parallel telemetry requirements:
  - aggregate `rowsetBorrowHitCount`, `rowsetBorrowMissCount`, `rowsetOwnedAllocCount`, and `rowsetFinalizeCount`
  - aggregate `rowsetModeStats` numeric fields by explicit worker-sum contract
  - fail fast if worker `rowsetModeStats` root-mode strings disagree:
    - `rootPositiveMode`
    - `rootNegativeMode`
  - preserve the same deterministic `rowsetModeStats` shape in merged rejection summaries and `parallel_manifest.json`
  - aggregate sparse runtime counters:
    - `sparseSparseIntersectionMs`
    - `sparseBitmapIntersectionMs`
    - `sparseEqualSizeMergeCount`
    - `sparseAdaptiveGallopCount`
    - `sparseBitmapWordRunCount`
    - `sparseBitmapSkippedRunCount`
  - aggregate bitmap runtime counters:
    - `bitmapDenseDenseCount`
    - `bitmapIntersectionMs`
    - `bitmapMaterializeMs`
    - `bitmapEdgeSummaryMs`
  - fail fast if worker runtime mode strings disagree:
    - `sparseKernelMode`
    - `bitmapKernelMode`
  - persist memo skyline v5 counters in `parallel_manifest.json`:
    - `memoFrontierSkippedBucketCount`
    - `memoFrontierCompactionCount`
  - smoke must validate merged counters against worker-summary sums, not just finite presence
  - smoke must validate merged `rowsetModeStats` equality against worker-summary sums and root-mode consistency
- canonical runtime-guard verify requirements:
  - verify must cover `sourceSha256` mismatch
  - verify must cover `outputSha256` mismatch
  - verify must cover missing build manifest
  - verify must cover malformed build manifest JSON
  - verify must cover manifest `platform` mismatch
  - verify must cover manifest `nodeApiVersion` mismatch
- current runtime/cleanup follow-up bundle must also close:
  - recommendation close-return sidecar candle-fingerprint scans still using DuckDB JSON row streaming
  - duplicated `rowsetModeStats` schema definitions between parallel merge code and server smoke
  - unreadable/corrupt existing native `.node` files that should force rebuild instead of failing before rebuild
- canonical sidecar cleanup requirements:
  - recommendation close-return sidecar fingerprint/date scans must use explicit delimited query streams
  - raw candle ingest may remain `read_json_auto(...)` for now, but JSON row-object streaming is forbidden on the canonical sidecar path
  - sidecar cleanup must not change sidecar partition semantics or freshness/fingerprint contracts
- compressed bitmap backend
- sparse/bitset SIMD microbundle
- memo skyline v4
  - diffset negative-state engine

## Next Step-Change Sparse CPU Completion Bundle

- the next canonical exact-speed bundle after table-stream completion must close these remaining ceilings:
  - scalar-heavy sparse/sparse exact native intersection/equals/subset hot loops
  - scalar-heavy sparse/bitset exact native membership/intersection hot loops
  - skyline memo frontier linear scans and splice-heavy deletes on the canonical indexed-mining path
- latest server re-probe conclusion:
  - index-only re-probe completed on the current patch stack
  - mining live probe showed sparse-state dominance on the canonical search path
  - sparse CPU remains the first follow-up bundle; memo skyline stays second
- canonical scope for this bundle:
  - strengthen sparse/sparse adaptive kernels with one shared exact core for count / values / fill / equals / subset
  - strengthen sparse/bitset exact kernels around word-run grouping on the canonical path
  - expose sparse-kernel runtime metrics in mining summaries
- canonical invariants for this bundle:
  - public rowset modes remain `sparse | bitset`
  - exact search semantics, ranking, tie-break, and `maxSearchStates` remain unchanged
  - hidden scalar degraded fallback is forbidden
  - memo dominance semantics must remain:
    - same positive match set
    - cached negative set subset of the candidate negative set
    - cached `startAt <= nextStartAt`
    - cached `ruleSize < nextRuleSize`
- this bundle intentionally excludes:
  - compressed bitmap backend
  - sparse/bitset SIMD gather rewrite
  - recommendation close-return sidecar raw-json cleanup
  - diffset negative-state engine

## Completed Step-Change Memo Skyline Bundle

- the completed canonical exact-speed bundle after sparse CPU v3 closed these remaining ceilings:
  - memo skyline bucket scans that still survive the current count-indexed frontier structure
  - tombstone-heavy frontier maintenance on the canonical indexed-mining path
- canonical scope for this completed bundle:
  - patch key: `perfect_proto_stepchange_memo_skyline_v5_v1`
  - add impossible-bucket skip metadata to memo skyline frontier buckets
  - make tombstone compaction threshold explicit and measurable
  - expose memo skyline skip/compaction metrics in mining summaries
  - keep the existing `PREJUMP_MEMO_SKYLINE_V3=true` runtime contract but treat it as the required gate for the v5 skyline implementation
- canonical metrics for this completed bundle:
  - `memoFrontierSkippedBucketCount`
  - `memoFrontierCompactionCount`
  - `memoFrontierScanCount`
  - `memoFrontierDeleteCount`
  - `memoLookupMs`
- canonical invariants for this completed bundle:
  - dominance semantics must remain:
    - same positive match set
    - cached negative set subset of candidate negative set
    - cached `startAt <= nextStartAt`
    - cached `ruleSize < nextRuleSize`
  - exact search semantics, ranking, tie-break, and `maxSearchStates` remain unchanged
  - hidden degraded memo path is forbidden
- this completed bundle intentionally excludes:
  - sparse-kernel rewrites
  - compressed bitmap backend
  - recommendation close-return sidecar raw-json cleanup
  - diffset negative-state engine

## Current Index Contract / Provenance Hardening Bundle

- the current canonical hardening bundle must guarantee:
  - `row_meta.parquet` is read with a strict contiguous `rowIdx` contract
  - `row_meta.parquet` also requires non-empty `sourceType`, `sourceId`, `dateKey`, and `symbol`
  - row-level `sourceType` / `strategyMode` must exactly match the dataset-level contract recorded by the index manifest/summary
  - predictive indexed manifests and summaries must persist canonical dataset `sourceType=perfect_prototype_prejump_pack`
  - `token_stats.parquet` seed streaming enforces strict ascending unique tokens and exact token-count agreement with manifest `tokenCount`
  - `token_dictionary.parquet` selected-entry loads enforce strict ascending unique tokens and exact agreement with requested unique token counts
  - partitioned index artifacts persist feature-store provenance sufficient to reject stale feature-store / index reuse
  - direct-built non-partitioned indexes persist explicit input provenance and fail fast on stale input reuse
  - direct partitioned-index merge must write canonical `manifest.json`, `summary.json`, and `partition_manifest.json` with feature-store provenance inside the merge library itself
  - the canonical server wrapper is partitioned-only and must reject `PREJUMP_PACK_SOURCE_MODE != feature_store`
  - indexed and parallel mining fail fast before search begins when current feature-store provenance mismatches the recorded partitioned-index provenance
  - the current server reprobe partitioned index artifact predates the provenance-complete contract and must be rebuilt before any mining-only reprobe
  - direct partitioned-index merge accepts only non-partitioned shard-local source indexes with explicit `inputProvenance.inputPaths`
  - direct partitioned-index merge must fail fast unless the exact union of source `inputProvenance.inputPaths` matches the selected feature-store partition parquet set for the recorded provenance range
  - canonical partitioned predictive tokenizer options are fixed and explicit:
    - `surfaceName=v5_prejump_contextual`
    - `binCount=5`
    - `includeSymbolToken=false`
    - `includeMissingTokens=false`
    - `includeCategoricalTokens=true`
  - canonical server partitioned-index build must pass those tokenizer options explicitly and fail fast on drift
  - tokenizer-spec cache files must use an explicit envelope contract and must not be bare tokenizer JSON blobs
  - invalid, legacy, or mismatched tokenizer-spec cache files must be rebuilt from feature-store sidecars before canonical partitioned build/merge proceeds
  - low-level direct build / merge tools require clean output directories and must fail fast on stale `partition_manifest.json` / stale canonical artifact reuse
- required `row_meta.parquet` checks:
  - `rowIdx` must be `0..rowCount-1` without gaps or duplicates
  - streamed row count must equal manifest `rowCount`
  - `outcomeHitTarget` must be boolean on every row
  - `positiveCount + negativeCount` must equal `rowCount`
  - `sourceType`, `sourceId`, `dateKey`, and `symbol` must be non-empty on every row
  - row-level `sourceType` and `strategyMode` must be dataset-consistent and match manifest/summary if recorded
- required `token_stats.parquet` checks:
  - tokens must be strictly ascending
  - duplicate tokens must fail fast
  - streamed token count must equal manifest `tokenCount`
- required `token_dictionary.parquet` checks:
  - tokens must be strictly ascending
  - duplicate tokens must fail fast
  - returned unique token count must equal requested unique token count
  - posting offsets / byte lengths / counts must stay finite non-negative integers
- required partitioned-index provenance fields:
  - `featureStoreDir`
  - `featureStoreManifestPath`
  - `featureStoreBuildManifestPath`
  - canonical dataset `sourceType`
  - `tokenizerSpecHash`
  - `tokenizerSpecFingerprintVersion`
  - tokenizer-spec fingerprint v2 must exclude volatile `generatedAt`
  - tokenizer-spec cache envelope must also persist:
    - `featureStoreDir`
    - `startDate`
    - `endDate`
    - `partitionStateHash`
    - `tokenizerSpecCacheKey`
    - `tokenizerSpecCacheInputs`
- `featureStoreProvenance.dataContractHash`
  - `featureStoreProvenance.selectedCoverage`
  - `featureStoreProvenance.selectedPartitionCount`
  - `featureStoreProvenance.partitionStateHash`
  - `featureStoreProvenance.tokenizerSpecCacheKey`
  - `featureStoreProvenance.tokenizerSpecCacheInputs`
- required direct-merge source-set checks:
  - duplicate source index directories must fail fast
  - already-partitioned source indexes must fail fast
  - every source manifest must expose explicit direct `inputProvenance.inputPaths`
  - duplicate source input paths must fail fast
  - missing source input paths versus expected feature-store partitions must fail fast
  - extra source input paths versus expected feature-store partitions must fail fast
  - every source shard index must expose `tokenizerSpecHash`
  - every source shard index must fail fast unless `tokenizer_spec.json` matches its recorded `tokenizerSpecHash`
  - direct merge must fail fast unless every source shard `tokenizerSpecHash` matches the canonical tokenizer spec implied by the current feature-store provenance
- required low-level build / merge dirty-output checks:
  - direct-build output directories must be empty before build starts
  - partitioned build output directories must be empty before build starts
  - partitioned build workspace directories must be empty before build starts
  - direct merge output directories must be empty before merge starts
  - direct-built output directories with stale `partition_manifest.json` must fail fast
  - manifest-declared `tokenPostingsParquetPath=null` must not be revived by stale on-disk parquet leftovers
- remediation on provenance mismatch must be explicit:
  - rebuild affected feature-store partitions with `tools/build_perfect_prototype_prejump_feature_store.mjs --overwrite-existing=true`
  - then rebuild the partitioned index with `tools/build_perfect_prototype_partitioned_token_index.mjs`
- the current server reprobe partitioned index artifact predates tokenizer-spec fingerprint persistence and must be rebuilt before mining-only reprobe

## Next Step-Change Sparse Kernel / Merge Stream Bundle

- the next canonical exact-speed bundle after structured sinks must close these remaining ceilings:
  - merged shard dictionary JSONL temp-stream materialization/parsing during partitioned index merge
  - scalar sparse/sparse exact native intersection hot loops
  - scalar sparse/bitset exact native membership/intersection hot loops
  - JS bitset first/last edge-summary scans on the canonical runtime path
- canonical scope for this bundle:
  - replace merged-dictionary temp JSONL with fixed-schema delimited temp stream
  - keep `token, shardIndex` strict monotonicity and duplicate `(token, shardIndex)` fail-fast checks unchanged
  - add adaptive exact sparse/sparse native kernels
  - add adaptive exact sparse/bitset native kernels
  - add native bitmap edge-summary helper for `firstValue` / `lastValue`
- canonical invariants for this bundle:
  - external rowset modes remain `sparse | bitset`
  - exact search semantics, `maxSearchStates`, ranking, and tie-break remain unchanged
  - hidden scalar degraded fallback is forbidden
  - merged-dictionary primary path must not depend on JSON.parse / JSON.stringify of temp stream rows
- this bundle intentionally excludes:
  - compressed bitmap backend
  - diffset negative-state engine
  - sparse/bitset SIMD intrinsics microbundle beyond exact adaptive kernels

## Forbidden Unsafe Prunes

- positive-only closure prune
- dominance prune on equal rule size
- top-K prune on `<= kthHitFloor`
- precision-only or gap-only upper-bound prune
- partial-worker top-K pruning outside disjoint root partitions
- heuristic pruning, approximate search, beam search, random sampling, or fallback engines

## Implementation Checklist

- [x] Add DuckDB/parquet helper layer
  - `src/lib/perfect_prototype_duckdb.mjs`
  - `src/lib/perfect_prototype_parquet_io.mjs`
- [x] Make predictive pack parquet-first
  - primary output: `prejump_pack.parquet`
  - optional debug output: `--emit-jsonl`
- [x] Remove temp JSONL reread from predictive pack build
  - predictive pack now performs predictive-only source slicing and no longer rereads temp base rows
- [x] Persist predictive pack metadata needed for coverage validation
  - `storageFormat`
  - `rowCount`
  - `outputCoverage`
  - `truncatedByLimitRows`
  - `coverageComplete`
- [x] Add predictive token index build stage
  - `row_meta.parquet`
  - `token_stats.parquet`
  - `tokenizer_spec.json`
  - primary postings runtime is `token_postings.bin + token_dictionary.parquet`
  - `token_postings.parquet` is now debug-only via `--emit-token-postings-parquet=true`
- [x] Add indexed predictive miner
  - seed selection from `token_stats`
  - postings intersection from indexed postings
  - final catalog/matches/coverage generation preserved
- [x] Move predictive pack/input contract to typed parquet rows
  - predictive wrappers now store typed columns directly
  - `rowJson` is no longer required on the predictive parquet path
- [x] Delay predictive row materialization until after search
  - indexed miner now searches against compact row-meta arrays
  - final catalog/match/coverage now derive dataset stats from row-meta without rebuilding full `datasetRows` arrays
- [x] Batch parquet sink writes for pack and token-index stages
  - reduce per-row syscall overhead without changing row order
- [x] Chunk seed token loading in indexed miner
  - reduce DuckDB planner pressure for `maxSeedTokens = 4000`
- [x] Add one-shot server run lock and preflight checks
  - `flock`-based mutual exclusion
  - fail-fast memory and disk checks before pack/index/mining start
  - fail-fast if another predictive heavy process is already running
  - explicit Node heap cap and DuckDB memory cap for server one-shot runs
- [x] Prune predictive runtime state after candidate indexing
  - keep only symbols and universe keys that still have surviving seeds
  - release per-symbol series/cache/meta as soon as the last seed for that symbol is emitted
- [x] Replace chunk temp seed-token queries with single-pass postings scan
  - stream exact compressed postings/dictionary artifacts in deterministic token order
  - collect only selected seed tokens in-memory
- [x] Add progress files for long-running stages
  - index build `progress.json`
  - indexed miner `progress.json`
  - progress payloads now include `rowsPerSec`, `tokensPerSec`, `exploredStatesPerSec`, `etaSeconds` where applicable
- [x] Accelerate exact indexed miner search loop without semantic drift
  - count-first rowset intersections now skip full materialization on exact-safe reject gates
  - top-K hit bound is enabled on full-output indexed mining and on disjoint-root partial workers only
  - state dominance memo prunes only strictly larger dominated states
  - state dominance memo is exact-safe but now byte-bounded; evictions are explicit memo-only pruning losses, never semantic drift
  - dynamic child ordering is local-order only and does not change canonical uniqueness
  - child-order candidate descriptors must not retain postings rowset references across the whole suffix scan
  - rowsets now support exact sparse/dense hybrid mode for hot intersections
  - dense postings can now decode directly into exact bitset rowsets without intermediate sparse arrays
- [x] Make predictive OOS consume parquet input
- [x] Make predictive apply consume parquet input
- [x] Keep predictive path fail-fast
  - no auto fallback to JSONL primary path
  - no auto downgrade when DuckDB is unavailable
- [x] Preserve legacy JSONL path for legacy/compare only
- [x] Preserve predictive/legacy surface isolation
- [x] Enforce predictive OOS coverage checks against usable rows
- [x] Add explicit predictive feature store
  - `tools/build_perfect_prototype_prejump_feature_store.mjs`
  - `artifacts/feature-store/prejump_v5/date=YYYY-MM-DD/part-000.parquet`
  - pack can assemble from feature store with `--source-mode=feature_store --feature-store-dir=...`
  - feature-store partitions are append-only by default and fail fast on existing date partitions unless overwrite is explicit
- [x] Add exact compressed postings artifacts
  - `token_postings.bin`
  - `token_dictionary.parquet`
  - `token_dictionary.json` summary metadata only
  - indexed miner now loads compressed postings from the dictionary/bin pair without giant JSON dictionary entries
  - final `token_postings.parquet` is disabled by default on the predictive primary path
- [x] Require exact feature-stats sidecars for predictive feature-store partitions
  - `artifacts/feature-store/prejump_v5/date=YYYY-MM-DD/feature_stats.parquet`
  - `artifacts/feature-store/prejump_v5/date=YYYY-MM-DD/feature_values.bin`
  - `artifacts/feature-store/prejump_v5/date=YYYY-MM-DD/feature_values_index.parquet`
  - partitioned predictive index build now fails fast with a rebuild message if legacy partitions are missing this sidecar
- [x] Validate predictive feature-store manifest carry-forward against both parquet artifacts
  - append-only manifest reuse now invalidates itself if any carried-forward partition is missing `part-000.parquet`, `feature_stats.parquet`, `feature_values.bin`, or `feature_values_index.parquet`
- [x] Make DuckDB row streaming wait for complete row consumption before resolving
  - fixes predictive parquet stream correctness for compressed postings and other streaming consumers
- [x] Canonicalize same-signature rule winners
  - explicit comparator now decides same-signature winners
  - no discovery-order dependence in indexed/legacy collection
- [x] Add deterministic parallel indexed miner
  - root seed partitions are searched independently
  - partial rule sets are merged by same-signature canonical comparator
  - final rank is deterministic
- [x] Add server smoke for indexed vs parallel exact equivalence
  - `tools/smoke_prejump_parallel_indexed_equivalence.mjs`
- [x] Remove string-based same-signature merge from parallel exact miner
  - worker merge now uses the same hash-bucket + exact row-index equality check style as the indexed miner
- [x] Add partitioned exact token-index build/merge on top of the predictive feature store
  - `tools/build_perfect_prototype_partitioned_token_index.mjs`
  - `src/lib/perfect_prototype_token_index_merge.mjs`
  - `tools/merge_perfect_prototype_token_index_partitions.mjs`
  - shard packs/indexes now share one global tokenizer spec and are exact-merged back into one predictive index
  - shard token-index builds now read feature-store partition parquet directly instead of materializing intermediate shard packs
  - exact merge now streams compressed postings groups directly and only emits merged postings parquet in explicit debug mode
- [x] Accelerate partitioned token-index merge without semantic drift
  - `merge_postings` progress/ETA now uses actual distinct merged token counts
  - per-shard DuckDB FIFO cursor fanout is replaced with one canonical global dictionary stream
  - primary-path shifted-delta postings merge now runs in the required native kernel
  - shard token dictionaries now carry first/last row metadata needed for future exact-safe splice work
  - index-merge exact equivalence smoke is required before server mining runs
- [x] Harden partitioned token-index merge contracts
  - merge completion now fails fast unless `mergedTokenCount == expectedDistinctTokens`
  - merge completion now fails fast unless `dictionaryCursorRows == expectedDictionaryRefRows`
  - shard token-dictionary schema version/required columns are preflighted before merge
  - canonical global stream now orders by `token, shardIndex`
  - materialized merged-dictionary stats are emitted once together with the canonical merged artifact
  - merge now fails fast on duplicate `(token, shardIndex)` refs inside one token group
  - primary-path postings reads now use bounded concurrency while preserving shard order
  - one-shot wrapper now pins `PREJUMP_INDEX_SCHEMA_PREFLIGHT_REQUIRED=true`
  - one-shot wrapper exposes `PREJUMP_INDEX_MERGE_READ_CONCURRENCY=<n>`
  - canonical merged-dictionary temp artifacts are now emitted as ordered JSONL plus one stats JSON sidecar and consumed directly without a second DuckDB/parquet order pass
- [x] Make feature-store assembly the predictive one-shot default
  - one-shot server wrapper now defaults to `PREJUMP_PACK_SOURCE_MODE=feature_store`
  - feature-store-backed runs now build partitioned shard indexes instead of a single monolithic pack/index pass
- [x] Cache partitioned tokenizer specs per feature-store contract/range/options
  - cache location: `artifacts/feature-store/prejump_v5/.tokenizer-spec-cache/*.json`
  - repeated identical train-range shard builds now reuse the exact tokenizer spec without rescanning the full feature store
  - cache invalidation now includes feature-store partition file state, so overwrite/rebuild paths cannot silently reuse stale tokenizer boundaries
- [x] Update feature-store manifest incrementally on append-only paths
  - append-only updates now reuse previous manifest metadata and only add new partitions/contract keys
  - overwrite/rebuild paths now reuse previous manifest metadata only when rewritten `strategyModes`, `contextSurfaces`, and `numericFeatureKeys` exactly match the existing manifest contract
  - if overwrite changes the contract or carried-forward partitions are missing, the canonical path must still rebuild exact metadata instead of carrying stale manifest state
- [x] Expand predictive heavy-process guard to include feature-store and partitioned-index stages
  - server one-shot wrapper now blocks concurrent feature-store build, partitioned index build/merge, and mining runs
- [x] Preserve server-built predictive feature-store artifacts across later syncs
  - `scripts/sync_to_server.sh` now excludes and non-destructively syncs `artifacts/feature-store/`
- [x] Fail fast on stale recommendation close-return sidecars
  - filtered predictive `apply` now requires sidecar manifest `candlePath` + file fingerprint metadata
  - if `data/candle_daily.jsonl` changes after sidecar generation, filtered predictive `apply` fails fast until `tools/build_recommendation_close_ret_sidecar.mjs --overwrite=true` is rerun
- [x] Stream seed selection directly from `token_stats.parquet`
  - indexed/parallel miners no longer materialize the full token-stats table before seed selection
  - deterministic top-k selection preserves the current precision-ranked `selectSeedEntries()` behavior
- [x] Move recommendation close-return sidecar to date-partitioned layout
  - sidecar root: `artifacts/sidecar/recommendation_close_ret/`
  - per-date partitions: `date=YYYY-MM-DD/*.parquet`
  - filtered predictive `apply` now loads only the requested date partition and fails fast on missing/stale sidecars
  - current contract version is v4 with partition-aware freshness metadata and guarded incremental rebuild semantics
- [x] Precompile OOS/apply rule anchors with token-id buckets
  - external match semantics stay exact
  - candidate-rule lookup no longer depends on string-token bucket maps internally
- [x] Replace worker `partial_rules.json` with binary/parquet partial-rule output
  - worker partial output path: `partial_rules.parquet`
  - parent parallel merge now streams parquet partial rules instead of parsing large JSON payloads
- [x] Add exact feature-values sidecar for tokenizer cold-start
  - per feature-store partition:
    - `feature_values.bin`
    - `feature_values_index.parquet`
  - tokenizer cold-start now exact-merges sorted per-feature value runs instead of `UNNEST(featureValues)` from `feature_stats.parquet`
  - current contract version is v3 with cursor-based merge and bounded file-handle usage

## Current Hardening Bundle

- [x] Binary IO fail-fast hardening
  - `feature_values.bin` and `token_postings.bin` readers must verify `bytesRead`
  - index metadata (`offset`, `byteLength`, `count`) must be checked against actual file size before decode
  - truncated/corrupt binary artifacts must fail fast with file path + offset diagnostics
- [x] Exact quantile sidecar v3
  - add feature-value cursor helper for `feature_values.bin + feature_values_index.parquet`
  - replace full JS-array materialization with exact iterator-based k-way merge
  - bound open file handles with an FD pool / bounded reopen strategy
  - legacy partitions missing v3 sidecars must rebuild or fail fast
- [x] Feature-stats de-dup and old-path removal
  - `feature_stats.parquet` stores only `featureKey`, `count`, `min`, `max`
  - exact numeric values are canonical only in `feature_values.bin + feature_values_index.parquet`
  - predictive tokenizer-spec build must not silently fall back to `UNNEST(featureValues)`
- [x] Dictionary streaming merge
  - shard dictionary merge must stop full-loading all shard entries into JS arrays
  - `token_dictionary.parquet` remains the authoritative output contract for miners
  - merged postings and dictionary equality must remain exact
- [x] Remove feature-store split `ORDER BY` OOM root cause
  - predictive pack parquet is now written with DuckDB `preserveInsertionOrder=true`
  - feature-store split now streams the source pack without DuckDB sort and fail-fast verifies physical `dateKey,rowOrdinal` monotonicity
  - feature-store partitions and feature-store-assembled packs are also written with insertion-order preservation enabled
- [x] Recommendation close-return sidecar v4 contract
  - replace global-fingerprint-only validation with partition-aware freshness metadata
  - safe incremental rebuild is allowed only for append/latest dates or explicit `--rebuild-from=YYYY-MM-DD`
  - previous-close dependency must force dependency-date rebuilds
  - stale/missing dependency partitions must fail fast
- [x] Wrapper / docs / ops updates for the hardening bundle
  - document sidecar v3 rebuild semantics
  - document exact quantile sidecar v3 rebuild requirement
  - expose new progress fields:
    - `quantileMergeMs`
    - `fdPoolPeak`
    - `dictionaryCursorRows`
    - `sidecarPartitionLoads`
- [x] Wrapper / docs / ops updates for index merge acceleration
  - document the `merge_postings` bottleneck and the distinct-token ETA contract
  - document the canonical global-stream dictionary merge contract
  - document required native shifted-delta postings merge on the primary path
  - document that merged-dictionary stats are emitted in the same materialization stage, not by a later shard-union rescan
  - document new index merge progress fields:
    - `distinctTokens`
    - `maxRefsPerToken`
    - `postingBytesRead`
    - `postingBytesWritten`
    - `mergeDecodeMs`
    - `mergeWriteMs`
  - add index-merge equivalence smoke:
    - `node tools/smoke_prejump_index_merge_equivalence.mjs`
- [x] Wrapper / docs / ops updates for exact mining acceleration
  - expose new miner progress fields:
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
  - document exact pruning invariants and forbidden unsafe-prune list
  - add adversarial local smoke:
    - `node tools/smoke_prejump_indexed_acceleration_adversarial.mjs`
  - keep server-only parallel equivalence smoke as post-bootstrap gate
  - exact-safe hardening additions:
    - bitset/bitset sparse intersections must materialize directly without an intermediate dense result buffer
    - parent parallel merge may evict only rules with `trainHitCount < partialMergeKthHitFloor`
    - memo frontier updates must preserve sorted skyline order incrementally and must not full-sort/rebuild fingerprint indexes on every insert
- [x] Add native exact sparse/plain-bitset runtime completion bundle
  - native build/load infra:
    - `scripts/build_native_rowset_kernel.sh`
    - `scripts/verify_native_rowset_kernel.sh`
    - build manifest with source / Node / platform / compiler fingerprints
    - keep one canonical build path only: direct `c++` build via `scripts/build_native_rowset_kernel.sh`
  - native exact rowset kernel:
    - sparse/sparse count/materialize
    - sparse/bitset count/materialize
    - bitset/bitset count/materialize
    - equality
    - subset
  - native delta postings decode:
    - delta buffer -> sparse values
    - delta buffer -> plain bitset words
    - no intermediate decoded-values vector on the bitmap decode path
    - fail fast on malformed varint / universe overflow / count mismatch
  - rowset/runtime contract:
    - keep external rowset shape at `sparse | bitset`
    - keep backend wording aligned with the actual plain-bitset runtime
    - count/materialize mismatch remains fail-fast
  - memo exact equality/subset must route through native ops after cheap precheck
  - wrapper/runtime contract must expose:
    - `PREJUMP_ORDERING_HEAD_WINDOW`
    - `PREJUMP_SEARCH_STATE_CACHE_MAX_BYTES`
    - `PERFECT_PROTO_NATIVE_ROWSET_REQUIRED=true`
    - `PERFECT_PROTO_BITMAP_BACKEND=exact`
  - verification gates:
    - stale native binary must not pass verify
    - local native preflight
    - local native-vs-JS exact equality smoke
    - local `npm run verify`
    - server native build preflight
    - server `npm run verify`
    - server parallel equivalence smoke
- [ ] Add remaining exact acceleration bundle
  - merged dictionary primary path:
    - materialize one canonical merged dictionary artifact once per partition merge
    - read distinct-token / dictionary-ref stats from that artifact instead of rebuilding shard-union SQL
    - stream merge groups from the same artifact and fail fast on non-increasing token order
  - native postings merge primary path:
    - primary `token_postings.bin` merge must use native file-backed shifted-delta merge
    - primary path must not materialize posting buffers into JS before merge
    - debug-only `emitTokenPostingsParquet=true` may retain slower JS decode/read logic
  - mining/runtime hardening:
    - partial-merge tie-band stats must be incremental, not a full scan of all live buckets per insert
    - state-dominance memo frontier must stay ordered by negative-count and stop scanning once the frontier exceeds the candidate count
    - state-dominance memo frontier updates must mutate the ordered skyline incrementally; do not rebuild full frontier arrays or fingerprint maps on every insert
    - partial-merge hit-floor pruning must advance incrementally with hit-count indexes; do not full-scan every signature bucket whenever the hit floor rises
    - negative fingerprint / edge-summary prechecks must run before native subset checks
  - verification gates:
    - local `npm run verify` must cover native file-backed shifted-delta exactness, index-merge equivalence, and indexed adversarial smoke
    - server closure remains:
      - native build/verify
      - `npm run verify`
      - index-only probe rerun
      - parallel equivalence smoke

## Native Integrated Bundle Validation Gates

- local:
  - `bash scripts/build_native_rowset_kernel.sh`
  - `bash scripts/verify_native_rowset_kernel.sh`
  - `node tools/smoke_prejump_indexed_equivalence.mjs`
  - `node tools/smoke_prejump_indexed_acceleration_adversarial.mjs`
  - `node tools/smoke_prejump_index_merge_equivalence.mjs`
  - `npm run verify`
- server, only after any active shared index/bootstrap run completes:
  - `bash scripts/build_native_rowset_kernel.sh`
  - `bash scripts/verify_native_rowset_kernel.sh`
  - `npm run verify`
  - `node tools/smoke_prejump_parallel_indexed_equivalence.mjs`

## Native Bundle Runtime Notes

- predictive indexed mining must not silently switch between JS/native engines
- native rowset kernel and native delta decode must stay deterministic across local and server builds
- `npm run verify` is incomplete unless it runs the native exactness smokes; export-only native checks are insufficient
- `observedRuleCount`, `liveCanonicalRuleCount`, and `finalSelectedRuleCount` remain the only stable diagnostics contract for partial merge summaries
- ordering head rerank remains ordering-only even after native rowset integration
    - partial merge hit-floor eviction must not change observed canonical rule count reporting
    - `collectedRuleCount` is deprecated as a diagnostic field; indexed/parallel summaries must expose:
      - `observedRuleCount`
      - `liveCanonicalRuleCount`
      - `finalSelectedRuleCount`
    - head rerank is ordering-only and may only exact-rerank a bounded head window
    - tie-band instrumentation must treat `trainHitCount === partialMergeKthHitFloor` as non-evictable

## Frozen Catalog Contract

- [x] Add frozen predictive catalog hashing contract
  - `catalogContractVersion`
  - `catalogContentSha256`
  - `rulesSha256`
  - `ruleIdsSha256`
  - `sourceCatalogSha256`
  - `sourceRunId`
  - `frozenAt`
- [x] Emit predictive frozen catalog manifest alongside curated catalog output
  - `catalogPath`
  - `catalogContentSha256`
  - `rulesSha256`
  - `ruleIdsSha256`
  - `sourceCatalogPath`
  - `sourceCatalogSha256`
  - `sourceRunId`
  - `trainRange`
  - `surface`
  - `maxRuleSize`
  - `maxSeedTokens`
  - `maxRules`
  - `maxSearchStates`
- [x] Make frozen catalog output immutable by default
  - predictive root: `artifacts/curated/prejump_frozen/<train_run_id>/<selection_id>/catalog.json`
  - generic root: `artifacts/curated/frozen/<train_run_id>/<selection_id>/catalog.json`
  - shared mutable catalog paths require explicit opt-in
  - frozen builder is now no-clobber:
    - identical rebuild -> reuse existing frozen artifact without rewriting
    - different content at the same path -> fail-fast
- [x] Canonicalize catalog load before every consumer path
  - re-rank `rules` by canonical comparator on load
  - verify `champion` is consistent with canonical ranked rules
  - verify stored metadata hashes against actual catalog contents
- [x] Require consumer-side frozen catalog verification
  - `apply_perfect_prototypes.mjs`
  - `report_perfect_prototypes_oos.mjs`
  - `step_d_online_loop.mjs`
  - expected catalog hash + expected rule-id hash are now mandatory for OOS/apply/live
  - live wrappers must receive externally supplied expected hashes
    - do not auto-anchor from the sibling manifest at runtime
- [x] Keep curated rebuild as a freeze/packaging tool only
  - selected `ruleId` set must be explicit
  - source catalog itself must already be frozen
  - no hidden re-selection or live mutable overwrite by default
- [x] Add frozen catalog integrity smoke coverage
  - same source catalog -> same hash
  - reordered rule array -> same canonical behavior
  - content/hash mismatch -> fail-fast
  - wrong expected hash -> fail-fast

## Primary Commands

Build predictive feature store:

```bash
node tools/build_perfect_prototype_prejump_feature_store.mjs \
  --config=config/lab.config.server.lite.prejump.json \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --feature-store-dir=artifacts/feature-store/prejump_v5
```

Rebuild recommendation close-return sidecar after any candle source update/reload:

```bash
node tools/build_recommendation_close_ret_sidecar.mjs \
  --candle-path=data/candle_daily.jsonl \
  --overwrite=true
```

Rebuild legacy feature-store partitions so they also contain `feature_stats.parquet`, `feature_values.bin`, and `feature_values_index.parquet`:

```bash
node tools/build_perfect_prototype_prejump_feature_store.mjs \
  --config=config/lab.config.server.lite.prejump.json \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --feature-store-dir=artifacts/feature-store/prejump_v5 \
  --overwrite-existing=true
```

Build predictive pack from feature store explicitly:

```bash
node tools/build_perfect_prototype_prejump_pack.mjs \
  --config=config/lab.config.server.lite.prejump.json \
  --out-run-id=perfect_proto_prejump_train_pack_<STAMP> \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --source-mode=feature_store \
  --feature-store-dir=artifacts/feature-store/prejump_v5
```

Build partitioned predictive token index directly from the feature store:

```bash
node tools/build_perfect_prototype_partitioned_token_index.mjs \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --feature-store-dir=artifacts/feature-store/prejump_v5 \
  --workspace-dir=artifacts/runs/perfect_proto_prejump_train_workspace_<STAMP> \
  --out-dir=artifacts/runs/perfect_proto_prejump_train_index_<STAMP>/step-perfect-prototype-index
```

Run indexed mining:

```bash
node tools/mine_perfect_prototypes_indexed.mjs \
  --index-dir=artifacts/runs/perfect_proto_prejump_train_index_<STAMP>/step-perfect-prototype-index \
  --out-dir=artifacts/runs/perfect_proto_prejump_train_mine_<STAMP>/step-perfect-prototype
```

Run deterministic parallel indexed mining:

```bash
node tools/mine_perfect_prototypes_parallel_indexed.mjs \
  --index-dir=artifacts/runs/perfect_proto_prejump_train_index_<STAMP>/step-perfect-prototype-index \
  --out-dir=artifacts/runs/perfect_proto_prejump_train_mine_<STAMP>/step-perfect-prototype \
  --workers=2
```

Parallel exact mining is only valid when the aggregate explored-state count stays within the configured global `maxSearchStates` budget.
If that global cap would bind, the parallel miner now fails fast instead of returning a semantically drifted result.

One-shot server execution:

```bash
tools/run_prejump_predictive_indexed_mining.sh \
  --start=2020-11-27 \
  --end=2024-12-31 \
  --run-prefix=perfect_proto_prejump_train_v5
```

This one-shot wrapper performs `feature_store -> partitioned index merge -> mining` on the predictive primary path. It does not run OOS or curated catalog rebuild.
It now applies a worker-aware memory preflight before starting predictive parallel mining.
Do not sync local code to the shared server checkout while the historical feature-store bootstrap is still running there. Finish the bootstrap first, then sync and run server verification.
It now defaults to feature-store-backed predictive mining. The primary path is:

```bash
PREJUMP_FEATURE_STORE_DIR=/home/moltook/apps/stockdesk-lab-lite/artifacts/feature-store/prejump_v5 \
tools/run_prejump_predictive_indexed_mining.sh --start=... --end=... --run-prefix=...
```

To prebuild/update the feature store explicitly before assembly:

```bash
PREJUMP_BUILD_FEATURE_STORE=true \
PREJUMP_PACK_SOURCE_MODE=feature_store \
tools/run_prejump_predictive_indexed_mining.sh --start=... --end=... --run-prefix=...
```

To keep debug postings parquet artifacts on disk explicitly:

```bash
PREJUMP_EMIT_TOKEN_POSTINGS_PARQUET=true \
tools/run_prejump_predictive_indexed_mining.sh --start=... --end=... --run-prefix=...
```

Build the exact recommendation-date close-return sidecar used by predictive `apply --exclude-recommendation-close-ret-pct-gte=28`:

```bash
node tools/build_recommendation_close_ret_sidecar.mjs \
  --candle-path=data/candle_daily.jsonl \
  --overwrite=true
```

Explicit OOS step:

```bash
node tools/report_perfect_prototypes_oos.mjs \
  --input=artifacts/runs/perfect_proto_prejump_oos_pack_<STAMP>/step-perfect-prototype-prejump/prejump_pack.parquet \
  --catalog=artifacts/runs/perfect_proto_prejump_train_v5/step-perfect-prototype/catalog.json \
  --out-dir=artifacts/runs/perfect_proto_prejump_oos_eval_<STAMP>/step-perfect-prototype-oos \
  --start=2025-01-01 \
  --end=2026-02-19
```

Explicit curated rebuild step:

```bash
tools/rebuild_prejump_curated_perfect_prototype_catalog.sh \
  --source-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/<predictive_run>/step-perfect-prototype/catalog.json
```

The indexed wrapper now fails fast on invalid dates and on non-empty output directories so reruns do not silently overwrite artifacts.
The legacy JSONL miner intentionally rejects predictive `v5_prejump_contextual` inputs. Predictive mining must use the indexed path above.
The indexed miner now avoids keeping the full `datasetRows` object array alive during search and final coverage emit; compact row-meta arrays remain primary.
The indexed miner now loads exact compressed postings from `token_postings.bin` / `token_dictionary.parquet`, using lazy seed-postings cache instead of eager loading all selected seeds.
The one-shot server wrapper now fails fast if another predictive mining run is already active or if available memory/disk are below the required floor.
The predictive pack builder now prunes inactive symbols/universe keys after candidate indexing and releases each symbol series/cache immediately after its last seed is emitted.
DuckDB parquet sink now uses a spill-enabled temp DB/session `temp_directory`; large predictive pack runs must validate that `prejump_pack.parquet` exists, not just `summary.json`.
Predictive token index now emits exact compressed postings artifacts: `token_postings.bin`, `token_dictionary.parquet`, and a small `token_dictionary.json` summary.
Predictive one-shot mining now uses the deterministic parallel indexed miner as the primary traversal path.
Predictive `apply` now uses exact anchor-token candidate rule precompile and can enforce the `+28%` recommendation-date close-return exclusion in a single predictive pass with `recommendation_close_ret` sidecar parquet lookups.
Primary-path stale temp cleanup:

```bash
find artifacts/runs \( -name '.tmp_token_postings.parquet' -o -name '.tmp_feature_store_batch_*.jsonl' -o -name '.tmp_pack_batch_*.jsonl' \) -type f -delete
```

## Verification Checklist

- [x] `npm run verify` passes on server
- [x] small predictive pack smoke build completes on server and emits `progress.json`
- [x] legacy JSONL miner and indexed miner produce the same:
  - tokenizer spec
  - rule count
  - champion rule
  - rule id set
  - matches
  - coverage
- [x] indexed miner and deterministic parallel indexed miner produce the same:
  - champion rule
  - rule id set
  - matches
  - deduped matches
  - coverage
- [x] predictive OOS fails fast on truncated pack coverage
- [x] predictive live apply reads `prejump_pack.parquet`
- [x] long-running jobs emit `progress.json`
- [x] DuckDB parquet row streaming waits for full row consumption before the caller proceeds

## Remaining Operational Step

The indexed predictive path is implemented, but it still needs:

- a fresh predictive pack rebuild
- predictive re-mining
- OOS / forward validation
- curated predictive catalog rebuild

Only after those are completed should the new predictive live catalog be treated as current production research output.
