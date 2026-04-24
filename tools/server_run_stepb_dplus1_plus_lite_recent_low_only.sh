#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HAS_RECENT_ONLY_FAMILY_IDS="false"
HAS_MAX_SEED_TOKENS="false"
HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT="false"
HAS_MID_FAMILY_MIN_SHARE="false"
HAS_LOW_FAMILY_MIN_SHARE="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_DATES="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS="false"

for arg in "$@"; do
  case "$arg" in
    --recent-only-family-ids=*)
      HAS_RECENT_ONLY_FAMILY_IDS="true"
      ;;
    --max-seed-tokens=*)
      HAS_MAX_SEED_TOKENS="true"
      ;;
    --low-family-search-min-hit-count=*)
      HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT="true"
      ;;
    --mid-family-min-share=*)
      HAS_MID_FAMILY_MIN_SHARE="true"
      ;;
    --low-family-min-share=*)
      HAS_LOW_FAMILY_MIN_SHARE="true"
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
  esac
done

ARGS=()
if [[ "$HAS_RECENT_ONLY_FAMILY_IDS" != "true" ]]; then
  ARGS+=(
    --recent-only-family-ids=low_gap_top_continuation,low_gap_high_continuation,low_jump_below_continuation
  )
fi
if [[ "$HAS_MAX_SEED_TOKENS" != "true" ]]; then
  ARGS+=(--max-seed-tokens=1024)
fi
if [[ "$HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT" != "true" ]]; then
  ARGS+=(--low-family-search-min-hit-count=4)
fi
if [[ "$HAS_MID_FAMILY_MIN_SHARE" != "true" ]]; then
  ARGS+=(--mid-family-min-share=0.6)
fi
if [[ "$HAS_LOW_FAMILY_MIN_SHARE" != "true" ]]; then
  ARGS+=(--low-family-min-share=0.6)
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
ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_mid_low.sh" "${ARGS[@]}"
