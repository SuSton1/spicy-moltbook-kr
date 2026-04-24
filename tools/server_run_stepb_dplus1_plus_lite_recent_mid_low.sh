#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export STEPB_PLUS_LITE_WRAPPER_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_recent_mid_low.json"
export STEPB_PLUS_LITE_WRAPPER_LINE_ID="stepb_dplus1_plus_lite_recent_mid_low"
export STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE="v6_contextual_plus_lite_recent_only_lane_local_pool8"
export STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX="perfect_proto_stepb_dplus1_plus_lite_recent_mid_low"

HAS_MAX_SEED_TOKENS="false"
HAS_MID_FAMILY_MIN_SHARE="false"
HAS_LOW_FAMILY_MIN_SHARE="false"
HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_DATES="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS="false"
HAS_FOLD_SCHEME="false"
HAS_SPLIT_POLICY="false"
for arg in "$@"; do
  case "$arg" in
    --discovery-universe-id=*)
      [[ "${arg#*=}" == "recent_impulse_upto_1d" ]] || {
        echo "[fatal] recent MID/LOW wrapper requires --discovery-universe-id=recent_impulse_upto_1d" >&2
        exit 4
      }
      ;;
    --recent-impulse-lookback-days=*)
      [[ "${arg#*=}" == "1" ]] || {
        echo "[fatal] recent MID/LOW wrapper requires --recent-impulse-lookback-days=1" >&2
        exit 4
      }
      ;;
    --enable-family-scoped-mining=*)
      [[ "${arg#*=}" == "true" ]] || {
        echo "[fatal] recent MID/LOW wrapper requires --enable-family-scoped-mining=true" >&2
        exit 4
      }
      ;;
    --max-seed-tokens=*)
      HAS_MAX_SEED_TOKENS="true"
      ;;
    --mid-family-min-share=*)
      HAS_MID_FAMILY_MIN_SHARE="true"
      ;;
    --low-family-min-share=*)
      HAS_LOW_FAMILY_MIN_SHARE="true"
      ;;
    --low-family-search-min-hit-count=*)
      HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT="true"
      ;;
    --low-family-min-train-matched-dates=*)
      HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_DATES="true"
      ;;
    --low-family-min-train-matched-months=*)
      HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS="true"
      ;;
    --low-family-min-train-matched-folds=*)
      HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS="true"
      ;;
    --fold-scheme=*)
      HAS_FOLD_SCHEME="true"
      ;;
    --split-policy=*)
      HAS_SPLIT_POLICY="true"
      ;;
  esac
done

ARGS=(
  --discovery-universe-id=recent_impulse_upto_1d
  --recent-impulse-lookback-days=1
  --enable-family-scoped-mining=true
)
if [[ "$HAS_SPLIT_POLICY" != "true" ]]; then
  ARGS+=(--split-policy=decision_date_only)
fi
if [[ "$HAS_MAX_SEED_TOKENS" != "true" ]]; then
  ARGS+=(--max-seed-tokens=1024)
fi
if [[ "$HAS_MID_FAMILY_MIN_SHARE" != "true" ]]; then
  ARGS+=(--mid-family-min-share=0.6)
fi
if [[ "$HAS_LOW_FAMILY_MIN_SHARE" != "true" ]]; then
  ARGS+=(--low-family-min-share=0.6)
fi
if [[ "$HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT" != "true" ]]; then
  ARGS+=(--low-family-search-min-hit-count=4)
fi
if [[ "$HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_DATES" != "true" ]]; then
  ARGS+=(--low-family-min-train-matched-dates=4)
fi
if [[ "$HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS" != "true" ]]; then
  ARGS+=(--low-family-min-train-matched-months=4)
fi
if [[ "$HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS" != "true" ]]; then
  ARGS+=(--low-family-min-train-matched-folds=4)
fi
if [[ "$HAS_FOLD_SCHEME" != "true" ]]; then
  ARGS+=(--fold-scheme=chronological_4)
fi
ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite.sh" "${ARGS[@]}"
