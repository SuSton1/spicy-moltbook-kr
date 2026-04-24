#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=${1:-$(pwd)}
cd "$ROOT_DIR"

LOCK_DIR="$ROOT_DIR/artifacts/autopilot/locks"
LOG_DIR="$ROOT_DIR/artifacts/autopilot/logs"
PID_DIR="$ROOT_DIR/artifacts/autopilot/pids"
STATUS_DIR="$ROOT_DIR/artifacts/autopilot/status"
STATE_DIR="$ROOT_DIR/artifacts/autopilot/state/stepd_locked"
mkdir -p "$LOCK_DIR" "$LOG_DIR" "$PID_DIR" "$STATUS_DIR" "$STATE_DIR"

LOCK_FILE="$LOCK_DIR/stepd_locked_loop.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[stepd_locked_loop] already running: lock busy ($LOCK_FILE)"
  exit 1
fi

BASELINE_LINK=${BASELINE_LINK:-artifacts/autopilot/baselines/current_locked}
BASELINE_DIR=$(readlink -f "$BASELINE_LINK" 2>/dev/null || true)
if [ -z "$BASELINE_DIR" ] || [ ! -d "$BASELINE_DIR" ]; then
  echo "[stepd_locked_loop] baseline missing: $BASELINE_LINK"
  exit 1
fi

LOOP_TAG=${LOOP_TAG:-$(date +%Y%m%d_%H%M%S)}
STATUS_FILE="$STATUS_DIR/stepd_locked_${LOOP_TAG}.jsonl"
LATEST_LINK="$STATUS_DIR/stepd_locked_latest.jsonl"
BEST_FILE="$STATE_DIR/best.json"
WEIGHTS_SEED="$STATE_DIR/weights_seed.json"
WEIGHTS_TRIAL="$STATE_DIR/weights_seed_trial.json"
ACCEPTED_FILE="$STATE_DIR/accepted_metrics.json"
CHECKPOINT_FILE="$STATE_DIR/checkpoint.json"
RUNTIME_NOTE="$STATE_DIR/runtime_note_${LOOP_TAG}.txt"
REJECT_STREAK_FILE="$STATE_DIR/reject_streak.txt"
HOLD_STREAK_FILE="$STATE_DIR/hold_champion_streak.txt"
PROMOTED_HASH_FILE="$STATE_DIR/promoted_hash_state.json"
WINDOW_PASS_FILE="$STATE_DIR/promotion_window_passes.json"
FOLD_METRICS_FILE="$STATE_DIR/promotion_fold_metrics.json"

PROMOTE_MIN_PICKED=${PROMOTE_MIN_PICKED:-60}
PROMOTE_MAX_PICKED=${PROMOTE_MAX_PICKED:-80}
PROMOTE_MAX_TWO_PICK_DAYS=${PROMOTE_MAX_TWO_PICK_DAYS:-0}
PROMOTE_MIN_HIT_DELTA=${PROMOTE_MIN_HIT_DELTA:-0.01}
PROMOTE_MIN_LCB_DELTA=${PROMOTE_MIN_LCB_DELTA:-0.01}
PROMOTE_MIN_CONVERSION=${PROMOTE_MIN_CONVERSION:-0.30}
PROMOTE_MIN_BUDGETED_CONVERSION80=${PROMOTE_MIN_BUDGETED_CONVERSION80:-$PROMOTE_MIN_CONVERSION}
PROMOTE_MAX_RANKLOSS_AVG_EVAL=${PROMOTE_MAX_RANKLOSS_AVG_EVAL:-0.08}
PROMOTE_MAX_LOOKAHEAD_VIOLATIONS=${PROMOTE_MAX_LOOKAHEAD_VIOLATIONS:-0}
PROMOTE_TIE_BAND=${PROMOTE_TIE_BAND:-0.000001}
PROMOTE_ABS_HIT_FLOOR=${PROMOTE_ABS_HIT_FLOOR:-0.18}
PROMOTE_ABS_LCB_FLOOR=${PROMOTE_ABS_LCB_FLOOR:-0.12}
PROMOTE_WINDOW_ROUNDS=${PROMOTE_WINDOW_ROUNDS:-5}
PROMOTE_MIN_PASS_IN_WINDOW=${PROMOTE_MIN_PASS_IN_WINDOW:-3}
PROMOTE_SEED_HASH_COOLDOWN_ROUNDS=${PROMOTE_SEED_HASH_COOLDOWN_ROUNDS:-4}
PROMOTE_MAX_SCORE_MS=${PROMOTE_MAX_SCORE_MS:-120000}
PROMOTE_MAX_SCORE_REGRESSION=${PROMOTE_MAX_SCORE_REGRESSION:-0.15}
PROMOTE_AGG_MODE=${PROMOTE_AGG_MODE:-fold_pool}
PROMOTE_POOL_MIN_FOLDS=${PROMOTE_POOL_MIN_FOLDS:-2}
PROMOTE_INFEASIBLE_POLICY=${PROMOTE_INFEASIBLE_POLICY:-auto}
ROLLBACK_REJECT_STREAK=${ROLLBACK_REJECT_STREAK:-2}
HOLD_CHAMPION_STREAK_CAP=${HOLD_CHAMPION_STREAK_CAP:-3}
STEPD_EVAL_FOLD_MOD=${STEPD_EVAL_FOLD_MOD:-3}
KEEP_RUN_DIRS=${KEEP_RUN_DIRS:-40}

is_true() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y) return 0 ;;
    *) return 1 ;;
  esac
}

PRECHECK_NOTES=()

if ! [[ "$PROMOTE_MIN_PICKED" =~ ^[0-9]+$ ]]; then PROMOTE_MIN_PICKED=60; fi
if ! [[ "$PROMOTE_MAX_PICKED" =~ ^[0-9]+$ ]]; then PROMOTE_MAX_PICKED=80; fi
if [ "$PROMOTE_MAX_PICKED" -lt "$PROMOTE_MIN_PICKED" ]; then
  TMP_PICKED="$PROMOTE_MIN_PICKED"
  PROMOTE_MIN_PICKED="$PROMOTE_MAX_PICKED"
  PROMOTE_MAX_PICKED="$TMP_PICKED"
  PRECHECK_NOTES+=("swap:minMaxPicked")
fi
if ! [[ "$PROMOTE_MAX_TWO_PICK_DAYS" =~ ^[0-9]+$ ]]; then PROMOTE_MAX_TWO_PICK_DAYS=0; fi
if ! [[ "$PROMOTE_MAX_LOOKAHEAD_VIOLATIONS" =~ ^[0-9]+$ ]]; then PROMOTE_MAX_LOOKAHEAD_VIOLATIONS=0; fi
if ! [[ "$PROMOTE_WINDOW_ROUNDS" =~ ^[0-9]+$ ]] || [ "$PROMOTE_WINDOW_ROUNDS" -lt 1 ]; then PROMOTE_WINDOW_ROUNDS=1; fi
if ! [[ "$PROMOTE_MIN_PASS_IN_WINDOW" =~ ^[0-9]+$ ]] || [ "$PROMOTE_MIN_PASS_IN_WINDOW" -lt 1 ]; then PROMOTE_MIN_PASS_IN_WINDOW=1; fi
if ! [[ "$PROMOTE_POOL_MIN_FOLDS" =~ ^[0-9]+$ ]] || [ "$PROMOTE_POOL_MIN_FOLDS" -lt 1 ]; then PROMOTE_POOL_MIN_FOLDS=1; fi
if ! [[ "$STEPD_EVAL_FOLD_MOD" =~ ^[0-9]+$ ]] || [ "$STEPD_EVAL_FOLD_MOD" -lt 1 ]; then STEPD_EVAL_FOLD_MOD=3; fi
if ! [[ "$HOLD_CHAMPION_STREAK_CAP" =~ ^[0-9]+$ ]] || [ "$HOLD_CHAMPION_STREAK_CAP" -lt 0 ]; then HOLD_CHAMPION_STREAK_CAP=3; fi

if [ "$PROMOTE_MIN_PASS_IN_WINDOW" -gt "$PROMOTE_WINDOW_ROUNDS" ]; then
  if [ "$PROMOTE_INFEASIBLE_POLICY" = "fail" ]; then
    echo "[stepd_locked_loop] invalid promote window: minPass($PROMOTE_MIN_PASS_IN_WINDOW) > window($PROMOTE_WINDOW_ROUNDS)"
    exit 1
  fi
  PROMOTE_MIN_PASS_IN_WINDOW="$PROMOTE_WINDOW_ROUNDS"
  PRECHECK_NOTES+=("auto:minPassToWindow")
fi

if [ "$PROMOTE_POOL_MIN_FOLDS" -gt "$STEPD_EVAL_FOLD_MOD" ]; then
  PROMOTE_POOL_MIN_FOLDS="$STEPD_EVAL_FOLD_MOD"
  PRECHECK_NOTES+=("auto:poolMinFoldsToFoldMod")
