# 데이터 계약(JSONL)

## candle_daily.jsonl
- `symbol`, `dateKey`, `open`, `high`, `low`, `close`, `volume`

## universe_daily.jsonl
- `symbol`, `tradingDateKey`, `avgTradingValue20d`, `marketCapKrw`

## symbol_master.jsonl
- `symbol`, `name`, `type`, `isListed`

## candle_hourly60m.jsonl
- `symbol`, `tradingDateKey`, `tsKst`, `volume`

## news_item.jsonl
- 현재 기본 파이프라인에서는 미사용

## intraday_side/*.jsonl
- 현재 Kiwoom side-daily 1차 canonical 계약:
  - `data/intraday_side/investor_daily.jsonl`
  - `data/intraday_side/program_daily.jsonl`
  - `data/intraday_side/trade_strength_daily.jsonl`
- 공통 row:
  - `dataset`, `apiId`, `source`, `symbol`, `dateKey`, `rawRow`
- `rawRow`는 Kiwoom 원응답 필드를 그대로 보존

## intraday_1m/date=YYYY-MM-DD/part-000.jsonl
- 현재 Kiwoom 1분봉 1차 canonical 계약:
  - `data/intraday_1m/date=YYYY-MM-DD/part-000.jsonl`
- row:
  - `symbol`, `tradingDateKey`, `tsKst`, `open`, `high`, `low`, `close`, `volume`, `valueKrw`, `source`, `apiId`
- 현재 1차 구현은 `.jsonl` 파티션을 사용
- `valueKrw`는 원응답 필드가 있으면 그 값을 쓰고, 없으면 `close * volume` 근사치를 기록

## intraday_1m_presence_daily.jsonl
- row:
  - `symbol`, `tradingDateKey`, `barCount`, `firstTsKst`, `lastTsKst`, `status`, `source`

## artifacts/tp12_intraday/features/run=.../feature_rows.jsonl
- row:
  - `kind`, `requestId`, `symbol`, `decisionDateKey`, `prevDateKey`, `asOfDateKey`, `stepALaneId`, `runId`, `eventLabel`
  - `windowDateKeys`, `gateId`, `featureCutoffDateKey`, `featureCutoffTsKst`
  - `entryPriceMode`, `entryDateKey`, `entryTsKst`, `entryPrice`
  - `features`
  - `labels`
- current `v1` feature families:
  - `dminus1_*` minute path
  - `d0_*` minute path
  - `d1_*` cutoff path
  - `investor_*`, `program_*`, `trade_strength_*` daily deltas
- current `v1` labels:
  - `tp12Hit`, `sl4Hit`, `firstBarrierOutcome`
  - `minutesToTp12`, `minutesToSl4`
  - `day1MFE`, `day1MAE`
  - `stop_first_net_ret`, `delay1_4d_net_ret`, `touch_anchor_net_ret`
  - `bestPolicyChoice`, `bestPolicyNetRet`

## artifacts/tp12_intraday/bridged_feature_pack/run=.../decision_candidates_feature_pack_intraday_<gateId>.jsonl
- source:
  - existing Step-D `decision_candidates_feature_pack.jsonl`
  - gate-specific derived feature rows from `artifacts/tp12_intraday/features/run=.../feature_rows.jsonl`
- join contract:
  - join key is `(symbol, decisionDateKey)`
  - full coverage is mandatory
  - unmatched Step-D rows or unmatched derived rows are fatal
- row:
  - base Step-D feature pack row
  - `featureVec` augmented only with `intraday.*` numeric features
  - `contextualTokens` must include `tag:intradayGate:<gateId>`
  - `intradayBridge` metadata:
    - `kind`, `gateId`, `requestId`, `featureCutoffDateKey`, `featureCutoffTsKst`, `featureCount`, `entryPriceMode`
- forbidden:
  - copying `labels` from the derived feature dataset into the bridged feature pack

## artifacts/tp12_intraday/pipeline/run=.../pipeline_summary.json
- source:
  - `tools/run_kiwoom_tp12_pipeline.sh`
