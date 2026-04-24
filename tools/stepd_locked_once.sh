#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=${1:-$(pwd)}
cd "$ROOT_DIR"

link_or_copy() {
  local src="$1"
  local dst="$2"
  if ! ln -f "$src" "$dst" 2>/dev/null; then
    cp -f "$src" "$dst"
  fi
}

BASELINE_LINK=${BASELINE_LINK:-artifacts/autopilot/baselines/current_locked}
BASELINE_DIR=$(readlink -f "$BASELINE_LINK" 2>/dev/null || true)
if [ -z "$BASELINE_DIR" ] || [ ! -d "$BASELINE_DIR" ]; then
  echo '{"status":"error","reason":"baseline_not_found"}'
  exit 1
fi

BASE_CONFIG=${BASE_CONFIG:-}
if [ -z "$BASE_CONFIG" ] && [ -f "$BASELINE_DIR/config/lab.config.server.lite.snapshot.json" ]; then
  BASE_CONFIG="$BASELINE_DIR/config/lab.config.server.lite.snapshot.json"
fi
if [ -z "$BASE_CONFIG" ]; then
  BASE_CONFIG="config/lab.config.server.lite.json"
fi

RUN_ID=${RUN_ID:-stepd_locked_$(date +%Y%m%d_%H%M%S)}
RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
STEP_C_DIR="$RUN_DIR/step-c"
STEP_B_DIR="$RUN_DIR/step-b"
STEP_D_DIR="$RUN_DIR/step-d"
TMP_CFG_DIR="$ROOT_DIR/artifacts/autopilot/tmp"
TMP_CFG="$TMP_CFG_DIR/${RUN_ID}.config.json"
mkdir -p "$STEP_C_DIR" "$STEP_B_DIR" "$STEP_D_DIR" "$TMP_CFG_DIR"

link_or_copy "$BASELINE_DIR/step-c/pattern_library.json" "$STEP_C_DIR/pattern_library.json"
cp -f "$BASELINE_DIR/step-c/pattern_library_runtime.json" "$STEP_C_DIR/pattern_library_runtime.json"
if [ -f "$BASELINE_DIR/step-c/step_c_summary.json" ]; then
  link_or_copy "$BASELINE_DIR/step-c/step_c_summary.json" "$STEP_C_DIR/step_c_summary.json"
fi
if [ -f "$BASELINE_DIR/step-b/templates.jsonl" ]; then
  link_or_copy "$BASELINE_DIR/step-b/templates.jsonl" "$STEP_B_DIR/templates.jsonl"
fi
if [ -f "$BASELINE_DIR/step-b/templates_lite.jsonl" ]; then
  link_or_copy "$BASELINE_DIR/step-b/templates_lite.jsonl" "$STEP_B_DIR/templates_lite.jsonl"
fi
if [ -f "$BASELINE_DIR/step-b/step_b_summary.json" ]; then
  link_or_copy "$BASELINE_DIR/step-b/step_b_summary.json" "$STEP_B_DIR/step_b_summary.json"
fi

START_WEIGHTS_PATH=${START_WEIGHTS_PATH:-$BASELINE_DIR/step-d/champion_weights.json}
if [ ! -f "$START_WEIGHTS_PATH" ]; then
  START_WEIGHTS_PATH="$BASELINE_DIR/step-d/champion_weights.json"
fi

STEPD_WORKERS=${STEPD_WORKERS:-2}
STEPD_CHUNK=${STEPD_CHUNK:-384}
STEPD_TOPK=${STEPD_TOPK:-40}
STEPD_COARSE_TOPN=${STEPD_COARSE_TOPN:-220}
STEPD_COARSE_TOPCLUSTERS=${STEPD_COARSE_TOPCLUSTERS:-10}
STEPD_REUSE_RUNTIME_CACHE=${STEPD_REUSE_RUNTIME_CACHE:-true}
STEPD_LEARNING_RATE=${STEPD_LEARNING_RATE:-}
STEPD_REINFORCE_BETA=${STEPD_REINFORCE_BETA:-}
STEPD_WEIGHT_FLOOR=${STEPD_WEIGHT_FLOOR:-0.02}
STEPD_MIN_FINAL_SCORE=${STEPD_MIN_FINAL_SCORE:-}
STEPD_TARGET_PICKED=${STEPD_TARGET_PICKED:-}
STEPD_MIN_EXPECTED_NET_RET3D=${STEPD_MIN_EXPECTED_NET_RET3D:-}
STEPD_GENERALIZATION_ENABLED=${STEPD_GENERALIZATION_ENABLED:-true}
STEPD_GENERALIZATION_MODE=${STEPD_GENERALIZATION_MODE:-chronological}
STEPD_UPDATE_RATIO=${STEPD_UPDATE_RATIO:-0.7}
STEPD_EVAL_MIN_DAYS=${STEPD_EVAL_MIN_DAYS:-20}
STEPD_EVAL_FOLD_OFFSET=${STEPD_EVAL_FOLD_OFFSET:-0}
STEPD_PROMOTION_SCOPE=${STEPD_PROMOTION_SCOPE:-update}
if [ -z "${STEPD_USE_EVAL_FOR_PROMOTION:-}" ]; then
  case "$(echo "$STEPD_PROMOTION_SCOPE" | tr '[:upper:]' '[:lower:]')" in
    eval) STEPD_USE_EVAL_FOR_PROMOTION=true ;;
    *) STEPD_USE_EVAL_FOR_PROMOTION=false ;;
  esac
