#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_SUPPORT_FAILURE_REGIME_VETO_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_RUN_ID="${STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX:-perfect_proto_support_failure_regime_veto_top1_v49}_$(date +%Y%m%d_%H%M%S)"

RUN_ID="$DEFAULT_RUN_ID"
SUPPORT_CASES_FILE="$DEFAULT_SUPPORT_CASES_FILE"
HAS_SUPPORT_CASES_FILE="false"
HAS_SUPPORT_FEATURE_CASES_FILE="false"
HAS_MAX_SEARCH_STATES="false"
for arg in "$@"; do
  case "$arg" in
    --run-id=*)
      RUN_ID="${arg#*=}"
      ;;
    --support-cases-file=*)
      HAS_SUPPORT_CASES_FILE="true"
      SUPPORT_CASES_FILE="${arg#*=}"
      ;;
    --support-feature-cases-file=*)
      HAS_SUPPORT_FEATURE_CASES_FILE="true"
      ;;
    --max-search-states=*)
      HAS_MAX_SEARCH_STATES="true"
      ;;
  esac
done

BASE_ARGS=(
  --run-id="$RUN_ID"
  --enable-support-manifold-signature=true
  --enable-support-metric-features=true
  --enable-adaptive-threshold-atoms=true
  --enable-interval-atoms=true
  --enable-macro-atoms=true
  --enable-support-anchor-atoms=true
)
if [[ "$HAS_SUPPORT_CASES_FILE" != "true" ]]; then
  BASE_ARGS+=(--support-cases-file="$SUPPORT_CASES_FILE")
fi
if [[ "$HAS_SUPPORT_FEATURE_CASES_FILE" != "true" ]]; then
  BASE_ARGS+=(--support-feature-cases-file="$SUPPORT_CASES_FILE")
fi
if [[ "$HAS_MAX_SEARCH_STATES" != "true" ]]; then
  BASE_ARGS+=(--max-search-states=200000)
fi
BASE_ARGS+=("$@")

bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_mid_low.sh" "${BASE_ARGS[@]}"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
OOS_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
VETO_DIR="$RUN_DIR/step-perfect-prototype-support-failure-regime-veto-top1"

node "$ROOT_DIR/tools/build_perfect_prototype_support_failure_regime_veto_top1.mjs" \
  --train-input="$TRAIN_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --support-cases-file="$SUPPORT_CASES_FILE" \
  --out-dir="$VETO_DIR" \
  --family-id=support_failure_regime_veto_top1 \
  --support-signature-family-id=low_gap_top_continuation \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --min-crossfit-positive-windows=2 \
  --max-crossfit-negative-windows=0 \
  --min-oos-match-count=3 \
  --lookback-trading-days=4 \
  --control-pool-size=5

if [[ -f "$VETO_DIR/no_support_failure_regime_veto_top1_summary.json" ]]; then
  echo "[fatal] no feasible failure-regime veto top1 artifact. see $VETO_DIR/no_support_failure_regime_veto_top1_summary.json" >&2
  exit 42
fi

echo "[ok] failure-regime veto top1 solve complete"
echo "runId=$RUN_ID"
echo "vetoDir=$VETO_DIR"