- row/object:
  - `kind`, `runId`
  - `manifestPath`
  - `featurePackPath`
  - `intradayFeaturePath`
  - `bridgeOutDir`
  - `dataDir`
  - `decisionFrom`, `decisionTo`
  - `gateIds`
  - `bridgedOutputs`
- intent:
  - persist the exact manifest / feature / bridged-pack paths emitted by the strict end-to-end Kiwoom TP12 pipeline
  - when explicit narrowing is used, `allowlistPath` must be recorded here as the canonical provenance pointer

## artifacts/tp12_side_daily/features/run=.../feature_rows.jsonl
- row:
  - `kind`, `requestId`, `symbol`, `decisionDateKey`, `prevDateKey`, `asOfDateKey`, `stepALaneId`, `runId`, `eventLabel`
  - `windowDateKeys`, `gateId`, `featureCutoffDateKey`, `entryPriceMode`
  - `supportedDatasetIds`
  - `features`
  - `labels`
- current `v1` feature families:
  - `investor_*`
  - `program_*`
  - optional `trade_strength_*`
  - cross-family alignment / pressure features such as:
    - `side_alignment_investor_program_*`
    - `side_pressure_investor_program_*`
    - `side_alignment_strength_*`
- current `v1` labels:
  - `tp12_no_stop_hit_3d`
  - `tp12_no_stop_hit_4d`
  - companion fields:
    - `tp12_no_stop_hit_<Nd>_first_hit_date`
    - `tp12_no_stop_hit_<Nd>_entry_date`
    - `tp12_no_stop_hit_<Nd>_entry_price`
    - `tp12_no_stop_hit_<Nd>_max_high_ret`
    - `tp12_no_stop_hit_<Nd>_min_low_ret`
    - `tp12_no_stop_hit_<Nd>_terminal_ret`
- hard-stop:
  - this dataset is signal-stage only
  - execution/stop-policy labels must not be mixed into this artifact

## artifacts/tp12_side_daily/bridged_feature_pack/run=.../decision_candidates_feature_pack_side_<gateId>.jsonl
- source:
  - existing Step-D `decision_candidates_feature_pack.jsonl`
  - gate-specific derived rows from `artifacts/tp12_side_daily/features/run=.../feature_rows.jsonl`
- join contract:
  - join key is `(symbol, decisionDateKey)`
  - full coverage is mandatory
  - duplicate feature-pack join pairs are fatal
  - unmatched Step-D rows or unmatched derived rows are fatal
- row:
  - base Step-D feature pack row
  - `featureVec` augmented only with `side.*` numeric features
  - `contextualTokens` must include `tag:sideDailyGate:<gateId>`
  - `sideDailyBridge` metadata:
    - `kind`, `gateId`, `requestId`, `featureCutoffDateKey`, `featureCount`, `entryPriceMode`, `supportedDatasetIds`
- forbidden:
  - copying `labels` from the derived side-daily feature dataset into the bridged feature pack

## artifacts/tp12_side_daily/control/run=.../decision_candidates_feature_pack_control.jsonl
- source:
  - existing Step-D `decision_candidates_feature_pack.jsonl`
  - exact pair-unique manifest slice
- join contract:
  - join key is `(symbol, decisionDateKey)`
  - manifest slice must be pair-unique
  - full feature-pack coverage for all manifest pairs is mandatory
  - duplicate feature-pack join pairs are fatal
- row:
  - base Step-D feature pack row
  - `contextualTokens` must include:
    - `tag:sideDailyControl.kind:tp12_side_daily_control_feature_pack_v1`
    - `tag:sideDailyControlId:daily_only_no_stop`
  - `sideDailyControl` metadata:
    - `kind`, `controlId`, `requestId`, `stepALaneId`, `prevDateKey`, `featureCutoffDateKey`, `labelContractKind`, `targetLabelIds`
- forbidden:
  - copying target labels into the control feature pack rows

## artifacts/tp12_side_daily/control/run=.../no_stop_label_rows.jsonl
- source:
  - exact manifest slice
  - `data/candle_daily.jsonl`
  - `tp12_no_stop_target_contract_v1`