fi
STEPD_PAIRWISE_ENABLED=${STEPD_PAIRWISE_ENABLED:-true}
STEPD_PAIRWISE_POSITIVE_TOPN=${STEPD_PAIRWISE_POSITIVE_TOPN:-3}
STEPD_PAIRWISE_NEGATIVE_TOPN=${STEPD_PAIRWISE_NEGATIVE_TOPN:-5}
STEPD_PAIRWISE_WEIGHT=${STEPD_PAIRWISE_WEIGHT:-0.8}
STEPD_HARD_NEGATIVE_WEIGHT=${STEPD_HARD_NEGATIVE_WEIGHT:-1.0}
STEPD_PAIRWISE_FALLBACK_TO_LEGACY=${STEPD_PAIRWISE_FALLBACK_TO_LEGACY:-false}
STEPD_ONLINE_LEARNING_ENABLED=${STEPD_ONLINE_LEARNING_ENABLED:-false}
STEPD_ADAPTIVE_MINFINAL_ENABLED=${STEPD_ADAPTIVE_MINFINAL_ENABLED:-true}
STEPD_TARGET_MIN_PICKED=${STEPD_TARGET_MIN_PICKED:-60}
STEPD_TARGET_MAX_PICKED=${STEPD_TARGET_MAX_PICKED:-80}
STEPD_ADAPTIVE_STEP=${STEPD_ADAPTIVE_STEP:-0.003}
STEPD_ADAPTIVE_HYSTERESIS=${STEPD_ADAPTIVE_HYSTERESIS:-2}
STEPD_ADAPTIVE_WARMUP_DAYS=${STEPD_ADAPTIVE_WARMUP_DAYS:-8}
STEPD_EXECUTION_GATE_ENABLED=${STEPD_EXECUTION_GATE_ENABLED:-true}
STEPD_EXECUTION_TARGET_LCB=${STEPD_EXECUTION_TARGET_LCB:-0.70}
STEPD_EXECUTION_MIN_GLOBAL_SAMPLES=${STEPD_EXECUTION_MIN_GLOBAL_SAMPLES:-80}
STEPD_EXECUTION_REQUIRE_GLOBAL_FLOOR=${STEPD_EXECUTION_REQUIRE_GLOBAL_FLOOR:-true}
STEPD_EXECUTION_SHADOW_GLOBAL_UNKNOWN=${STEPD_EXECUTION_SHADOW_GLOBAL_UNKNOWN:-false}
STEPD_EXECUTION_REQUIRE_REGIME_APPROVAL=${STEPD_EXECUTION_REQUIRE_REGIME_APPROVAL:-true}
STEPD_EXECUTION_MIN_REGIME_SAMPLES=${STEPD_EXECUTION_MIN_REGIME_SAMPLES:-20}
STEPD_EXECUTION_SHADOW_REGIME_UNKNOWN=${STEPD_EXECUTION_SHADOW_REGIME_UNKNOWN:-true}
STEPD_EXECUTION_FEEDBACK_DELAY_DAYS=${STEPD_EXECUTION_FEEDBACK_DELAY_DAYS:-0}
STEPD_EXECUTION_CALIBRATION_WINDOW_DAYS=${STEPD_EXECUTION_CALIBRATION_WINDOW_DAYS:-120}
STEPD_EXECUTION_MIN_SCORE_MARGIN=${STEPD_EXECUTION_MIN_SCORE_MARGIN:-0.001}
STEPD_EXECUTION_MIN_EXPECTED_NET_RET3D=${STEPD_EXECUTION_MIN_EXPECTED_NET_RET3D:--0.001}
STEPD_EXECUTION_MIN_QUALITY_SCORE=${STEPD_EXECUTION_MIN_QUALITY_SCORE:-0.58}
STEPD_EXECUTION_MIN_TARGET_RATE3D=${STEPD_EXECUTION_MIN_TARGET_RATE3D:-0.50}
STEPD_EXECUTION_MAX_STOP_RATE3D=${STEPD_EXECUTION_MAX_STOP_RATE3D:-0.45}
STEPD_EXECUTION_SOFTSTART_ENABLED=${STEPD_EXECUTION_SOFTSTART_ENABLED:-true}
STEPD_EXECUTION_SOFTSTART_UNTIL_GLOBAL_SAMPLES=${STEPD_EXECUTION_SOFTSTART_UNTIL_GLOBAL_SAMPLES:-160}
STEPD_EXECUTION_SOFTSTART_TARGET_LCB=${STEPD_EXECUTION_SOFTSTART_TARGET_LCB:-0.08}
STEPD_EXECUTION_SOFTSTART_MIN_GLOBAL_SAMPLES=${STEPD_EXECUTION_SOFTSTART_MIN_GLOBAL_SAMPLES:-30}
STEPD_EXECUTION_SOFTSTART_REQUIRE_GLOBAL_FLOOR=${STEPD_EXECUTION_SOFTSTART_REQUIRE_GLOBAL_FLOOR:-false}
STEPD_EXECUTION_SOFTSTART_REQUIRE_REGIME_APPROVAL=${STEPD_EXECUTION_SOFTSTART_REQUIRE_REGIME_APPROVAL:-false}
STEPD_EXECUTION_SOFTSTART_MIN_REGIME_SAMPLES=${STEPD_EXECUTION_SOFTSTART_MIN_REGIME_SAMPLES:-8}
STEPD_EXECUTION_SOFTSTART_SHADOW_REGIME_UNKNOWN=${STEPD_EXECUTION_SOFTSTART_SHADOW_REGIME_UNKNOWN:-false}
STEPD_REGIME_ROUTER_ENABLED=${STEPD_REGIME_ROUTER_ENABLED:-false}
STEPD_REGIME_ROUTER_MODE=${STEPD_REGIME_ROUTER_MODE:-vol3}
STEPD_REGIME_ROUTER_DEFAULT_BUCKET=${STEPD_REGIME_ROUTER_DEFAULT_BUCKET:-__DEFAULT__}
STEPD_REGIME_ROUTER_STRICT_LOAD=${STEPD_REGIME_ROUTER_STRICT_LOAD:-false}
STEPD_MAX_PICKED_PROMOTION=${STEPD_MAX_PICKED_PROMOTION:-80}
STEPD_MAX_TWOPICK_PROMOTION=${STEPD_MAX_TWOPICK_PROMOTION:-0}
STEPD_SAMPLED_DEBUG_ENABLED=${STEPD_SAMPLED_DEBUG_ENABLED:-true}
STEPD_SAMPLED_DEBUG_TOPK=${STEPD_SAMPLED_DEBUG_TOPK:-5}
STEPD_SAMPLED_DEBUG_EVAL_ONLY=${STEPD_SAMPLED_DEBUG_EVAL_ONLY:-true}
STEPD_SAMPLED_DEBUG_SELECTED_REJECTED_ONLY=${STEPD_SAMPLED_DEBUG_SELECTED_REJECTED_ONLY:-true}
STEPD_FAIL_ON_CONFIG_DIFF=${STEPD_FAIL_ON_CONFIG_DIFF:-true}
STEPD_FAIL_ON_RUNTIME_DIFF=${STEPD_FAIL_ON_RUNTIME_DIFF:-true}
STEPD_PRUNE_HEAVY=${STEPD_PRUNE_HEAVY:-true}
STEPD_CLEANUP_RUN=${STEPD_CLEANUP_RUN:-true}