fi
if [ "$PROMOTE_POOL_MIN_FOLDS" -gt "$PROMOTE_WINDOW_ROUNDS" ]; then
  PROMOTE_POOL_MIN_FOLDS="$PROMOTE_WINDOW_ROUNDS"
  PRECHECK_NOTES+=("auto:poolMinFoldsToWindow")
fi

STEPD_PROMOTION_SCOPE=${STEPD_PROMOTION_SCOPE:-update}
if [ -z "${STEPD_USE_EVAL_FOR_PROMOTION:-}" ]; then
  case "$(echo "$STEPD_PROMOTION_SCOPE" | tr '[:upper:]' '[:lower:]')" in
    eval) STEPD_USE_EVAL_FOR_PROMOTION=true ;;
    *) STEPD_USE_EVAL_FOR_PROMOTION=false ;;
  esac
fi
USE_EVAL_FOR_PROMOTION_RAW=${STEPD_USE_EVAL_FOR_PROMOTION:-false}
USE_EVAL_FOR_PROMOTION=false
if is_true "$USE_EVAL_FOR_PROMOTION_RAW"; then
  USE_EVAL_FOR_PROMOTION=true
fi
if is_true "$USE_EVAL_FOR_PROMOTION_RAW" && [ "$STEPD_EVAL_FOLD_MOD" -gt 1 ]; then
  MAX_PASS_SINGLE_FOLD=$(( (PROMOTE_WINDOW_ROUNDS + STEPD_EVAL_FOLD_MOD - 1) / STEPD_EVAL_FOLD_MOD ))
  if [ "$PROMOTE_MIN_PASS_IN_WINDOW" -gt "$MAX_PASS_SINGLE_FOLD" ]; then
    if [ "$PROMOTE_INFEASIBLE_POLICY" = "fail" ]; then
      echo "[stepd_locked_loop] infeasible promote combination for rotating fold: minPass($PROMOTE_MIN_PASS_IN_WINDOW) > maxPerFoldInWindow($MAX_PASS_SINGLE_FOLD), window=$PROMOTE_WINDOW_ROUNDS foldMod=$STEPD_EVAL_FOLD_MOD"
      exit 1
    fi
    PROMOTE_MIN_PASS_IN_WINDOW="$MAX_PASS_SINGLE_FOLD"
    PRECHECK_NOTES+=("auto:minPassToPerFoldMax")
  fi
fi

if [ ! -f "$PROMOTED_HASH_FILE" ]; then
  echo '{"hash":"","iteration":0,"updatedAt":null}' > "$PROMOTED_HASH_FILE"
fi
if [ ! -f "$WINDOW_PASS_FILE" ]; then
  echo '{"passes":[],"updatedAt":null}' > "$WINDOW_PASS_FILE"
fi
if [ ! -f "$FOLD_METRICS_FILE" ]; then
  echo '{"folds":{},"updatedAt":null}' > "$FOLD_METRICS_FILE"
fi
if [ ! -f "$HOLD_STREAK_FILE" ]; then
  echo "0" > "$HOLD_STREAK_FILE"
fi

if [ ! -f "$WEIGHTS_SEED" ]; then
  if [ -f "$BASELINE_DIR/step-d/champion_weights.json" ]; then
    cp -f "$BASELINE_DIR/step-d/champion_weights.json" "$WEIGHTS_SEED"
  elif [ -f "$BASELINE_DIR/step-d/weights_final.json" ]; then
    cp -f "$BASELINE_DIR/step-d/weights_final.json" "$WEIGHTS_SEED"
  else
    echo "[stepd_locked_loop] seed weights missing in baseline step-d"
    exit 1
  fi
fi
cp -f "$WEIGHTS_SEED" "$WEIGHTS_TRIAL"

{
  echo "loopTag=$LOOP_TAG"
  echo "baseline=$BASELINE_DIR"
  echo "statusFile=$STATUS_FILE"
  echo "promoteMinPicked=$PROMOTE_MIN_PICKED"
  echo "promoteMaxPicked=$PROMOTE_MAX_PICKED"
  echo "promoteMaxTwoPickDays=$PROMOTE_MAX_TWO_PICK_DAYS"
  echo "promoteMinHitDelta=$PROMOTE_MIN_HIT_DELTA"
  echo "promoteMinLcbDelta=$PROMOTE_MIN_LCB_DELTA"
  echo "promoteMinConversion=$PROMOTE_MIN_CONVERSION"
  echo "promoteMinBudgetedConversion80=$PROMOTE_MIN_BUDGETED_CONVERSION80"
  echo "promoteMaxRankLossAvgEval=$PROMOTE_MAX_RANKLOSS_AVG_EVAL"
  echo "promoteMaxLookaheadViolations=$PROMOTE_MAX_LOOKAHEAD_VIOLATIONS"
  echo "promoteTieBand=$PROMOTE_TIE_BAND"
  echo "promoteAbsHitFloor=$PROMOTE_ABS_HIT_FLOOR"
  echo "promoteAbsLcbFloor=$PROMOTE_ABS_LCB_FLOOR"
  echo "promoteWindowRounds=$PROMOTE_WINDOW_ROUNDS"
  echo "promoteMinPassInWindow=$PROMOTE_MIN_PASS_IN_WINDOW"
  echo "promoteSeedHashCooldownRounds=$PROMOTE_SEED_HASH_COOLDOWN_ROUNDS"
  echo "promoteMaxScoreMs=$PROMOTE_MAX_SCORE_MS"
  echo "promoteMaxScoreRegression=$PROMOTE_MAX_SCORE_REGRESSION"
  echo "promoteAggMode=$PROMOTE_AGG_MODE"
  echo "promotePoolMinFolds=$PROMOTE_POOL_MIN_FOLDS"
  echo "promoteInfeasiblePolicy=$PROMOTE_INFEASIBLE_POLICY"
  echo "rollbackRejectStreak=$ROLLBACK_REJECT_STREAK"
  echo "holdChampionStreakCap=$HOLD_CHAMPION_STREAK_CAP"
  echo "stepdEvalFoldMod=$STEPD_EVAL_FOLD_MOD"
  echo "keepRunDirs=$KEEP_RUN_DIRS"
  echo "stepdGeneralizationEnabled=${STEPD_GENERALIZATION_ENABLED:-true}"
  echo "stepdGeneralizationMode=${STEPD_GENERALIZATION_MODE:-chronological}"
  echo "promotionScope=${STEPD_PROMOTION_SCOPE}"
  echo "useEvalForPromotion=$USE_EVAL_FOR_PROMOTION"
  if [ "$USE_EVAL_FOR_PROMOTION" = true ]; then
    echo "promotionMetricScope=eval"
  else
    echo "promotionMetricScope=all"
  fi
  echo "stepdAdaptiveMinFinalEnabled=${STEPD_ADAPTIVE_MINFINAL_ENABLED:-true}"
  echo "stepdTargetMinPicked=${STEPD_TARGET_MIN_PICKED:-60}"
  echo "stepdTargetMaxPicked=${STEPD_TARGET_MAX_PICKED:-80}"
  if [ "${#PRECHECK_NOTES[@]}" -gt 0 ]; then
    echo "precheckNotes=$(IFS=,; echo "${PRECHECK_NOTES[*]}")"
  else
    echo "precheckNotes=none"
  fi
} > "$RUNTIME_NOTE"

ln -sfn "$STATUS_FILE" "$LATEST_LINK"