- row:
  - `kind = tp12_side_daily_control_label_dataset_v1`
  - `controlId`
  - `requestId`, `symbol`, `decisionDateKey`, `prevDateKey`, `asOfDateKey`
  - `stepALaneId`, `runId`, `eventLabel`
  - `splitBucket`
  - `targetLabelIds`
  - `labels`
  - `labelContractKind`
  - `windowDateKeys`
- intent:
  - freeze the exact no-stop target labels for the daily-only control slice before any side-daily additive test

## artifacts/tp12_side_daily/control/run=.../control_summary.json
- source:
  - `tools/run_tp12_side_daily_control.sh`
- row/object:
  - `kind`, `controlId`
  - `manifestPath`, `featurePackPath`, `candlePath`
  - `outPath`, `labelOutPath`
  - `rowCount`, `trainRowCount`, `oosRowCount`
  - `decisionDateFrom`, `decisionDateTo`
  - frozen `split`
  - `stepALaneSet`
  - `targetLabelIds`
  - `allowlistPolicy`
  - `commonSupportPolicy`
  - optional `researchContract` metadata:
    - `kind`, `contractId`, `scopeId`, `contractPath`
  - `pairSignatureSha256`
  - fingerprints for manifest / feature-pack / candle / outputs
- intent:
  - persist the scientific comparison contract for the first daily-only no-stop control

## artifacts/tp12_side_daily/scientific_control/run=.../pipeline_summary.json
- source:
  - `tools/run_tp12_side_daily_scientific_control_pipeline.sh`
- row/object:
  - `kind = tp12_side_daily_scientific_control_pipeline_v1`
  - `status = artifact_ready`
  - `runId`
  - contract metadata:
    - `contractId`, `contractPath`
  - frozen `decisionWindow`
  - frozen `split`
  - `allowedLanes`
  - `defaultGateId`
  - upstream paths:
    - `downstreamRunDir`
    - `trainRunDir`
    - `oosRunDir`
    - `featurePackPath`
    - `allowlistPath`
    - `manifestPath`
    - `manifestSummaryPath`
  - `variants[]`:
    - `variantId`
    - `kind`
    - `gateId`
    - `datasetIds`
    - optional `sideFeaturePath`, `sideFeatureSummaryPath`
    - optional `bridgedFeaturePackPath`
    - `controlPackPath`
    - `controlLabelPath`
    - `controlSummaryPath`
- intent:
  - freeze one exact machine-readable bundle for the first scientific `daily-only / +investor / +program / +investor+program` comparison
  - keep scoring separate from input freezing

## artifacts/tp12_side_daily/scientific_control/run=.../selection_manifest.json
- source:
  - `tools/run_tp12_side_daily_scientific_selection_manifest.sh`
- row/object:
  - `kind = tp12_side_daily_scientific_selection_manifest_v1`
  - `pipelineSummaryPath`
  - `variants[]`:
    - `variantId`
    - `selectionPath`
    - optional `selectionSummaryPath`
- intent:
  - bind each frozen scientific-control variant to one exact selected-row artifact before scoring

## artifacts/tp12_side_daily/scientific_control/run=.../scientific_comparison_report.json
- source:
  - `tools/run_tp12_side_daily_scientific_comparison_report.sh`
- row/object:
  - `kind = tp12_side_daily_scientific_comparison_report_v1`
  - `pipelineSummaryPath`
  - `selectionManifestPath`
  - `baselineVariantId = daily_only_no_stop`
  - contract metadata:
    - `contractId`, `contractPath`, `commonSupportPolicy`
  - frozen `decisionWindow`
  - frozen `split`
  - `variants[]`:
    - `variantId`
    - `kind`
    - `gateId`
    - `datasetIds`
    - label / selection fingerprints
    - `deployment.train|oos`
    - optional `deploymentDeltaVsBaseline.train|oos`
    - optional `commonSupportVsBaseline.train|oos`
- intent:
  - compare daily-only vs side-daily variants using:
    - deployment view = actual reachable selected rows
    - common-support view = same candidate/date support intersection against the frozen baseline

## artifacts/tp12_side_daily/execution_learning/run=.../donor_rows.jsonl
- source:
  - `tools/run_tp12_side_daily_execution_learning_bundle.sh`