# IMPORTANT: runStepD reads coarse params from pattern_library_runtime, not config.
RUNTIME_PATH="$STEP_C_DIR/pattern_library_runtime.json"
RUNTIME_TMP="$STEP_C_DIR/pattern_library_runtime.tmp.json"
jq \
  --argjson coarseTopN "$STEPD_COARSE_TOPN" \
  --argjson coarseTopClusters "$STEPD_COARSE_TOPCLUSTERS" \
  '.coarseTopN=$coarseTopN | .coarseTopClusters=$coarseTopClusters' \
  "$RUNTIME_PATH" > "$RUNTIME_TMP"
mv -f "$RUNTIME_TMP" "$RUNTIME_PATH"

jq \
  --arg sw "$START_WEIGHTS_PATH" \
  --argjson workers "$STEPD_WORKERS" \
  --argjson chunk "$STEPD_CHUNK" \
  --argjson topK "$STEPD_TOPK" \
  --argjson coarseTopN "$STEPD_COARSE_TOPN" \
  --argjson coarseTopClusters "$STEPD_COARSE_TOPCLUSTERS" \
  --argjson reuseRuntimeCache "$STEPD_REUSE_RUNTIME_CACHE" \
  --arg lr "$STEPD_LEARNING_RATE" \
  --arg beta "$STEPD_REINFORCE_BETA" \
  --arg floor "$STEPD_WEIGHT_FLOOR" \
  --arg minFinal "$STEPD_MIN_FINAL_SCORE" \
  --arg targetPicked "$STEPD_TARGET_PICKED" \
  --arg minExpectedNetRet3d "$STEPD_MIN_EXPECTED_NET_RET3D" \
  --argjson genEnabled "$STEPD_GENERALIZATION_ENABLED" \
  --arg genMode "$STEPD_GENERALIZATION_MODE" \
  --argjson genUpdateRatio "$STEPD_UPDATE_RATIO" \
  --argjson genEvalMinDays "$STEPD_EVAL_MIN_DAYS" \
  --argjson genEvalFoldOffset "$STEPD_EVAL_FOLD_OFFSET" \
  --arg genPromotionScope "$STEPD_PROMOTION_SCOPE" \
  --argjson genUseEvalPromotion "$STEPD_USE_EVAL_FOR_PROMOTION" \
  --argjson pairwiseEnabled "$STEPD_PAIRWISE_ENABLED" \
  --argjson pairwisePositiveTopN "$STEPD_PAIRWISE_POSITIVE_TOPN" \
  --argjson pairwiseNegativeTopN "$STEPD_PAIRWISE_NEGATIVE_TOPN" \
  --argjson pairwiseWeight "$STEPD_PAIRWISE_WEIGHT" \
  --argjson hardNegativeWeight "$STEPD_HARD_NEGATIVE_WEIGHT" \
  --argjson pairwiseFallbackToLegacy "$STEPD_PAIRWISE_FALLBACK_TO_LEGACY" \
  --argjson onlineLearningEnabled "$STEPD_ONLINE_LEARNING_ENABLED" \
  --argjson adaptiveEnabled "$STEPD_ADAPTIVE_MINFINAL_ENABLED" \
  --argjson adaptiveTargetMin "$STEPD_TARGET_MIN_PICKED" \
  --argjson adaptiveTargetMax "$STEPD_TARGET_MAX_PICKED" \
  --argjson adaptiveStep "$STEPD_ADAPTIVE_STEP" \
  --argjson adaptiveHysteresis "$STEPD_ADAPTIVE_HYSTERESIS" \
  --argjson adaptiveWarmupDays "$STEPD_ADAPTIVE_WARMUP_DAYS" \
  --argjson executionGateEnabled "$STEPD_EXECUTION_GATE_ENABLED" \
  --argjson executionTargetLcb "$STEPD_EXECUTION_TARGET_LCB" \
  --argjson executionMinGlobalSamples "$STEPD_EXECUTION_MIN_GLOBAL_SAMPLES" \
  --argjson executionRequireGlobalFloor "$STEPD_EXECUTION_REQUIRE_GLOBAL_FLOOR" \
  --argjson executionShadowGlobalUnknown "$STEPD_EXECUTION_SHADOW_GLOBAL_UNKNOWN" \
  --argjson executionRequireRegimeApproval "$STEPD_EXECUTION_REQUIRE_REGIME_APPROVAL" \
  --argjson executionMinRegimeSamples "$STEPD_EXECUTION_MIN_REGIME_SAMPLES" \
  --argjson executionShadowRegimeUnknown "$STEPD_EXECUTION_SHADOW_REGIME_UNKNOWN" \
  --argjson executionFeedbackDelayDays "$STEPD_EXECUTION_FEEDBACK_DELAY_DAYS" \
  --argjson executionCalibrationWindowDays "$STEPD_EXECUTION_CALIBRATION_WINDOW_DAYS" \
  --argjson executionMinScoreMargin "$STEPD_EXECUTION_MIN_SCORE_MARGIN" \
  --argjson executionMinExpectedNetRet3d "$STEPD_EXECUTION_MIN_EXPECTED_NET_RET3D" \
  --argjson executionMinQualityScore "$STEPD_EXECUTION_MIN_QUALITY_SCORE" \
  --argjson executionMinTargetRate3d "$STEPD_EXECUTION_MIN_TARGET_RATE3D" \
  --argjson executionMaxStopRate3d "$STEPD_EXECUTION_MAX_STOP_RATE3D" \
  --argjson executionSoftStartEnabled "$STEPD_EXECUTION_SOFTSTART_ENABLED" \
  --argjson executionSoftStartUntilGlobalSamples "$STEPD_EXECUTION_SOFTSTART_UNTIL_GLOBAL_SAMPLES" \
  --argjson executionSoftStartTargetLcb "$STEPD_EXECUTION_SOFTSTART_TARGET_LCB" \
  --argjson executionSoftStartMinGlobalSamples "$STEPD_EXECUTION_SOFTSTART_MIN_GLOBAL_SAMPLES" \
  --argjson executionSoftStartRequireGlobalFloor "$STEPD_EXECUTION_SOFTSTART_REQUIRE_GLOBAL_FLOOR" \
  --argjson executionSoftStartRequireRegimeApproval "$STEPD_EXECUTION_SOFTSTART_REQUIRE_REGIME_APPROVAL" \
  --argjson executionSoftStartMinRegimeSamples "$STEPD_EXECUTION_SOFTSTART_MIN_REGIME_SAMPLES" \
  --argjson executionSoftStartShadowRegimeUnknown "$STEPD_EXECUTION_SOFTSTART_SHADOW_REGIME_UNKNOWN" \
  --argjson regimeRouterEnabled "$STEPD_REGIME_ROUTER_ENABLED" \
  --arg regimeRouterMode "$STEPD_REGIME_ROUTER_MODE" \
  --arg regimeRouterDefaultBucket "$STEPD_REGIME_ROUTER_DEFAULT_BUCKET" \
  --argjson regimeRouterStrictLoad "$STEPD_REGIME_ROUTER_STRICT_LOAD" \
  --argjson maxPickedPromotion "$STEPD_MAX_PICKED_PROMOTION" \
  --argjson maxTwoPickPromotion "$STEPD_MAX_TWOPICK_PROMOTION" \
  --argjson sampledDebugEnabled "$STEPD_SAMPLED_DEBUG_ENABLED" \
  --argjson sampledDebugTopK "$STEPD_SAMPLED_DEBUG_TOPK" \
  --argjson sampledDebugEvalOnly "$STEPD_SAMPLED_DEBUG_EVAL_ONLY" \
  --argjson sampledDebugSelectedRejectedOnly "$STEPD_SAMPLED_DEBUG_SELECTED_REJECTED_ONLY" \
  --argjson failOnConfigDiff "$STEPD_FAIL_ON_CONFIG_DIFF" \
  --argjson failOnRuntimeDiff "$STEPD_FAIL_ON_RUNTIME_DIFF" \
  '.onlineLearning.startWeightsPath=$sw
   | .similarity.topK=$topK
   | .similarity.coarseTopN=$coarseTopN
   | .similarity.coarseTopClusters=$coarseTopClusters
   | .lightweight.stepD.scoringWorkers=$workers
   | .lightweight.stepD.workerChunkSize=$chunk
   | .lightweight.stepD.reuseRuntimeCache=$reuseRuntimeCache
   | .lightweight.stepD.keepWorkerPoolAlive=false
   | .lightweight.stepD.persistOnlineFeaturePackRows=false
   | .lightweight.stepD.prepareLockboxDuringStepD=false
   | .lightweight.stepD.writeFeaturePackRows=false
   | .lightweight.stepD.writeDailyLogs=false
   | .lightweight.stepD.writeDecisionCandidatesIndex=false
   | .lightweight.stepD.sampledDebugLog.enabled=$sampledDebugEnabled
   | .lightweight.stepD.sampledDebugLog.evalOnly=$sampledDebugEvalOnly
   | .lightweight.stepD.sampledDebugLog.selectedOrRejectedOnly=$sampledDebugSelectedRejectedOnly
   | .lightweight.stepD.sampledDebugLog.topK=$sampledDebugTopK
   | .lightweight.stepD.overrideGuard.enabled=true
   | .lightweight.stepD.overrideGuard.failOnConfigDiff=$failOnConfigDiff
   | .lightweight.stepD.overrideGuard.failOnRuntimeDiff=$failOnRuntimeDiff
   | .decisionGate.maxPicksPerDay=1
   | .decisionGate.secondPick.phase="disabled"
   | .decisionGate.secondPick.mode="disabled"
   | .decisionGate.executionGate.enabled=$executionGateEnabled
   | .decisionGate.executionGate.targetLcb=$executionTargetLcb
   | .decisionGate.executionGate.minGlobalSamples=$executionMinGlobalSamples
   | .decisionGate.executionGate.requireGlobalFloor=$executionRequireGlobalFloor
   | .decisionGate.executionGate.shadowWhenGlobalUnknown=$executionShadowGlobalUnknown
   | .decisionGate.executionGate.requireRegimeApproval=$executionRequireRegimeApproval
   | .decisionGate.executionGate.minRegimeSamples=$executionMinRegimeSamples
   | .decisionGate.executionGate.shadowWhenRegimeUnknown=$executionShadowRegimeUnknown
   | .decisionGate.executionGate.feedbackDelayDays=$executionFeedbackDelayDays
   | .decisionGate.executionGate.calibrationWindowDays=$executionCalibrationWindowDays
   | .decisionGate.executionGate.uncertainty.minScoreMargin=$executionMinScoreMargin
   | .decisionGate.executionGate.uncertainty.minExpectedNetRet3d=$executionMinExpectedNetRet3d
   | .decisionGate.executionGate.uncertainty.minQualityScore=$executionMinQualityScore
   | .decisionGate.executionGate.uncertainty.minTargetRate3d=$executionMinTargetRate3d
   | .decisionGate.executionGate.uncertainty.maxStopRate3d=$executionMaxStopRate3d
   | .decisionGate.executionGate.softStart.enabled=$executionSoftStartEnabled
   | .decisionGate.executionGate.softStart.untilGlobalSamples=$executionSoftStartUntilGlobalSamples
   | .decisionGate.executionGate.softStart.targetLcb=$executionSoftStartTargetLcb
   | .decisionGate.executionGate.softStart.minGlobalSamples=$executionSoftStartMinGlobalSamples
   | .decisionGate.executionGate.softStart.requireGlobalFloor=$executionSoftStartRequireGlobalFloor
   | .decisionGate.executionGate.softStart.requireRegimeApproval=$executionSoftStartRequireRegimeApproval
   | .decisionGate.executionGate.softStart.minRegimeSamples=$executionSoftStartMinRegimeSamples
   | .decisionGate.executionGate.softStart.shadowWhenRegimeUnknown=$executionSoftStartShadowRegimeUnknown
   | .decisionGate.regimeRouter.enabled=$regimeRouterEnabled
   | .decisionGate.regimeRouter.routingMode=$regimeRouterMode
   | .decisionGate.regimeRouter.defaultBucket=$regimeRouterDefaultBucket
   | .decisionGate.regimeRouter.strictWeightLoad=$regimeRouterStrictLoad
   | .onlineLearning.enabled=$onlineLearningEnabled
   | .onlineLearning.generalization.enabled=$genEnabled
   | .onlineLearning.generalization.promotionScope=$genPromotionScope
   | .onlineLearning.generalization.useEvalForPromotion=$genUseEvalPromotion
   | .onlineLearning.generalization.splitMode=$genMode
   | .onlineLearning.generalization.mode=$genMode
   | .onlineLearning.generalization.updateRatio=$genUpdateRatio
   | .onlineLearning.generalization.evalMinDays=$genEvalMinDays
   | .onlineLearning.generalization.evalFoldOffset=$genEvalFoldOffset
   | .onlineLearning.generalization.pairwise.enabled=$pairwiseEnabled
   | .onlineLearning.generalization.pairwise.positiveTopN=$pairwisePositiveTopN
   | .onlineLearning.generalization.pairwise.negativeTopN=$pairwiseNegativeTopN
   | .onlineLearning.generalization.pairwise.pairwiseWeight=$pairwiseWeight
   | .onlineLearning.generalization.pairwise.hardNegativeWeight=$hardNegativeWeight
   | .onlineLearning.generalization.pairwise.fallbackToLegacy=$pairwiseFallbackToLegacy
   | .decisionGate.adaptiveMinFinalScore.enabled=$adaptiveEnabled
   | .decisionGate.adaptiveMinFinalScore.targetMinPicked=$adaptiveTargetMin
   | .decisionGate.adaptiveMinFinalScore.targetMaxPicked=$adaptiveTargetMax
   | .decisionGate.adaptiveMinFinalScore.step=$adaptiveStep
   | .decisionGate.adaptiveMinFinalScore.hysteresis=$adaptiveHysteresis
   | .decisionGate.adaptiveMinFinalScore.warmupDays=$adaptiveWarmupDays
   | .cdLoop.maxPickedCountForPromotion=$maxPickedPromotion
   | .cdLoop.maxTwoPickDaysForPromotion=$maxTwoPickPromotion
   | (if ($lr|length)>0 then (.onlineLearning.learningRate=($lr|tonumber)) else . end)
   | (if ($beta|length)>0 then (.onlineLearning.reinforceBeta=($beta|tonumber)) else . end)
   | (if ($floor|length)>0 then (.onlineLearning.weightFloor=($floor|tonumber)) else . end)
   | (if ($minFinal|length)>0 then (.decisionGate.minFinalScore=($minFinal|tonumber)) else . end)
   | (if ($targetPicked|length)>0 then (.decisionGate.coverageRecovery.targetPickedCount=($targetPicked|tonumber)) else . end)
   | (if ($minExpectedNetRet3d|length)>0 then (.decisionGate.minExpectedNetRet3d=($minExpectedNetRet3d|tonumber)) else . end)' \
  "$BASE_CONFIG" > "$TMP_CFG"