score_jq='(if ((.pickedCount // 0) >= 60 and (.pickedCount // 0) <= 80) then 100000 else 0 end)
          + ((.pickHitRate // 0) * 1000)
          + (((.budgetedConversion80 // .top1ToOracleConversion // 0)) * 100)
          + ((.pickedCount // 0) / 1000)'

ITER=0
while true; do
  REJECT_STREAK=0
  if [ -f "$REJECT_STREAK_FILE" ]; then
    REJECT_STREAK=$(cat "$REJECT_STREAK_FILE" 2>/dev/null || echo 0)
  fi
  if ! [[ "$REJECT_STREAK" =~ ^[0-9]+$ ]]; then
    REJECT_STREAK=0
  fi
  HOLD_STREAK=0
  if [ -f "$HOLD_STREAK_FILE" ]; then
    HOLD_STREAK=$(cat "$HOLD_STREAK_FILE" 2>/dev/null || echo 0)
  fi
  if ! [[ "$HOLD_STREAK" =~ ^[0-9]+$ ]]; then
    HOLD_STREAK=0
  fi

  ITER=$((ITER + 1))
  ITER_PAD=$(printf "%03d" "$ITER")
  RUN_ID="stepd_locked_${LOOP_TAG}_i${ITER_PAD}"

  EVAL_FOLD_MOD_SAFE=$STEPD_EVAL_FOLD_MOD
  if ! [[ "$EVAL_FOLD_MOD_SAFE" =~ ^[0-9]+$ ]] || [ "$EVAL_FOLD_MOD_SAFE" -lt 1 ]; then
    EVAL_FOLD_MOD_SAFE=3
  fi
  STEPD_EVAL_FOLD_OFFSET_VAL=$((ITER % EVAL_FOLD_MOD_SAFE))

  cp -f "$WEIGHTS_SEED" "$WEIGHTS_TRIAL"

  RESULT_JSON=$(
    RUN_ID="$RUN_ID" \
    START_WEIGHTS_PATH="$WEIGHTS_TRIAL" \
    STEPD_TOPK="${STEPD_TOPK:-40}" \
    STEPD_COARSE_TOPN="${STEPD_COARSE_TOPN:-160}" \
    STEPD_COARSE_TOPCLUSTERS="${STEPD_COARSE_TOPCLUSTERS:-10}" \
    STEPD_WORKERS="${STEPD_WORKERS:-2}" \
    STEPD_CHUNK="${STEPD_CHUNK:-384}" \
    STEPD_REUSE_RUNTIME_CACHE="${STEPD_REUSE_RUNTIME_CACHE:-true}" \
    STEPD_LEARNING_RATE="${STEPD_LEARNING_RATE:-}" \
    STEPD_REINFORCE_BETA="${STEPD_REINFORCE_BETA:-}" \
    STEPD_WEIGHT_FLOOR="${STEPD_WEIGHT_FLOOR:-0.02}" \
    STEPD_MIN_FINAL_SCORE="${STEPD_MIN_FINAL_SCORE:-}" \
    STEPD_TARGET_PICKED="${STEPD_TARGET_PICKED:-}" \
    STEPD_MIN_EXPECTED_NET_RET3D="${STEPD_MIN_EXPECTED_NET_RET3D:-}" \
    STEPD_GENERALIZATION_ENABLED="${STEPD_GENERALIZATION_ENABLED:-true}" \
    STEPD_GENERALIZATION_MODE="${STEPD_GENERALIZATION_MODE:-chronological}" \
    STEPD_UPDATE_RATIO="${STEPD_UPDATE_RATIO:-0.7}" \
    STEPD_EVAL_MIN_DAYS="${STEPD_EVAL_MIN_DAYS:-20}" \
    STEPD_EVAL_FOLD_OFFSET="$STEPD_EVAL_FOLD_OFFSET_VAL" \
    STEPD_PROMOTION_SCOPE="${STEPD_PROMOTION_SCOPE:-update}" \
    STEPD_USE_EVAL_FOR_PROMOTION="${STEPD_USE_EVAL_FOR_PROMOTION:-false}" \
    STEPD_PAIRWISE_ENABLED="${STEPD_PAIRWISE_ENABLED:-true}" \
    STEPD_PAIRWISE_POSITIVE_TOPN="${STEPD_PAIRWISE_POSITIVE_TOPN:-3}" \
    STEPD_PAIRWISE_NEGATIVE_TOPN="${STEPD_PAIRWISE_NEGATIVE_TOPN:-5}" \
    STEPD_PAIRWISE_WEIGHT="${STEPD_PAIRWISE_WEIGHT:-0.8}" \
    STEPD_HARD_NEGATIVE_WEIGHT="${STEPD_HARD_NEGATIVE_WEIGHT:-1.0}" \
    STEPD_ADAPTIVE_MINFINAL_ENABLED="${STEPD_ADAPTIVE_MINFINAL_ENABLED:-true}" \
    STEPD_TARGET_MIN_PICKED="${STEPD_TARGET_MIN_PICKED:-60}" \
    STEPD_TARGET_MAX_PICKED="${STEPD_TARGET_MAX_PICKED:-80}" \
    STEPD_ADAPTIVE_STEP="${STEPD_ADAPTIVE_STEP:-0.003}" \
    STEPD_ADAPTIVE_HYSTERESIS="${STEPD_ADAPTIVE_HYSTERESIS:-2}" \
    STEPD_ADAPTIVE_WARMUP_DAYS="${STEPD_ADAPTIVE_WARMUP_DAYS:-8}" \
    STEPD_MAX_PICKED_PROMOTION="${STEPD_MAX_PICKED_PROMOTION:-80}" \
    STEPD_MAX_TWOPICK_PROMOTION="${STEPD_MAX_TWOPICK_PROMOTION:-0}" \
    STEPD_PRUNE_HEAVY="${STEPD_PRUNE_HEAVY:-true}" \
    STEPD_CLEANUP_RUN="${STEPD_CLEANUP_RUN:-true}" \
    /home/moltook/apps/stockdesk-lab-lite/tools/stepd_locked_once.sh "$ROOT_DIR" || true
  )

  if [ -z "$RESULT_JSON" ]; then
    RESULT_JSON='{"status":"error","reason":"empty_result"}'
  fi

  STATUS=$(echo "$RESULT_JSON" | jq -r '.status // "error"')
  PROMOTION_REASON="ok"
  PROMOTED=false
  ROLLBACK_APPLIED=false
  NEUTRAL_HOLD=false
  FORCE_REBUILD_C=false

  PICKED=0
  PICK_HITS=0
  HITRATE=0
  ORACLE=0
  SCOREMS=0
  TWOPICK=0
  LCB95=0
  CONVERSION=0
  LEGACY_CONVERSION=0
  RANKLOSS_EVAL=0
  LOOKAHEAD_VIOLATIONS=0
  EXEC_COUNT=0
  EXEC_HITRATE=0
  EXEC_LCB95=0
  EXEC_COVERAGE=0

  PROMO_PICKED=0
  PROMO_HITS=0
  PROMO_HIT=0
  PROMO_LCB95=0
  PROMO_CONVERSION=0
  PROMO_LEGACY_CONVERSION=0
  PROMO_SCOREMS=0
  PROMO_RANKLOSS_EVAL=0
  PROMO_LOOKAHEAD_VIOLATIONS=0
  PROMOTION_VIEW_SOURCE="RAW"
  PROMOTION_POOL_FOLD_COUNT=0
  PROMOTION_POOL_CANDIDATE_PASS_COUNT=0

  REF_HIT=0
  REF_LCB95=0
  REF_CONVERSION=0
  REF_LEGACY_CONVERSION=0
  REF_RANKLOSS_EVAL=0
  REF_LOOKAHEAD_VIOLATIONS=0
  REF_SCOREMS=0
  DELTA=0
  LCB_DELTA=0
  CONVERSION_DELTA=0
  SCORE_REGRESSION=0

  CANDIDATE_HASH=""
  CANDIDATE_PASS=false
  WINDOW_PASS_COUNT=0

  SAMPLE_OK=false
  DISTRIBUTION_OK=false
  LCB_OK=false
  CONVERSION_OK=false
  RANKLOSS_OK=false
  LOOKAHEAD_OK=false
  SPEED_OK=false

  if [ "$STATUS" = "ok" ]; then
    SUMMARY_PATH=$(echo "$RESULT_JSON" | jq -r '.summaryPath // ""')
    WEIGHTS_PATH=$(echo "$RESULT_JSON" | jq -r '.weightsPath // ""')

    if [ -n "$SUMMARY_PATH" ] && [ -f "$SUMMARY_PATH" ]; then
      if [ "$USE_EVAL_FOR_PROMOTION" = true ]; then
        PICKED=$(jq -r '.pickedCountEval // .pickedCount // 0' "$SUMMARY_PATH")
        PICK_HITS=$(jq -r '.pickHitCountEval // .pickHitCount // 0' "$SUMMARY_PATH")
        HITRATE=$(jq -r '.pickHitRateEval // .pickHitRate // 0' "$SUMMARY_PATH")
        ORACLE=$(jq -r '.oracleHitRateTopKEval // .oracleHitRateTopK // 0' "$SUMMARY_PATH")
        SCOREMS=$(jq -r '.workerPoolScoreMsEval // .workerPoolScoreMs // 0' "$SUMMARY_PATH")
        TWOPICK=$(jq -r '.twoPickDaysEval // .twoPickDays // 0' "$SUMMARY_PATH")
        LCB95=$(jq -r '.pickHitRateEvalLcb95 // .pickHitRateLcb95 // 0' "$SUMMARY_PATH")
        CONVERSION=$(jq -r '.budgetedConversion80Eval // .budgetedConversion80 // 0' "$SUMMARY_PATH")
        LEGACY_CONVERSION=$(jq -r '.top1ToOracleConversionEval // .top1ToOracleConversion // 0' "$SUMMARY_PATH")
        RANKLOSS_EVAL=$(jq -r '.rankLossAvgEval // .rankLossAvg // 0' "$SUMMARY_PATH")
        LOOKAHEAD_VIOLATIONS=$(jq -r '.lookaheadViolationsEval // .lookaheadViolations // 0' "$SUMMARY_PATH")
        EXEC_COUNT=$(jq -r '.executedCountEval // .executedCount // 0' "$SUMMARY_PATH")
        EXEC_HITRATE=$(jq -r '.executedHitRateEval // .executedHitRate // 0' "$SUMMARY_PATH")
        EXEC_LCB95=$(jq -r '.executedHitRateEvalLcb95 // .executedHitRateLcb95 // 0' "$SUMMARY_PATH")
        EXEC_COVERAGE=$(jq -r '.executionCoverageEval // .executionCoverage // 0' "$SUMMARY_PATH")
      else
        PICKED=$(jq -r '.pickedCount // .pickedCountEval // 0' "$SUMMARY_PATH")
        PICK_HITS=$(jq -r '.pickHitCount // .pickHitCountEval // 0' "$SUMMARY_PATH")
        HITRATE=$(jq -r '.pickHitRate // .pickHitRateEval // 0' "$SUMMARY_PATH")
        ORACLE=$(jq -r '.oracleHitRateTopK // .oracleHitRateTopKEval // 0' "$SUMMARY_PATH")
        SCOREMS=$(jq -r '.workerPoolScoreMs // .workerPoolScoreMsEval // 0' "$SUMMARY_PATH")
        TWOPICK=$(jq -r '.twoPickDays // .twoPickDaysEval // 0' "$SUMMARY_PATH")
        LCB95=$(jq -r '.pickHitRateLcb95 // .pickHitRateEvalLcb95 // 0' "$SUMMARY_PATH")
        CONVERSION=$(jq -r '.budgetedConversion80 // .budgetedConversion80Eval // 0' "$SUMMARY_PATH")
        LEGACY_CONVERSION=$(jq -r '.top1ToOracleConversion // .top1ToOracleConversionEval // 0' "$SUMMARY_PATH")
        RANKLOSS_EVAL=$(jq -r '.rankLossAvg // .rankLossAvgEval // 0' "$SUMMARY_PATH")
        LOOKAHEAD_VIOLATIONS=$(jq -r '.lookaheadViolations // .lookaheadViolationsEval // 0' "$SUMMARY_PATH")
        EXEC_COUNT=$(jq -r '.executedCount // .executedCountEval // 0' "$SUMMARY_PATH")
        EXEC_HITRATE=$(jq -r '.executedHitRate // .executedHitRateEval // 0' "$SUMMARY_PATH")
        EXEC_LCB95=$(jq -r '.executedHitRateLcb95 // .executedHitRateEvalLcb95 // 0' "$SUMMARY_PATH")
        EXEC_COVERAGE=$(jq -r '.executionCoverage // .executionCoverageEval // 0' "$SUMMARY_PATH")
      fi
    else
      if [ "$USE_EVAL_FOR_PROMOTION" = true ]; then
        PICKED=$(echo "$RESULT_JSON" | jq -r '.pickedCountEval // .pickedCount // 0')
        PICK_HITS=$(echo "$RESULT_JSON" | jq -r '.pickHitCountEval // .pickHitCount // 0')
        HITRATE=$(echo "$RESULT_JSON" | jq -r '.pickHitRateEval // .pickHitRate // 0')
        ORACLE=$(echo "$RESULT_JSON" | jq -r '.oracleHitRateTopKEval // .oracleHitRateTopK // 0')
        SCOREMS=$(echo "$RESULT_JSON" | jq -r '.workerPoolScoreMsEval // .workerPoolScoreMs // 0')
        TWOPICK=$(echo "$RESULT_JSON" | jq -r '.twoPickDaysEval // .twoPickDays // 0')
        LCB95=$(echo "$RESULT_JSON" | jq -r '.pickHitRateEvalLcb95 // .pickHitRateLcb95 // 0')
        CONVERSION=$(echo "$RESULT_JSON" | jq -r '.budgetedConversion80Eval // .budgetedConversion80 // 0')
        LEGACY_CONVERSION=$(echo "$RESULT_JSON" | jq -r '.top1ToOracleConversionEval // .top1ToOracleConversion // 0')
        RANKLOSS_EVAL=$(echo "$RESULT_JSON" | jq -r '.rankLossAvgEval // .rankLossAvg // 0')
        LOOKAHEAD_VIOLATIONS=$(echo "$RESULT_JSON" | jq -r '.lookaheadViolationsEval // .lookaheadViolations // 0')
        EXEC_COUNT=$(echo "$RESULT_JSON" | jq -r '.executedCountEval // .executedCount // 0')
        EXEC_HITRATE=$(echo "$RESULT_JSON" | jq -r '.executedHitRateEval // .executedHitRate // 0')
        EXEC_LCB95=$(echo "$RESULT_JSON" | jq -r '.executedHitRateEvalLcb95 // .executedHitRateLcb95 // 0')
        EXEC_COVERAGE=$(echo "$RESULT_JSON" | jq -r '.executionCoverageEval // .executionCoverage // 0')
      else
        PICKED=$(echo "$RESULT_JSON" | jq -r '.pickedCount // .pickedCountEval // 0')
        PICK_HITS=$(echo "$RESULT_JSON" | jq -r '.pickHitCount // .pickHitCountEval // 0')
        HITRATE=$(echo "$RESULT_JSON" | jq -r '.pickHitRate // .pickHitRateEval // 0')
        ORACLE=$(echo "$RESULT_JSON" | jq -r '.oracleHitRateTopK // .oracleHitRateTopKEval // 0')
        SCOREMS=$(echo "$RESULT_JSON" | jq -r '.workerPoolScoreMs // .workerPoolScoreMsEval // 0')
        TWOPICK=$(echo "$RESULT_JSON" | jq -r '.twoPickDays // .twoPickDaysEval // 0')
        LCB95=$(echo "$RESULT_JSON" | jq -r '.pickHitRateLcb95 // .pickHitRateEvalLcb95 // 0')
        CONVERSION=$(echo "$RESULT_JSON" | jq -r '.budgetedConversion80 // .budgetedConversion80Eval // 0')
        LEGACY_CONVERSION=$(echo "$RESULT_JSON" | jq -r '.top1ToOracleConversion // .top1ToOracleConversionEval // 0')
        RANKLOSS_EVAL=$(echo "$RESULT_JSON" | jq -r '.rankLossAvg // .rankLossAvgEval // 0')
        LOOKAHEAD_VIOLATIONS=$(echo "$RESULT_JSON" | jq -r '.lookaheadViolations // .lookaheadViolationsEval // 0')
        EXEC_COUNT=$(echo "$RESULT_JSON" | jq -r '.executedCount // .executedCountEval // 0')
        EXEC_HITRATE=$(echo "$RESULT_JSON" | jq -r '.executedHitRate // .executedHitRateEval // 0')
        EXEC_LCB95=$(echo "$RESULT_JSON" | jq -r '.executedHitRateLcb95 // .executedHitRateEvalLcb95 // 0')
        EXEC_COVERAGE=$(echo "$RESULT_JSON" | jq -r '.executionCoverage // .executionCoverageEval // 0')
      fi
    fi

    PROMO_PICKED="$PICKED"
    PROMO_HITS="$PICK_HITS"
    PROMO_HIT="$HITRATE"
    PROMO_LCB95="$LCB95"
    PROMO_CONVERSION="$CONVERSION"
    PROMO_LEGACY_CONVERSION="$LEGACY_CONVERSION"
    PROMO_SCOREMS="$SCOREMS"
    PROMO_RANKLOSS_EVAL="$RANKLOSS_EVAL"
    PROMO_LOOKAHEAD_VIOLATIONS="$LOOKAHEAD_VIOLATIONS"

    if [ "$PROMOTE_AGG_MODE" = "fold_pool" ]; then
      TMP_FOLD="$FOLD_METRICS_FILE.tmp"
      jq \
        --arg fold "$STEPD_EVAL_FOLD_OFFSET_VAL" \
        --arg runId "$RUN_ID" \
        --argjson iteration "$ITER" \
        --argjson pickedCount "$PICKED" \
        --argjson pickHitCount "$PICK_HITS" \
        --argjson pickHitRate "$HITRATE" \
        --argjson pickHitRateLcb95 "$LCB95" \
        --argjson budgetedConversion80 "$CONVERSION" \
        --argjson top1ToOracleConversion "$LEGACY_CONVERSION" \
        --argjson workerPoolScoreMs "$SCOREMS" \
        --argjson rankLossAvgEval "$RANKLOSS_EVAL" \
        --argjson lookaheadViolations "$LOOKAHEAD_VIOLATIONS" \
        '.folds[$fold]={iteration:$iteration,runId:$runId,pickedCount:$pickedCount,pickHitCount:$pickHitCount,pickHitRate:$pickHitRate,pickHitRateLcb95:$pickHitRateLcb95,budgetedConversion80:$budgetedConversion80,top1ToOracleConversion:$top1ToOracleConversion,workerPoolScoreMs:$workerPoolScoreMs,rankLossAvgEval:$rankLossAvgEval,lookaheadViolations:$lookaheadViolations,candidatePass:(.folds[$fold].candidatePass // false),updatedAt:(now|todate)} | .updatedAt=(now|todate)' \
        "$FOLD_METRICS_FILE" > "$TMP_FOLD" || \
      jq -n \
        --arg fold "$STEPD_EVAL_FOLD_OFFSET_VAL" \
        --arg runId "$RUN_ID" \
        --argjson iteration "$ITER" \
        --argjson pickedCount "$PICKED" \
        --argjson pickHitCount "$PICK_HITS" \
        --argjson pickHitRate "$HITRATE" \
        --argjson pickHitRateLcb95 "$LCB95" \
        --argjson budgetedConversion80 "$CONVERSION" \
        --argjson top1ToOracleConversion "$LEGACY_CONVERSION" \
        --argjson workerPoolScoreMs "$SCOREMS" \
        --argjson rankLossAvgEval "$RANKLOSS_EVAL" \
        --argjson lookaheadViolations "$LOOKAHEAD_VIOLATIONS" \
        '{folds:{($fold):{iteration:$iteration,runId:$runId,pickedCount:$pickedCount,pickHitCount:$pickHitCount,pickHitRate:$pickHitRate,pickHitRateLcb95:$pickHitRateLcb95,budgetedConversion80:$budgetedConversion80,top1ToOracleConversion:$top1ToOracleConversion,workerPoolScoreMs:$workerPoolScoreMs,rankLossAvgEval:$rankLossAvgEval,lookaheadViolations:$lookaheadViolations,candidatePass:false,updatedAt:(now|todate)}},updatedAt:(now|todate)}' > "$TMP_FOLD"
      mv -f "$TMP_FOLD" "$FOLD_METRICS_FILE"

      POOL_JSON=$(jq -c '
        [.folds[]?] as $rows
        | ($rows | length) as $foldCount
        | ($rows | map(.pickedCount // 0) | add // 0) as $picked
        | ($rows | map(.pickHitCount // 0) | add // 0) as $hits
        | ($rows | map(((.budgetedConversion80 // 0) * (.pickedCount // 0))) | add // 0) as $budgetConvWeighted
        | ($rows | map(((.top1ToOracleConversion // 0) * (.pickedCount // 0))) | add // 0) as $legacyConvWeighted
        | ($rows | map(.workerPoolScoreMs // 0) | add // 0) as $scoreSum
        | ($rows | map(.rankLossAvgEval // 0) | add // 0) as $rankLossSum
        | ($rows | map(.lookaheadViolations // 0) | add // 0) as $lookaheadSum
        | ($rows | map(if (.candidatePass // false) then 1 else 0 end) | add // 0) as $candidatePassCount
        | {
            foldCount: $foldCount,
            pickedCount: $picked,
            pickedCountMean: (if $foldCount > 0 then ($picked / $foldCount) else 0 end),
            pickHitCount: $hits,
            pickHitRate: (if $picked > 0 then ($hits / $picked) else 0 end),
            budgetedConversion80: (if $picked > 0 then ($budgetConvWeighted / $picked) else 0 end),
            top1ToOracleConversion: (if $picked > 0 then ($legacyConvWeighted / $picked) else 0 end),
            workerPoolScoreMs: (if $foldCount > 0 then ($scoreSum / $foldCount) else 0 end),
            rankLossAvgEval: (if $foldCount > 0 then ($rankLossSum / $foldCount) else 0 end),
            lookaheadViolations: $lookaheadSum,
            candidatePassCount: $candidatePassCount
          }
      ' "$FOLD_METRICS_FILE")

      PROMOTION_POOL_FOLD_COUNT=$(echo "$POOL_JSON" | jq -r '.foldCount // 0')
      PROMOTION_POOL_CANDIDATE_PASS_COUNT=$(echo "$POOL_JSON" | jq -r '.candidatePassCount // 0')

      if [ "$PROMOTION_POOL_FOLD_COUNT" -ge "$PROMOTE_POOL_MIN_FOLDS" ]; then
        PROMOTION_VIEW_SOURCE="POOLED_FOLD"
        PROMO_PICKED_TOTAL=$(echo "$POOL_JSON" | jq -r '.pickedCount // 0')
        PROMO_PICKED=$(echo "$POOL_JSON" | jq -r '.pickedCountMean // 0')
        PROMO_HITS=$(echo "$POOL_JSON" | jq -r '.pickHitCount // 0')
        PROMO_HIT=$(echo "$POOL_JSON" | jq -r '.pickHitRate // 0')
        PROMO_LCB95=$(awk "BEGIN {k=$PROMO_HITS; n=$PROMO_PICKED_TOTAL; z=1.959963984540054; if (n<=0) {print 0} else {p=k/n; z2=z*z; center=p+z2/(2*n); spread=z*sqrt((p*(1-p)+z2/(4*n))/n); denom=1+z2/n; lb=(center-spread)/denom; if (lb<0) lb=0; if (lb>1) lb=1; print lb}}")
        PROMO_CONVERSION=$(echo "$POOL_JSON" | jq -r '.budgetedConversion80 // 0')
        PROMO_LEGACY_CONVERSION=$(echo "$POOL_JSON" | jq -r '.top1ToOracleConversion // 0')
        PROMO_SCOREMS=$(echo "$POOL_JSON" | jq -r '.workerPoolScoreMs // 0')
        PROMO_RANKLOSS_EVAL=$(echo "$POOL_JSON" | jq -r '.rankLossAvgEval // 0')
        PROMO_LOOKAHEAD_VIOLATIONS=$(echo "$POOL_JSON" | jq -r '.lookaheadViolations // 0')
      fi
    fi

    if [ -f "$ACCEPTED_FILE" ]; then
      REF_HIT=$(jq -r '.pickHitRate // 0' "$ACCEPTED_FILE")
      REF_LCB95=$(jq -r '.pickHitRateLcb95 // 0' "$ACCEPTED_FILE")
      REF_CONVERSION=$(jq -r '.budgetedConversion80 // 0' "$ACCEPTED_FILE")
      REF_LEGACY_CONVERSION=$(jq -r '.top1ToOracleConversion // 0' "$ACCEPTED_FILE")
      REF_RANKLOSS_EVAL=$(jq -r '.rankLossAvgEval // 0' "$ACCEPTED_FILE")
      REF_LOOKAHEAD_VIOLATIONS=$(jq -r '.lookaheadViolations // 0' "$ACCEPTED_FILE")
      REF_SCOREMS=$(jq -r '.workerPoolScoreMs // 0' "$ACCEPTED_FILE")
    fi

    DELTA=$(awk "BEGIN {print $PROMO_HIT - $REF_HIT}")
    LCB_DELTA=$(awk "BEGIN {print $PROMO_LCB95 - $REF_LCB95}")
    CONVERSION_DELTA=$(awk "BEGIN {print $PROMO_CONVERSION - $REF_CONVERSION}")
    if awk "BEGIN { exit !($REF_SCOREMS > 0) }"; then
      SCORE_REGRESSION=$(awk "BEGIN {print ($PROMO_SCOREMS - $REF_SCOREMS) / $REF_SCOREMS}")
    else
      SCORE_REGRESSION=0
    fi

    if awk "BEGIN { exit !($PROMO_PICKED >= $PROMOTE_MIN_PICKED && $PROMO_PICKED <= $PROMOTE_MAX_PICKED) }"; then
      SAMPLE_OK=true
    fi
    if awk "BEGIN { exit !($TWOPICK <= $PROMOTE_MAX_TWO_PICK_DAYS) }"; then
      DISTRIBUTION_OK=true
    fi
    if awk "BEGIN { exit !(($PROMO_HIT >= $PROMOTE_ABS_HIT_FLOOR) && ($PROMO_LCB95 >= $PROMOTE_ABS_LCB_FLOOR)) }"; then
      LCB_OK=true
    fi
    if awk "BEGIN { exit !($PROMO_CONVERSION >= $PROMOTE_MIN_BUDGETED_CONVERSION80) }"; then
      CONVERSION_OK=true
    fi
    if awk "BEGIN { exit !($PROMO_RANKLOSS_EVAL <= $PROMOTE_MAX_RANKLOSS_AVG_EVAL) }"; then
      RANKLOSS_OK=true
    fi
    if awk "BEGIN { exit !($PROMO_LOOKAHEAD_VIOLATIONS <= $PROMOTE_MAX_LOOKAHEAD_VIOLATIONS) }"; then
      LOOKAHEAD_OK=true
    fi

    SPEED_ABS_OK=false
    SPEED_REG_OK=false
    if awk "BEGIN { exit !($PROMO_SCOREMS <= $PROMOTE_MAX_SCORE_MS) }"; then
      SPEED_ABS_OK=true
    fi
    if [ -f "$ACCEPTED_FILE" ]; then
      if awk "BEGIN { exit !($SCORE_REGRESSION <= $PROMOTE_MAX_SCORE_REGRESSION) }"; then
        SPEED_REG_OK=true
      fi
    else
      SPEED_REG_OK=true
    fi
    if [ "$SPEED_ABS_OK" = true ] && [ "$SPEED_REG_OK" = true ]; then
      SPEED_OK=true
    fi

    if [ "$SAMPLE_OK" = true ] && [ "$DISTRIBUTION_OK" = true ] && [ "$LCB_OK" = true ] && [ "$CONVERSION_OK" = true ] && [ "$RANKLOSS_OK" = true ] && [ "$LOOKAHEAD_OK" = true ] && [ "$SPEED_OK" = true ]; then
      CANDIDATE_PASS=true
    fi

    if [ "$PROMOTE_AGG_MODE" = "fold_pool" ]; then
      TMP_FOLD_PASS="$FOLD_METRICS_FILE.tmp"
      jq --arg fold "$STEPD_EVAL_FOLD_OFFSET_VAL" --argjson candidatePass "$CANDIDATE_PASS" '.folds[$fold].candidatePass=$candidatePass | .updatedAt=(now|todate)' "$FOLD_METRICS_FILE" > "$TMP_FOLD_PASS" && mv -f "$TMP_FOLD_PASS" "$FOLD_METRICS_FILE"
    fi

    if [ -f "$WINDOW_PASS_FILE" ]; then
      WINDOW_PASS_COUNT=$(jq -r '[.passes[]?] | add // 0' "$WINDOW_PASS_FILE" 2>/dev/null || echo 0)
    fi
    if ! [[ "$WINDOW_PASS_COUNT" =~ ^[0-9]+$ ]]; then
      WINDOW_PASS_COUNT=0
    fi

    ELIGIBLE=true
    if [ "$SAMPLE_OK" = false ]; then
      ELIGIBLE=false
      PROMOTION_REASON="picked_out_of_range"
    fi
    if [ "$ELIGIBLE" = true ] && [ "$DISTRIBUTION_OK" = false ]; then
      ELIGIBLE=false
      PROMOTION_REASON="two_pick_days_exceeded"
    fi
    if [ "$ELIGIBLE" = true ] && [ "$LCB_OK" = false ]; then
      ELIGIBLE=false
      PROMOTION_REASON="hit_or_lcb_floor_below_abs"
    fi
    if [ "$ELIGIBLE" = true ] && [ "$CONVERSION_OK" = false ]; then
      ELIGIBLE=false
      PROMOTION_REASON="budgeted_conversion80_below_min"
    fi
    if [ "$ELIGIBLE" = true ] && [ "$RANKLOSS_OK" = false ]; then
      ELIGIBLE=false
      PROMOTION_REASON="rankloss_above_cap"
    fi
    if [ "$ELIGIBLE" = true ] && [ "$LOOKAHEAD_OK" = false ]; then
      ELIGIBLE=false
      PROMOTION_REASON="lookahead_violations"
    fi
    if [ "$ELIGIBLE" = true ] && [ "$SPEED_OK" = false ]; then
      ELIGIBLE=false
      if awk "BEGIN { exit !($SCOREMS > $PROMOTE_MAX_SCORE_MS) }"; then
        PROMOTION_REASON="score_ms_too_slow"
      else
        PROMOTION_REASON="score_ms_regressed"
      fi
    fi
    if [ "$ELIGIBLE" = true ] && [ -f "$ACCEPTED_FILE" ] && \
      awk "BEGIN { exit !(($DELTA < $PROMOTE_MIN_HIT_DELTA) && ($LCB_DELTA < $PROMOTE_MIN_LCB_DELTA)) }"; then
      ELIGIBLE=false
      PROMOTION_REASON="hit_lcb_delta_below_min"
    fi

    IS_TIE=false
    if [ -f "$ACCEPTED_FILE" ] && \
      awk "BEGIN { d=$DELTA; l=$LCB_DELTA; t=$PROMOTE_TIE_BAND; exit !((d <= t && d >= -t) && (l <= t && l >= -t)) }"; then
      IS_TIE=true
    fi

    if [ "$ELIGIBLE" = false ] && [ "$PROMOTION_REASON" = "hit_lcb_delta_below_min" ] && [ "$IS_TIE" = true ] && [ "$CANDIDATE_PASS" = true ]; then
      NEUTRAL_HOLD=true
      PROMOTION_REASON="tie_keep_seed"
    fi

    if [ "$ELIGIBLE" = true ] && [ "$PROMOTE_WINDOW_ROUNDS" -gt 1 ]; then
      CUR_PASS=0
      if [ "$CANDIDATE_PASS" = true ]; then CUR_PASS=1; fi
      WINDOW_PASS_TOTAL=$((WINDOW_PASS_COUNT + CUR_PASS))
      if [ "$WINDOW_PASS_TOTAL" -lt "$PROMOTE_MIN_PASS_IN_WINDOW" ]; then
        ELIGIBLE=false
        PROMOTION_REASON="window_stability_low"
      fi
    fi

    if [ "$ELIGIBLE" = true ] && [ -n "$WEIGHTS_PATH" ] && [ -f "$WEIGHTS_PATH" ]; then
      CANDIDATE_HASH=$(sha1sum "$WEIGHTS_PATH" | awk '{print $1}')
      LAST_HASH=$(jq -r '.hash // ""' "$PROMOTED_HASH_FILE" 2>/dev/null || echo "")
      LAST_ITER=$(jq -r '.iteration // 0' "$PROMOTED_HASH_FILE" 2>/dev/null || echo 0)
      if ! [[ "$LAST_ITER" =~ ^[0-9]+$ ]]; then LAST_ITER=0; fi
      if [ -n "$CANDIDATE_HASH" ] && [ "$CANDIDATE_HASH" = "$LAST_HASH" ]; then
        DIFF=$((ITER - LAST_ITER))
        if [ "$DIFF" -lt "$PROMOTE_SEED_HASH_COOLDOWN_ROUNDS" ]; then
          ELIGIBLE=false
          PROMOTION_REASON="seed_hash_cooldown"
        fi
      fi
    fi

    if [ "$ELIGIBLE" = true ] && [ -n "$WEIGHTS_PATH" ] && [ -f "$WEIGHTS_PATH" ]; then
      cp -f "$WEIGHTS_PATH" "$WEIGHTS_SEED"
      cp -f "$WEIGHTS_SEED" "$WEIGHTS_TRIAL"

      jq -n \
        --arg runId "$RUN_ID" \
        --arg promotionViewSource "$PROMOTION_VIEW_SOURCE" \
        --argjson pickedCount "$PROMO_PICKED" \
        --argjson pickHitCount "$PROMO_HITS" \
        --argjson pickHitRate "$PROMO_HIT" \
        --argjson pickHitRateLcb95 "$PROMO_LCB95" \
        --argjson top1ToOracleConversion "$PROMO_LEGACY_CONVERSION" \
        --argjson budgetedConversion80 "$PROMO_CONVERSION" \
        --argjson oracleHitRateTopK "$ORACLE" \
        --argjson twoPickDays "$TWOPICK" \
        --argjson workerPoolScoreMs "$PROMO_SCOREMS" \
        --argjson rankLossAvgEval "$PROMO_RANKLOSS_EVAL" \
        --argjson lookaheadViolations "$PROMO_LOOKAHEAD_VIOLATIONS" \
        --argjson deltaVsPrevAccepted "$DELTA" \
        --argjson lcbDeltaVsPrevAccepted "$LCB_DELTA" \
        --argjson conversionDeltaVsPrevAccepted "$CONVERSION_DELTA" \
        --argjson scoreRegressionVsPrevAccepted "$SCORE_REGRESSION" \
        '{runId:$runId,promotionViewSource:$promotionViewSource,pickedCount:$pickedCount,pickHitCount:$pickHitCount,pickHitRate:$pickHitRate,pickHitRateLcb95:$pickHitRateLcb95,budgetedConversion80:$budgetedConversion80,top1ToOracleConversion:$top1ToOracleConversion,oracleHitRateTopK:$oracleHitRateTopK,twoPickDays:$twoPickDays,workerPoolScoreMs:$workerPoolScoreMs,rankLossAvgEval:$rankLossAvgEval,lookaheadViolations:$lookaheadViolations,deltaVsPrevAccepted:$deltaVsPrevAccepted,lcbDeltaVsPrevAccepted:$lcbDeltaVsPrevAccepted,conversionDeltaVsPrevAccepted:$conversionDeltaVsPrevAccepted,scoreRegressionVsPrevAccepted:$scoreRegressionVsPrevAccepted,acceptedAt:(now|todate)}' > "$ACCEPTED_FILE"

      jq -n --arg hash "$CANDIDATE_HASH" --argjson iteration "$ITER" --arg runId "$RUN_ID" '{hash:$hash,iteration:$iteration,runId:$runId,updatedAt:(now|todate)}' > "$PROMOTED_HASH_FILE"

      PROMOTED=true
      PROMOTION_REASON="promoted"
      REJECT_STREAK=0
      HOLD_STREAK=0
      echo "$REJECT_STREAK" > "$REJECT_STREAK_FILE"
      echo "$HOLD_STREAK" > "$HOLD_STREAK_FILE"
    else
      HOLD_EMITTED=false
      if [ "$NEUTRAL_HOLD" = true ]; then
        REJECT_STREAK=0
        HOLD_STREAK=0
      else
        REJECT_STREAK=$((REJECT_STREAK + 1))
        if [ "$REJECT_STREAK" -ge "$ROLLBACK_REJECT_STREAK" ]; then
          PROMOTION_REASON="${PROMOTION_REASON}+hold_champion_seed"
          REJECT_STREAK=0
          HOLD_STREAK=$((HOLD_STREAK + 1))
          HOLD_EMITTED=true
        fi
      fi
      if [ "$HOLD_EMITTED" = false ] && [ "$NEUTRAL_HOLD" = false ]; then
        HOLD_STREAK=0
      fi
      if [ "$HOLD_CHAMPION_STREAK_CAP" -gt 0 ] && [ "$HOLD_STREAK" -ge "$HOLD_CHAMPION_STREAK_CAP" ]; then
        FORCE_REBUILD_C=true
        PROMOTION_REASON="${PROMOTION_REASON}+force_rebuild_c_required"
        HOLD_STREAK=0
      fi
      echo "$REJECT_STREAK" > "$REJECT_STREAK_FILE"
      echo "$HOLD_STREAK" > "$HOLD_STREAK_FILE"
    fi

    RESULT_JSON=$(echo "$RESULT_JSON" | jq \
      --arg promotionViewSource "$PROMOTION_VIEW_SOURCE" \
      --argjson promotionPoolFoldCount "$PROMOTION_POOL_FOLD_COUNT" \
      --argjson promotionPoolCandidatePassCount "$PROMOTION_POOL_CANDIDATE_PASS_COUNT" \
      --argjson pickedCount "$PICKED" \
      --argjson pickHitCount "$PICK_HITS" \
      --argjson pickHitRate "$HITRATE" \
      --argjson oracleHitRateTopK "$ORACLE" \
      --argjson workerPoolScoreMs "$SCOREMS" \
      --argjson twoPickDays "$TWOPICK" \
      --argjson pickHitRateLcb95 "$LCB95" \
      --argjson top1ToOracleConversion "$LEGACY_CONVERSION" \
      --argjson budgetedConversion80 "$CONVERSION" \
      --argjson rankLossAvgEval "$RANKLOSS_EVAL" \
      --argjson lookaheadViolations "$LOOKAHEAD_VIOLATIONS" \
      --argjson executedCount "$EXEC_COUNT" \
      --argjson executedHitRate "$EXEC_HITRATE" \
      --argjson executedHitRateLcb95 "$EXEC_LCB95" \
      --argjson executionCoverage "$EXEC_COVERAGE" \
      --argjson promotionPickedCount "$PROMO_PICKED" \
      --argjson promotionPickHitCount "$PROMO_HITS" \
      --argjson promotionPickHitRate "$PROMO_HIT" \
      --argjson promotionPickHitRateLcb95 "$PROMO_LCB95" \
      --argjson promotionTop1ToOracleConversion "$PROMO_LEGACY_CONVERSION" \
      --argjson promotionBudgetedConversion80 "$PROMO_CONVERSION" \
      --argjson promotionWorkerPoolScoreMs "$PROMO_SCOREMS" \
      --argjson promotionRankLossAvgEval "$PROMO_RANKLOSS_EVAL" \
      --argjson promotionLookaheadViolations "$PROMO_LOOKAHEAD_VIOLATIONS" \
      --arg promoted "$PROMOTED" \
      --arg rollbackApplied "$ROLLBACK_APPLIED" \
      --arg neutralHold "$NEUTRAL_HOLD" \
      --arg forceRebuildC "$FORCE_REBUILD_C" \
      --arg candidatePass "$CANDIDATE_PASS" \
      --arg sampleOk "$SAMPLE_OK" \
      --arg distributionOk "$DISTRIBUTION_OK" \
      --arg lcbOk "$LCB_OK" \
      --arg conversionOk "$CONVERSION_OK" \
      --arg rankLossOk "$RANKLOSS_OK" \
      --arg lookaheadOk "$LOOKAHEAD_OK" \
      --arg speedOk "$SPEED_OK" \
      --argjson rejectStreak "$REJECT_STREAK" \
      --argjson holdChampionSeedStreak "$HOLD_STREAK" \
      --arg promotionReason "$PROMOTION_REASON" \
      --argjson promotionWindowPasses "$WINDOW_PASS_COUNT" \
      --argjson stepdEvalFoldOffset "$STEPD_EVAL_FOLD_OFFSET_VAL" \
      --argjson promoteMinPicked "$PROMOTE_MIN_PICKED" \
      --argjson promoteMaxPicked "$PROMOTE_MAX_PICKED" \
      --argjson promoteMaxTwoPickDays "$PROMOTE_MAX_TWO_PICK_DAYS" \
      --argjson promoteMinHitDelta "$PROMOTE_MIN_HIT_DELTA" \
      --argjson promoteMinLcbDelta "$PROMOTE_MIN_LCB_DELTA" \
      --argjson promoteMinConversion "$PROMOTE_MIN_CONVERSION" \
      --argjson promoteMinBudgetedConversion80 "$PROMOTE_MIN_BUDGETED_CONVERSION80" \
      --argjson promoteMaxRankLossAvgEval "$PROMOTE_MAX_RANKLOSS_AVG_EVAL" \
      --argjson promoteMaxLookaheadViolations "$PROMOTE_MAX_LOOKAHEAD_VIOLATIONS" \
      --argjson promoteAbsHitFloor "$PROMOTE_ABS_HIT_FLOOR" \
      --argjson promoteAbsLcbFloor "$PROMOTE_ABS_LCB_FLOOR" \
      --argjson promoteWindowRounds "$PROMOTE_WINDOW_ROUNDS" \
      --argjson promoteMinPassInWindow "$PROMOTE_MIN_PASS_IN_WINDOW" \
      --argjson promoteHashCooldownRounds "$PROMOTE_SEED_HASH_COOLDOWN_ROUNDS" \
      --argjson promoteMaxScoreMs "$PROMOTE_MAX_SCORE_MS" \
      --argjson promoteMaxScoreRegression "$PROMOTE_MAX_SCORE_REGRESSION" \
      --argjson scoreRegressionVsPrevAccepted "$SCORE_REGRESSION" \
      '.pickedCount=$pickedCount
       | .pickHitCount=$pickHitCount
       | .pickHitRate=$pickHitRate
       | .oracleHitRateTopK=$oracleHitRateTopK
       | .workerPoolScoreMs=$workerPoolScoreMs
       | .twoPickDays=$twoPickDays
       | .pickHitRateLcb95=$pickHitRateLcb95
       | .top1ToOracleConversion=$top1ToOracleConversion
       | .budgetedConversion80=$budgetedConversion80
       | .rankLossAvgEval=$rankLossAvgEval
       | .lookaheadViolations=$lookaheadViolations
       | .executedCount=$executedCount
       | .executedHitRate=$executedHitRate
       | .executedHitRateLcb95=$executedHitRateLcb95
       | .executionCoverage=$executionCoverage
       | .promotionViewSource=$promotionViewSource
       | .promotionPoolFoldCount=$promotionPoolFoldCount
       | .promotionPoolCandidatePassCount=$promotionPoolCandidatePassCount
       | .promotionMetrics={pickedCount:$promotionPickedCount,pickHitCount:$promotionPickHitCount,pickHitRate:$promotionPickHitRate,pickHitRateLcb95:$promotionPickHitRateLcb95,budgetedConversion80:$promotionBudgetedConversion80,top1ToOracleConversion:$promotionTop1ToOracleConversion,workerPoolScoreMs:$promotionWorkerPoolScoreMs,rankLossAvgEval:$promotionRankLossAvgEval,lookaheadViolations:$promotionLookaheadViolations}
       | .weightPromoted=($promoted=="true")
       | .rollbackApplied=($rollbackApplied=="true")
       | .neutralHold=($neutralHold=="true")
       | .forceRebuildC=($forceRebuildC=="true")
       | .candidatePass=($candidatePass=="true")
       | .rejectStreak=$rejectStreak
       | .holdChampionSeedStreak=$holdChampionSeedStreak
       | .promotionReason=$promotionReason
       | .promotionWindowPasses=$promotionWindowPasses
       | .stepdEvalFoldOffset=$stepdEvalFoldOffset
       | .scoreRegressionVsPrevAccepted=$scoreRegressionVsPrevAccepted
       | .promotionChecks={sampleOk:($sampleOk=="true"),distributionOk:($distributionOk=="true"),lcbOk:($lcbOk=="true"),conversionOk:($conversionOk=="true"),rankLossOk:($rankLossOk=="true"),lookaheadOk:($lookaheadOk=="true"),speedOk:($speedOk=="true")}
       | .promotionConstraints={minPicked:$promoteMinPicked,maxPicked:$promoteMaxPicked,maxTwoPickDays:$promoteMaxTwoPickDays,minHitDelta:$promoteMinHitDelta,minLcbDelta:$promoteMinLcbDelta,minConversion:$promoteMinConversion,minBudgetedConversion80:$promoteMinBudgetedConversion80,maxRankLossAvgEval:$promoteMaxRankLossAvgEval,maxLookaheadViolations:$promoteMaxLookaheadViolations,absHitFloor:$promoteAbsHitFloor,absLcbFloor:$promoteAbsLcbFloor,windowRounds:$promoteWindowRounds,minPassInWindow:$promoteMinPassInWindow,hashCooldownRounds:$promoteHashCooldownRounds,maxScoreMs:$promoteMaxScoreMs,maxScoreRegression:$promoteMaxScoreRegression}')

    if [ ! -f "$BEST_FILE" ]; then
      echo "$RESULT_JSON" | jq -c '.' > "$BEST_FILE"
    else
      OLD_SCORE=$(jq -r "$score_jq" "$BEST_FILE")
      CUR_SCORE=$(echo "$RESULT_JSON" | jq -r "$score_jq")
      if awk "BEGIN { exit !($CUR_SCORE > $OLD_SCORE) }"; then
        echo "$RESULT_JSON" | jq -c '.' > "$BEST_FILE"
      fi
    fi
  fi

  PASS_VAL=0
  if [ "$CANDIDATE_PASS" = true ]; then
    PASS_VAL=1
  fi
  if [ "$PROMOTE_WINDOW_ROUNDS" -gt 0 ]; then
    TMP_WINDOW="$WINDOW_PASS_FILE.tmp"
    if [ -f "$WINDOW_PASS_FILE" ]; then
      jq --argjson pass "$PASS_VAL" --argjson max "$PROMOTE_WINDOW_ROUNDS" '
        {
          updatedAt:(now|todate),
          passes: (((.passes // []) + [$pass]) | if length > $max then .[(length-$max):] else . end)
        }
      ' "$WINDOW_PASS_FILE" > "$TMP_WINDOW" || \
      jq -n --argjson pass "$PASS_VAL" '{updatedAt:(now|todate),passes:[$pass]}' > "$TMP_WINDOW"
    else
      jq -n --argjson pass "$PASS_VAL" '{updatedAt:(now|todate),passes:[$pass]}' > "$TMP_WINDOW"
    fi
    mv -f "$TMP_WINDOW" "$WINDOW_PASS_FILE"
  fi

  SEED_SHA=""
  if [ -f "$WEIGHTS_SEED" ]; then
    SEED_SHA=$(sha1sum "$WEIGHTS_SEED" | awk '{print $1}')
  fi

  RESULT_JSON=$(echo "$RESULT_JSON" | jq --arg loopTag "$LOOP_TAG" --argjson iteration "$ITER" --arg seedSha1 "$SEED_SHA" --arg seedPath "$WEIGHTS_SEED" '. + {loopTag:$loopTag, iteration:$iteration, seedSha1:$seedSha1, seedPath:$seedPath}')
  RESULT_JSON=$(echo "$RESULT_JSON" | jq -c '.')
  echo "$RESULT_JSON" >> "$STATUS_FILE"

  jq -n \
    --arg loopTag "$LOOP_TAG" \
    --arg runId "$RUN_ID" \
    --arg status "$STATUS" \
    --argjson iteration "$ITER" \
    --argjson pickedCount "$(echo "$RESULT_JSON" | jq -r '.pickedCount // 0')" \
    --argjson pickHitRate "$(echo "$RESULT_JSON" | jq -r '.pickHitRate // 0')" \
    --argjson pickHitRateLcb95 "$(echo "$RESULT_JSON" | jq -r '.pickHitRateLcb95 // 0')" \
    --argjson top1ToOracleConversion "$(echo "$RESULT_JSON" | jq -r '.top1ToOracleConversion // 0')" \
    --argjson budgetedConversion80 "$(echo "$RESULT_JSON" | jq -r '.budgetedConversion80 // 0')" \
    --argjson rankLossAvgEval "$(echo "$RESULT_JSON" | jq -r '.rankLossAvgEval // 0')" \
    --argjson lookaheadViolations "$(echo "$RESULT_JSON" | jq -r '.lookaheadViolations // 0')" \
    --argjson oracleHitRateTopK "$(echo "$RESULT_JSON" | jq -r '.oracleHitRateTopK // 0')" \
    --argjson workerPoolScoreMs "$(echo "$RESULT_JSON" | jq -r '.workerPoolScoreMs // 0')" \
    --argjson weightPromoted "$(echo "$RESULT_JSON" | jq -r '.weightPromoted // false')" \
    --argjson candidatePass "$(echo "$RESULT_JSON" | jq -r '.candidatePass // false')" \
    --argjson forceRebuildC "$(echo "$RESULT_JSON" | jq -r '.forceRebuildC // false')" \
    --argjson holdChampionSeedStreak "$(echo "$RESULT_JSON" | jq -r '.holdChampionSeedStreak // 0')" \
    --argjson stepdEvalFoldOffset "$(echo "$RESULT_JSON" | jq -r '.stepdEvalFoldOffset // 0')" \
    --arg promotionReason "$(echo "$RESULT_JSON" | jq -r '.promotionReason // "n/a"')" \
    --arg seedPath "$WEIGHTS_SEED" \
    --arg seedSha1 "$SEED_SHA" \
    --arg promotionViewSource "$(echo "$RESULT_JSON" | jq -r '.promotionViewSource // "RAW"')" \
    --arg statusFile "$STATUS_FILE" \
    --arg bestFile "$BEST_FILE" \
    --arg acceptedFile "$ACCEPTED_FILE" \
    '{loopTag:$loopTag,iteration:$iteration,runId:$runId,status:$status,pickedCount:$pickedCount,pickHitRate:$pickHitRate,pickHitRateLcb95:$pickHitRateLcb95,budgetedConversion80:$budgetedConversion80,top1ToOracleConversion:$top1ToOracleConversion,rankLossAvgEval:$rankLossAvgEval,lookaheadViolations:$lookaheadViolations,oracleHitRateTopK:$oracleHitRateTopK,workerPoolScoreMs:$workerPoolScoreMs,weightPromoted:$weightPromoted,candidatePass:$candidatePass,forceRebuildC:$forceRebuildC,holdChampionSeedStreak:$holdChampionSeedStreak,stepdEvalFoldOffset:$stepdEvalFoldOffset,promotionReason:$promotionReason,promotionViewSource:$promotionViewSource,seedPath:$seedPath,seedSha1:$seedSha1,statusFile:$statusFile,bestFile:$bestFile,acceptedFile:$acceptedFile,updatedAt:(now|todate)}' > "$CHECKPOINT_FILE"

  if [ "$KEEP_RUN_DIRS" -gt 0 ]; then
    ls -1dt "$ROOT_DIR"/artifacts/runs/stepd_locked_${LOOP_TAG}_i* 2>/dev/null | tail -n +$((KEEP_RUN_DIRS + 1)) | xargs -r rm -rf
  fi

  PICKED=$(echo "$RESULT_JSON" | jq -r '.pickedCount // 0')
  HITRATE=$(echo "$RESULT_JSON" | jq -r '.pickHitRate // 0')
  ORACLE=$(echo "$RESULT_JSON" | jq -r '.oracleHitRateTopK // 0')
  SCOREMS=$(echo "$RESULT_JSON" | jq -r '.workerPoolScoreMs // 0')
  WPROM=$(echo "$RESULT_JSON" | jq -r '.weightPromoted // false')
  CPASS=$(echo "$RESULT_JSON" | jq -r '.candidatePass // false')
  PREASON=$(echo "$RESULT_JSON" | jq -r '.promotionReason // "n/a"')
  PVIEW=$(echo "$RESULT_JSON" | jq -r '.promotionViewSource // "RAW"')
  BCONV=$(echo "$RESULT_JSON" | jq -r '.budgetedConversion80 // 0')
  FRB=$(echo "$RESULT_JSON" | jq -r '.forceRebuildC // false')
  echo "[stepd_locked_loop][$RUN_ID] status=$STATUS picked=$PICKED hitRate=$HITRATE budgetedConv80=$BCONV oracle=$ORACLE scoreMs=$SCOREMS promoted=$WPROM candidatePass=$CPASS forceRebuildC=$FRB reason=$PREASON foldOffset=$STEPD_EVAL_FOLD_OFFSET_VAL view=$PVIEW"

  if [ "$FRB" = "true" ]; then
    echo "[stepd_locked_loop] force_rebuild_c_required reached; stopping loop for Step-C rebuild."
    exit 2
  fi

  sleep "${STEPD_LOOP_SLEEP_SEC:-2}"
done