- row:
  - `kind = tp12_side_daily_execution_donor_row_v1`
  - `rowKey`
  - `baselineVariantId = daily_only_no_stop`
  - `symbol`, `decisionDateKey`, `monthKey`
  - frozen scientific provenance:
    - `requestId`, `prevDateKey`, `asOfDateKey`, `stepALaneId`, `runId`, `eventLabel`, `windowDateKeys`
  - `scientificSplitBucket = train|oos`
  - `learningSplitBucket = train|validation|recent_replay`
  - `decisionIdx`
  - `targetLabelIds`
  - `noStopLabels`
  - `featureVec`
  - `contextualTokens`
  - `sideDailyControl`
  - `baseMeta`
- intent:
  - freeze the exact baseline-selected donor cohort for downstream execution-policy learning
  - keep the donor cohort tied to the scientific baseline instead of recomputing selected rows later

## artifacts/tp12_side_daily/execution_learning/run=.../execution_label_rows.jsonl
- source:
  - `tools/run_tp12_side_daily_execution_learning_bundle.sh`
- row:
  - `kind = tp12_side_daily_execution_label_row_v1`
  - `rowKey`
  - `baselineVariantId = daily_only_no_stop`
  - `symbol`, `decisionDateKey`
  - `scientificSplitBucket = train|oos`
  - `learningSplitBucket = train|validation|recent_replay`
  - `barrierOutcomeLabel = tp12_first|sl4_first|no_barrier_hit`
  - `labels`:
    - `tp12_first`
    - `sl4_first`
    - `no_barrier_hit`
    - `stop_first_net_ret`
    - `delay1_4d_net_ret`
    - `bestPolicyChoice`
    - `bestPolicyNetRet`
    - `abstain_best_choice`
    - `bestExecutionPolicyId`
    - `bestExecutionPolicyNetRet`
    - `bestHoldDays`
    - `bestStopLossPct`
    - `bestStopActivationDelayBars`
    - `bestSameBarTiePolicy`
    - `bestEntryMode`
  - `policyOutcomes`:
    - one exact simulated outcome per fixed execution policy id plus `abstain`
- intent:
  - define downstream-only execution labels on the frozen donor cohort
  - keep signal-stage no-stop labels and downstream execution labels in separate artifacts

## artifacts/tp12_side_daily/execution_learning/run=.../execution_learning_summary.json
- source:
  - `tools/run_tp12_side_daily_execution_learning_bundle.sh`
- row/object:
  - `kind = tp12_side_daily_execution_learning_bundle_v1`
  - `pipelineSummaryPath`
  - `selectionManifestPath`
  - `baselineVariantId`
  - frozen `decisionWindow`
  - frozen `split`
  - `recentReplayDecisionCount`
  - `replaySplit`
  - `labelSchema`
  - `donorRows`
  - `executionLabels`
  - `provenance`
- intent:
  - persist one deterministic downstream-learning contract:
    - exact donor rows
    - exact execution labels
    - exact train / validation / recent replay split

## artifacts/runs/<run-id>/step-perfect-prototype-open-control-input-pack/daily_pack.jsonl
- source:
  - `tools/run_tp12_side_daily_control_inputs.sh`
  - fresh train/oos open daily packs
- intent:
  - freeze one exact base input pack for the first `2016`-floor `daily-only no-stop` control rerun
- row:
  - same row contract as open daily-pack rows:
    - `symbol`
    - `decisionDateKey`
    - `featureVec`
    - `contextualTokens`
- hard contract:
  - duplicate `(symbol, decisionDateKey)` pairs across train/oos are fatal
  - train coverage must end before oos coverage begins
  - both train and oos must contribute at least one row

## artifacts/runs/<run-id>/step-perfect-prototype-open-control-input-pack/control_input_summary.json
- source:
  - `tools/build_tp12_side_daily_control_input_pack.mjs`
  - `tools/run_tp12_side_daily_control_inputs.sh`
- row/object:
  - `kind = tp12_side_daily_control_input_pack_v1`
  - `trainPackPath`
  - `oosPackPath`
  - `outPath`
  - `rowCount`
  - `trainRowCount`
  - `oosRowCount`
  - `decisionDateFrom`
  - `decisionDateTo`
  - `sourceTypes`
  - `baselineLineIds`
  - `discoveryUniverseIds`
  - `coverage.train`
  - `coverage.oos`