START_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STATUS="ok"
ERR_MSG=""
if ! node src/cli.mjs step-d --config="$TMP_CFG" --run-id="$RUN_ID" > "$STEP_D_DIR/console.log" 2>&1; then
  STATUS="error"
  ERR_MSG=$(tail -n 40 "$STEP_D_DIR/console.log" | tr '\n' ' ' | sed 's/"/\\"/g')
fi
END_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

SUMMARY_PATH="$STEP_D_DIR/step_d_summary.json"
WEIGHTS_PATH="$STEP_D_DIR/weights_final.json"

if [ "$STATUS" != "ok" ] || [ ! -f "$SUMMARY_PATH" ]; then
  jq -n \
    --arg status "$STATUS" \
    --arg runId "$RUN_ID" \
    --arg startedAt "$START_TS" \
    --arg endedAt "$END_TS" \
    --arg err "$ERR_MSG" \
    --arg consoleLog "$STEP_D_DIR/console.log" \
    '{status:$status,runId:$runId,startedAt:$startedAt,endedAt:$endedAt,error:$err,consoleLog:$consoleLog}'
  exit 1
fi

if [ "$STEPD_PRUNE_HEAVY" = "true" ]; then
  rm -f "$STEP_D_DIR/daily_online_logs.jsonl" "$STEP_D_DIR/decision_candidates_index.jsonl"
