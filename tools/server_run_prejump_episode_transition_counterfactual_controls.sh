#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_PREJUMP_EPTRANS_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_CONFIG_PATH="${PERFECT_PROTO_PREJUMP_EPTRANS_CONFIG_PATH:-config/lab.config.server.lite.prejump.json}"
DEFAULT_RUN_ID="perfect_proto_prejump_episode_transition_counterfactual_controls_v52_$(date +%Y%m%d_%H%M%S)"

RUN_ID="$DEFAULT_RUN_ID"
SUPPORT_CASES_FILE="$DEFAULT_SUPPORT_CASES_FILE"
CONFIG_PATH="$DEFAULT_CONFIG_PATH"
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
TRAIN_MAX_DECISION_DATES="48"
OOS_MAX_DECISION_DATES="16"
MAX_ROWS_PER_DATE="128"
EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --run-id=*)
      RUN_ID="${arg#*=}"
      ;;
    --support-cases-file=*)
      SUPPORT_CASES_FILE="${arg#*=}"
      ;;
    --config=*)
      CONFIG_PATH="${arg#*=}"
      ;;
    --train-start=*)
      TRAIN_START="${arg#*=}"
      ;;
    --train-end=*)
      TRAIN_END="${arg#*=}"
      ;;
    --oos-start=*)
      OOS_START="${arg#*=}"
      ;;
    --oos-end=*)
      OOS_END="${arg#*=}"
      ;;
    --train-max-decision-dates=*)
      TRAIN_MAX_DECISION_DATES="${arg#*=}"
      ;;
    --oos-max-decision-dates=*)
      OOS_MAX_DECISION_DATES="${arg#*=}"
      ;;
    --max-rows-per-date=*)
      MAX_ROWS_PER_DATE="${arg#*=}"
      ;;
    *)
      EXTRA_ARGS+=("$arg")
      ;;
  esac
done

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_DIR="$RUN_DIR/step-perfect-prototype-prejump-train-pack"
OOS_DIR="$RUN_DIR/step-perfect-prototype-prejump-oos-pack"
FAMILY_DIR="$RUN_DIR/step-perfect-prototype-prejump-episode-transition"
TRAIN_INPUT_PATH="$TRAIN_DIR/prejump_pack.jsonl"
OOS_INPUT_PATH="$OOS_DIR/prejump_pack.jsonl"

node "$ROOT_DIR/tools/build_perfect_prototype_prejump_pack.mjs" \
  --config="$CONFIG_PATH" \
  --out-dir="$TRAIN_DIR" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --emit-jsonl=true \
  --max-decision-dates="$TRAIN_MAX_DECISION_DATES" \
  --max-rows-per-date="$MAX_ROWS_PER_DATE" \
  --decision-date-sampling-mode=decision_date_stratified

node "$ROOT_DIR/tools/build_perfect_prototype_prejump_pack.mjs" \
  --config="$CONFIG_PATH" \
  --out-dir="$OOS_DIR" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --emit-jsonl=true \
  --max-decision-dates="$OOS_MAX_DECISION_DATES" \
  --max-rows-per-date="$MAX_ROWS_PER_DATE" \
  --decision-date-sampling-mode=decision_date_stratified

node "$ROOT_DIR/tools/build_perfect_prototype_prejump_episode_transition_counterfactual_controls.mjs" \
  --train-input="$TRAIN_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --support-cases-file="$SUPPORT_CASES_FILE" \
  --out-dir="$FAMILY_DIR" \
  --family-id=prejump_episode_transition_counterfactual_controls \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --min-crossfit-positive-windows=2 \
  --max-crossfit-negative-windows=0 \
  --min-oos-match-count=3 \
  --audit-min-pairwise-win-rate=0.95 \
  --audit-min-same-date-beat-rate=0.95 \
  --audit-min-matched-control-beat-rate=0.9 \
  --audit-min-failure-beat-rate=0.9 \
  --audit-min-fold-pairwise-win-rate=0.9 \
  --audit-max-hard-negative-leak-count=0 \
  "${EXTRA_ARGS[@]}"

if [[ -f "$FAMILY_DIR/no_support_prejump_episode_transition_counterfactual_controls_summary.json" ]]; then
  echo "[fatal] no feasible prejump episode-transition artifact. see $FAMILY_DIR/no_support_prejump_episode_transition_counterfactual_controls_summary.json" >&2
  exit 42
fi

echo "[ok] prejump episode-transition counterfactual controls complete"
echo "runId=$RUN_ID"
echo "familyDir=$FAMILY_DIR"