- hard contract:
  - if `decisionDateFrom` is later than the frozen research `trainDateFrom`, the server wrapper must fail-fast

## artifacts/runs/<run-id>/step-perfect-prototype-open-full-period-pack/daily_pack.jsonl
- source:
  - `tools/build_tp12_side_daily_downstream_full_period_pack.mjs`
  - `tools/run_tp12_side_daily_downstream_full_period_pack.sh`
- intent:
  - merge downstream train/oos open packs into one exact full-period pack before building a narrowed `LOW_GAP_TOP` allowlist
- row:
  - same row contract as open daily-pack rows:
    - `symbol`
    - `decisionDateKey`
    - `featureVec`
    - optional `stepALaneId`
- hard contract:
  - duplicate `(symbol, decisionDateKey)` pairs across train/oos are fatal
  - train coverage must end before oos coverage begins
  - both train and oos must contribute at least one row

## artifacts/runs/<run-id>/step-perfect-prototype-open-full-period-pack/downstream_full_period_pack_summary.json
- source:
  - `tools/build_tp12_side_daily_downstream_full_period_pack.mjs`
  - `tools/run_tp12_side_daily_downstream_full_period_pack.sh`
- row/object:
  - `kind = tp12_side_daily_downstream_full_period_pack_v1`
  - `trainPackPath`
  - `oosPackPath`
  - `outPath`
  - `rowCount`
  - `trainRowCount`
  - `oosRowCount`
  - `decisionDateFrom`
  - `decisionDateTo`
  - `sourceTypes`
  - `baselineLineIds`
  - `discoveryUniverseIds`
  - `stepALaneIds`
  - `coverage.train`
  - `coverage.oos`
- hard contract:
  - this artifact is the exact input to the narrowed full-period allowlist build
  - if `decisionDateFrom` is later than the frozen research `trainDateFrom`, downstream allowlist generation must fail-fast

## meta/tp12_side_daily_research_contract.json
- frozen machine-readable contract for the first `2016`-floor side-daily scientific reruns
- required fields:
  - `kind = "tp12_side_daily_research_contract_v1"`
  - `contractId`
  - `scopeId`
  - `updatedAt`
  - `decisionWindow.from`, `decisionWindow.to`
  - `control.trainDateFrom`, `control.trainDateTo`
  - `control.oosDateFrom`, `control.oosDateTo`
  - `control.stepALaneSet`
  - `control.targetLabelIds`
  - `control.allowlistPolicy`
  - `control.commonSupportPolicy`
  - `comparisonOrder`
- current frozen baseline:
  - `scopeId = LOW_GAP_TOP`
  - `decisionWindow = 2016-08-12 ~ 2026-03-30`
  - `train = 2016-08-12 ~ 2024-12-31`
  - `oos = 2025-01-02 ~ 2026-03-30`

## meta/tp12_no_stop_rolling_research_contract.json
- frozen machine-readable contract for the sibling `12% no-stop rolling selection` branch
- required fields:
  - `kind = "tp12_no_stop_rolling_research_contract_v1"`
  - `contractId`
  - `scopeId = LOW_GAP_TOP`
  - `updatedAt`
  - `decisionWindow.from`, `decisionWindow.to`
  - `inputContract.discoveryUniverseId`
  - `inputContract.requestedLookbackTradingDays`
  - `inputContract.stepALaneSet`
  - `inputContract.allowlistPolicy`
  - `inputContract.commonSupportPolicy`
  - `labelContract.targetPct = 0.12`
  - `labelContract.stopLossPct = 0`
  - `labelContract.primaryLabelId = tp12_no_stop_hit_3d`
  - `labelContract.secondaryLabelIds`
  - `searchContract.configPath`
  - `searchContract.lineId = stepb_dplus1_plus_lite_target12_no_stop`
  - `searchContract.screenMaxSearchStates = 200000`
  - `searchContract.finalMaxSearchStates = 20000000`
  - `windows[]` with exactly one `final_confirm`