fi

if [ "$STEPD_CLEANUP_RUN" = "true" ]; then
  rm -rf "$STEP_B_DIR" "$STEP_C_DIR"
fi

jq -n \
  --arg status "ok" \
  --arg runId "$RUN_ID" \
  --arg startedAt "$START_TS" \
  --arg endedAt "$END_TS" \
  --arg baselineDir "$BASELINE_DIR" \
  --arg baseConfig "$BASE_CONFIG" \
  --arg summaryPath "$SUMMARY_PATH" \
  --arg weightsPath "$WEIGHTS_PATH" \
  --arg configPath "$TMP_CFG" \
  --arg consoleLog "$STEP_D_DIR/console.log" \
  --argjson pickedCount "$(jq '.pickedCount // 0' "$SUMMARY_PATH")" \
  --argjson pickHitRate "$(jq '.pickHitRate // 0' "$SUMMARY_PATH")" \
  --argjson pickHitCount "$(jq '.pickHitCount // 0' "$SUMMARY_PATH")" \
  --argjson oracleHitRateTopK "$(jq '.oracleHitRateTopK // 0' "$SUMMARY_PATH")" \
  --argjson oracleHitDaysTopK "$(jq '.oracleHitDaysTopK // 0' "$SUMMARY_PATH")" \
  --argjson top1ToOracleConversion "$(jq '.top1ToOracleConversion // 0' "$SUMMARY_PATH")" \
  --argjson budgetedConversion60 "$(jq '.budgetedConversion60 // 0' "$SUMMARY_PATH")" \
  --argjson budgetedConversion80 "$(jq '.budgetedConversion80 // 0' "$SUMMARY_PATH")" \
  --argjson hitAt1 "$(jq '.hitAt1 // 0' "$SUMMARY_PATH")" \
  --argjson hitAt3 "$(jq '.hitAt3 // 0' "$SUMMARY_PATH")" \
  --argjson hitAt5 "$(jq '.hitAt5 // 0' "$SUMMARY_PATH")" \
  --argjson firstSuccessRankAvg "$(jq '.firstSuccessRankAvg // 0' "$SUMMARY_PATH")" \
  --argjson gateRejectedHitDays "$(jq '.gateRejectedHitDays // 0' "$SUMMARY_PATH")" \
  --argjson executedCount "$(jq '.executedCount // 0' "$SUMMARY_PATH")" \
  --argjson executedHitCount "$(jq '.executedHitCount // 0' "$SUMMARY_PATH")" \
  --argjson executedHitRate "$(jq '.executedHitRate // 0' "$SUMMARY_PATH")" \
  --argjson executedHitRateLcb95 "$(jq '.executedHitRateLcb95 // 0' "$SUMMARY_PATH")" \
  --argjson executionCoverage "$(jq '.executionCoverage // 0' "$SUMMARY_PATH")" \
  --argjson executionRejectedHitDays "$(jq '.executionRejectedHitDays // 0' "$SUMMARY_PATH")" \
  --argjson executionShadowDays "$(jq '.executionShadowDays // 0' "$SUMMARY_PATH")" \
  --argjson executionShadowOnlyDays "$(jq '.executionShadowOnlyDays // 0' "$SUMMARY_PATH")" \
  --argjson executionLookaheadViolations "$(jq '.executionLookaheadViolations // 0' "$SUMMARY_PATH")" \
  --argjson executionShadowReasonCounts "$(jq '.executionShadowReasonCounts // {}' "$SUMMARY_PATH")" \
  --argjson executionApprovedRegimes "$(jq '.executionGate.approvedRegimes // []' "$SUMMARY_PATH")" \
  --argjson regimeRouterRouteUsageCounts "$(jq '.regimeRouter.routeUsageCounts // {}' "$SUMMARY_PATH")" \
  --argjson regimeRouterRouteFallbackCounts "$(jq '.regimeRouter.routeFallbackCounts // {}' "$SUMMARY_PATH")" \
  --argjson lookaheadViolations "$(jq '.lookaheadViolations // 0' "$SUMMARY_PATH")" \
  --argjson feedbackAppliedDelayDaysAvg "$(jq '.feedbackAppliedDelayDaysAvg // 0' "$SUMMARY_PATH")" \
  --argjson feedbackAppliedCount "$(jq '.feedbackAppliedCount // 0' "$SUMMARY_PATH")" \
  --argjson effectiveConfigDiffCount "$(jq '.effectiveConfigDiffCount // 0' "$SUMMARY_PATH")" \
  --argjson unexpectedConfigDiffCount "$(jq '.unexpectedConfigDiffCount // 0' "$SUMMARY_PATH")" \
  --argjson effectiveRuntimeDiffCount "$(jq '.effectiveRuntimeDiffCount // 0' "$SUMMARY_PATH")" \
  --argjson unexpectedRuntimeDiffCount "$(jq '.unexpectedRuntimeDiffCount // 0' "$SUMMARY_PATH")" \
  --arg sampledDebugPath "$(jq -r '.sampledDebugLog.path // ""' "$SUMMARY_PATH")" \
  --argjson sampledDebugRows "$(jq '.sampledDebugLog.rows // 0' "$SUMMARY_PATH")" \
  --argjson workerPoolScoreMs "$(jq '.workerPoolScoreMs // 0' "$SUMMARY_PATH")" \
  --argjson coarseTopN "$(jq '.coarseTopN // 0' "$SUMMARY_PATH")" \
  --argjson coarseTopClusters "$(jq '.coarseTopClusters // 0' "$SUMMARY_PATH")" \
  '{status:$status,runId:$runId,startedAt:$startedAt,endedAt:$endedAt,baselineDir:$baselineDir,baseConfig:$baseConfig,summaryPath:$summaryPath,weightsPath:$weightsPath,configPath:$configPath,consoleLog:$consoleLog,pickedCount:$pickedCount,pickHitRate:$pickHitRate,pickHitCount:$pickHitCount,oracleHitRateTopK:$oracleHitRateTopK,oracleHitDaysTopK:$oracleHitDaysTopK,top1ToOracleConversion:$top1ToOracleConversion,budgetedConversion60:$budgetedConversion60,budgetedConversion80:$budgetedConversion80,hitAt1:$hitAt1,hitAt3:$hitAt3,hitAt5:$hitAt5,firstSuccessRankAvg:$firstSuccessRankAvg,gateRejectedHitDays:$gateRejectedHitDays,executedCount:$executedCount,executedHitCount:$executedHitCount,executedHitRate:$executedHitRate,executedHitRateLcb95:$executedHitRateLcb95,executionCoverage:$executionCoverage,executionRejectedHitDays:$executionRejectedHitDays,executionShadowDays:$executionShadowDays,executionShadowOnlyDays:$executionShadowOnlyDays,executionLookaheadViolations:$executionLookaheadViolations,executionShadowReasonCounts:$executionShadowReasonCounts,executionApprovedRegimes:$executionApprovedRegimes,regimeRouterRouteUsageCounts:$regimeRouterRouteUsageCounts,regimeRouterRouteFallbackCounts:$regimeRouterRouteFallbackCounts,lookaheadViolations:$lookaheadViolations,feedbackAppliedDelayDaysAvg:$feedbackAppliedDelayDaysAvg,feedbackAppliedCount:$feedbackAppliedCount,effectiveConfigDiffCount:$effectiveConfigDiffCount,unexpectedConfigDiffCount:$unexpectedConfigDiffCount,effectiveRuntimeDiffCount:$effectiveRuntimeDiffCount,unexpectedRuntimeDiffCount:$unexpectedRuntimeDiffCount,sampledDebugPath:$sampledDebugPath,sampledDebugRows:$sampledDebugRows,workerPoolScoreMs:$workerPoolScoreMs,coarseTopN:$coarseTopN,coarseTopClusters:$coarseTopClusters}'
