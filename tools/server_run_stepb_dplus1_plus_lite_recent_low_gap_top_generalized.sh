#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HAS_RECENT_ONLY_FAMILY_IDS="false"
HAS_ENABLE_SUBGROUP_PREPASS="false"
HAS_SUBGROUP_MIN_MATCHED_DATES="false"
HAS_SUBGROUP_MIN_MATCHED_MONTHS="false"
HAS_SUBGROUP_MIN_MATCHED_FOLDS="false"
HAS_SUBGROUP_MAX_ROOT_SEEDS="false"
HAS_SUBGROUP_MAX_MANIFESTS="false"
HAS_SUBGROUP_MAX_DATE_COVER_JACCARD="false"
HAS_SUBGROUP_EARLY_DATE_RETENTION_RATIO="false"
HAS_SUBGROUP_EARLY_MONTH_RETENTION_RATIO="false"
HAS_SUBGROUP_EARLY_FOLD_RETENTION_RATIO="false"
HAS_MAX_SEED_TOKENS="false"
HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT="false"
HAS_LOW_FAMILY_MIN_SHARE="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_DATES="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS="false"
HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS="false"

for arg in "$@"; do
  case "$arg" in
    --recent-only-family-ids=*)
      HAS_RECENT_ONLY_FAMILY_IDS="true"
      [[ "${arg#*=}" == "low_gap_top_continuation" ]] || {
        echo "[fatal] generalized low-gap-top wrapper requires --recent-only-family-ids=low_gap_top_continuation" >&2
        exit 4
      }
      ;;
    --support-cases-file=*|--support-case-*|--support-cases=*)
      echo "[fatal] generalized low-gap-top wrapper is support-case-free; use the targeted probe wrapper for support-case runs" >&2
      exit 4
      ;;
    --enable-subgroup-prepass=*) HAS_ENABLE_SUBGROUP_PREPASS="true" ;;
    --subgroup-min-matched-dates=*) HAS_SUBGROUP_MIN_MATCHED_DATES="true" ;;
    --subgroup-min-matched-months=*) HAS_SUBGROUP_MIN_MATCHED_MONTHS="true" ;;
    --subgroup-min-matched-folds=*) HAS_SUBGROUP_MIN_MATCHED_FOLDS="true" ;;
    --subgroup-max-root-seeds=*) HAS_SUBGROUP_MAX_ROOT_SEEDS="true" ;;
    --subgroup-max-manifests=*) HAS_SUBGROUP_MAX_MANIFESTS="true" ;;
    --subgroup-max-date-cover-jaccard=*) HAS_SUBGROUP_MAX_DATE_COVER_JACCARD="true" ;;
    --subgroup-early-date-retention-ratio=*) HAS_SUBGROUP_EARLY_DATE_RETENTION_RATIO="true" ;;
    --subgroup-early-month-retention-ratio=*) HAS_SUBGROUP_EARLY_MONTH_RETENTION_RATIO="true" ;;
    --subgroup-early-fold-retention-ratio=*) HAS_SUBGROUP_EARLY_FOLD_RETENTION_RATIO="true" ;;
    --max-seed-tokens=*) HAS_MAX_SEED_TOKENS="true" ;;
    --low-family-search-min-hit-count=*) HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT="true" ;;
    --low-family-min-share=*) HAS_LOW_FAMILY_MIN_SHARE="true" ;;
    --low-family-min-train-matched-dates=*) HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_DATES="true" ;;
    --low-family-min-train-matched-months=*) HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_MONTHS="true" ;;
    --low-family-min-train-matched-folds=*) HAS_LOW_FAMILY_MIN_TRAIN_MATCHED_FOLDS="true" ;;
  esac
done

ARGS=()
if [[ "$HAS_RECENT_ONLY_FAMILY_IDS" != "true" ]]; then
  ARGS+=(--recent-only-family-ids=low_gap_top_continuation)
fi
if [[ "$HAS_ENABLE_SUBGROUP_PREPASS" != "true" ]]; then
  ARGS+=(--enable-subgroup-prepass=true)
fi
if [[ "$HAS_SUBGROUP_MIN_MATCHED_DATES" != "true" ]]; then
  ARGS+=(--subgroup-min-matched-dates=10)
fi
if [[ "$HAS_SUBGROUP_MIN_MATCHED_MONTHS" != "true" ]]; then
  ARGS+=(--subgroup-min-matched-months=6)
fi
if [[ "$HAS_SUBGROUP_MIN_MATCHED_FOLDS" != "true" ]]; then
  ARGS+=(--subgroup-min-matched-folds=4)
fi
if [[ "$HAS_SUBGROUP_MAX_ROOT_SEEDS" != "true" ]]; then
  ARGS+=(--subgroup-max-root-seeds=64)
fi
if [[ "$HAS_SUBGROUP_MAX_MANIFESTS" != "true" ]]; then
  ARGS+=(--subgroup-max-manifests=12)
fi
if [[ "$HAS_SUBGROUP_MAX_DATE_COVER_JACCARD" != "true" ]]; then
  ARGS+=(--subgroup-max-date-cover-jaccard=0.9)
fi
if [[ "$HAS_SUBGROUP_EARLY_DATE_RETENTION_RATIO" != "true" ]]; then
  ARGS+=(--subgroup-early-date-retention-ratio=0.6)
fi
if [[ "$HAS_SUBGROUP_EARLY_MONTH_RETENTION_RATIO" != "true" ]]; then
  ARGS+=(--subgroup-early-month-retention-ratio=0.75)
fi
if [[ "$HAS_SUBGROUP_EARLY_FOLD_RETENTION_RATIO" != "true" ]]; then
  ARGS+=(--subgroup-early-fold-retention-ratio=0.75)
fi
if [[ "$HAS_MAX_SEED_TOKENS" != "true" ]]; then
  ARGS+=(--max-seed-tokens=1024)
fi
if [[ "$HAS_LOW_FAMILY_SEARCH_MIN_HIT_COUNT" != "true" ]]; then
  ARGS+=(--low-family-search-min-hit-count=4)
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