- hard contract:
  - this branch must not overwrite the frozen `tp12_side_daily/scientific_control` root
  - `HIGH8` / `close28` must not be used as the primary promotion metric here

## meta/tp12_no_stop_lookback_ladder_contract.json
- frozen machine-readable contract for the deferred `LOW_GAP_TOP` lookback ladder scaffold
- required fields:
  - `kind = "tp12_no_stop_lookback_ladder_contract_v1"`
  - `contractId`
  - `scopeId = LOW_GAP_TOP`
  - `updatedAt`
  - `baseRollingContractPath = meta/tp12_no_stop_rolling_research_contract.json`
  - `candidateSelection.sparseCandidateIds`
  - `candidateSelection.denseFillCandidateIds`
  - `lookbackCandidates[]` with:
    - `candidateId`
    - `stage = sparse|dense_fill`
    - `lookbackTradingDays`
- hard contract:
  - discovery universe must derive from `lookbackTradingDays` as `recent_impulse_upto_<Nd>`
  - `stepALaneSet` must expand to `recent_impulse_1d..recent_impulse_<Nd>d`
  - the ladder must not be opened before the base `recent_impulse_1d` rolling branch is judged

## artifacts/runs/<run-id>/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_manifest.json
- source:
  - `tools/run_stepb_1d_tp12_no_stop_low_gap_top_rolling.sh`
- row/object:
  - `kind = tp12_no_stop_rolling_manifest_v1`
  - `generatedAt`
  - `runId`
  - `windowGroup`
  - `contractPath`
  - `requestedWindowIds[]`
  - `windows[]`:
    - `windowId`
    - `sourceRunId`
    - `scopeRunId`
    - `summaryPath`
- hard contract:
  - `requestedWindowIds` must exactly match the window summaries carried in `windows[]`
  - duplicate `windowId` values are fatal

## artifacts/runs/<run-id>/step-perfect-prototype-1d-tp12-no-stop-rolling/windows/<window-id>/window_summary.json
- source:
  - `tools/build_stepb_1d_tp12_no_stop_window_report.mjs`
- row/object:
  - `kind = tp12_no_stop_window_report_v1`
  - `contractId`, `contractPath`, `scopeId`
  - `windowId`
  - `kindWindow`
  - `sourceRunId`, `scopeRunId`
  - `trainDateFrom`, `trainDateTo`
  - `oosDateFrom`, `oosDateTo`
  - `targetLabelIds`
  - `source.controlInputSummary*`
  - `search.lineId`
  - `search.selectionMode`
  - `search.trainBreadthQualifiedRuleCount`
  - `search.trainPromotableBreadthRuleCount`
  - `search.zeroNegativeRuleCount`
  - `search.oosPerfectDateFloor3RuleCount`
  - `train.metricsByLabel`
  - `oos.metricsByLabel`
  - `status`
  - `verdict`
- companion outputs:
  - `train_selected_rows.jsonl`
  - `oos_selected_rows.jsonl`
  - `window_verdict.json`
  - `report.md`
- hard contract:
  - when `status != no_rules`, missing selected-row files are fatal
  - each selected row must have exact `(symbol, decisionDateKey)` candle coverage through `D+4`

## artifacts/runs/<run-id>/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_summary.json
- source:
  - `tools/run_tp12_no_stop_rolling_summary.sh`
  - `tools/build_tp12_no_stop_rolling_summary.mjs`
- row/object:
  - `kind = tp12_no_stop_rolling_summary_v1`
  - `contractId`
  - `contractPath`
  - `manifestPath`
  - `runId`
  - `windowGroup`
  - `primaryLabelId`
  - optional `secondaryLabelId`
  - `screen.primary`
  - optional `screen.secondary`
  - `screen.enoughUsableScreenWindows`
  - `screen.earlyStopTriggered`
  - optional `finalConfirm`
  - `windows[]`
- companion outputs:
  - `rolling_report.md`
  - `rolling_screen_primary.json`
  - `rolling_final_confirm.json`
- hard contract:
  - manifest windows must exactly match the requested contract windows
  - summary generation must fail if any expected window summary is missing

## artifacts/runs/<run-id>/step-perfect-prototype-tp12-no-stop-lookback-ladder/lookback_ladder_manifest.json
- source:
  - `tools/run_stepb_tp12_no_stop_lookback_ladder.sh`
- row/object:
  - `kind = tp12_no_stop_lookback_ladder_manifest_v1`
  - `generatedAt`
  - `runId`
  - `candidateGroup`
  - `windowGroup`
  - `contractPath`
  - `requestedCandidateIds[]`
  - `requestedWindowIds[]`
  - `candidates[]`:
    - `candidateId`
    - `candidateRunId`
    - `candidateContractPath`
    - `rollingSummaryPath`
    - `rollingReportPath`
- hard contract:
  - manifest candidates must exactly match the selected ladder candidates
  - each candidate entry must point to one derived rolling summary

## artifacts/runs/<run-id>/step-perfect-prototype-tp12-no-stop-lookback-ladder/lookback_ladder_summary.json
- source:
  - `tools/run_tp12_no_stop_lookback_ladder_summary.sh`
  - `tools/build_tp12_no_stop_lookback_ladder_summary.mjs`
- row/object:
  - `kind = tp12_no_stop_lookback_ladder_summary_v1`
  - `contractId`
  - `contractPath`
  - `manifestPath`
  - `runId`
  - `candidateGroup`
  - `windowGroup`
  - `candidateCount`
  - `sparseCandidateCount`
  - `denseFillCandidateCount`
  - optional `bestCandidateId`
  - `candidates[]`:
    - `candidateId`
    - `candidateStage`
    - `lookbackTradingDays`
    - `discoveryUniverseId`
    - `stepALaneSet`
    - `candidateRunId`
    - `candidateContractPath`
    - `rollingSummaryPath`
    - `rollingReportPath`
    - `screen.primary`
    - optional `finalConfirm`
- companion outputs:
  - `lookback_ladder_report.md`
  - `lookback_ladder_ranking.json`
- hard contract:
  - ranking must fail if manifest candidates diverge from the requested contract candidates
  - every candidate row must load from an existing rolling summary

## artifacts/tp12_side_daily/pipeline/run=.../pipeline_summary.json
- source:
  - `tools/run_kiwoom_tp12_side_daily_pipeline.sh`
- row/object:
  - `kind`, `runId`
  - `manifestPath`
  - `featurePackPath`
  - `sideFeaturePath`
  - `sideFeatureSummaryPath`
  - `bridgeOutDir`
  - `candlePath`
  - `datasetIds`
  - `gateIds`
  - `decisionFrom`, `decisionTo`
  - `bridgedOutputs`
- intent:
  - persist the exact derived-feature and bridged-pack paths emitted by the strict daily + side-daily TP12 pipeline

## artifacts/tp12_intraday/allowlist/run=.../rows.jsonl
- source:
  - downstream `daily_pack.jsonl` such as `step-perfect-prototype-open-oos-pack/daily_pack.jsonl`
- row:
  - `allowlistKey`
  - `symbol`
  - `decisionDateKey`
  - `stepALaneId`
  - `sourceType`
  - `sourceInputPath`
- intent:
  - explicit narrowing contract for `tools/build_tp12_stepa_intraday_manifest.mjs`
  - expected canonical join is `(symbol, decisionDateKey, stepALaneId)`
  - rows without `stepALaneId` are allowed only when the caller intentionally wants symbol/date-level widening

The paired summary at `allowlist_summary.json` must include:
- `rowCount`
- `decisionDateFrom`, `decisionDateTo`
- `laneCounts`
- `sourceTypeCounts`
- `requireStepALane`
- `skippedByDecisionRange`, `skippedByLane`

When `requests.jsonl` was built with an explicit allowlist, `manifest_summary.json` must include:
- `allowlistPath`
- `allowlistRowCount`
- `allowlistMatchedRowCount`
- `allowlistLaneCounts`
- `allowlistSourceTypeCounts`
- `skippedByAllowlist`

Unmatched allowlist rows are fatal.

## 런 산출물
- `step-b/templates_lite.jsonl`: `featureVec`, `globalFeatureVec`, `seq40q`, `seq150q`
- `step-d/decision_candidates_feature_pack.jsonl`: 후보 특징 pack
