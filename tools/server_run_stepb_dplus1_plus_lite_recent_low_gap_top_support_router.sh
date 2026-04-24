#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_LOW_GAP_TOP_SUPPORT_ROUTER_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_RUN_ID="${STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX:-perfect_proto_low_gap_top_support_prototype_router_v32}_$(date +%Y%m%d_%H%M%S)"

RUN_ID="$DEFAULT_RUN_ID"
HAS_SUPPORT_CASES_FILE="false"
HAS_SUPPORT_FEATURE_CASES_FILE="false"
for arg in "$@"; do
  case "$arg" in
    --run-id=*)
      RUN_ID="${arg#*=}"
      ;;
    --support-cases-file=*)
      HAS_SUPPORT_CASES_FILE="true"
      ;;
    --support-feature-cases-file=*)
      HAS_SUPPORT_FEATURE_CASES_FILE="true"
      ;;
  esac
done

BASE_ARGS=(
  --run-id="$RUN_ID"
  --recent-only-family-ids=low_gap_top_continuation
  --enable-support-manifold-signature=true
  --enable-support-metric-features=true
  --enable-adaptive-threshold-atoms=true
  --enable-interval-atoms=true
  --enable-macro-atoms=true
  --enable-support-anchor-atoms=true
)
if [[ "$HAS_SUPPORT_CASES_FILE" != "true" ]]; then
  BASE_ARGS+=(--support-cases-file="$DEFAULT_SUPPORT_CASES_FILE")
fi
if [[ "$HAS_SUPPORT_FEATURE_CASES_FILE" != "true" ]]; then
  BASE_ARGS+=(--support-feature-cases-file="$DEFAULT_SUPPORT_CASES_FILE")
fi
BASE_ARGS+=("$@")

bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_mid_low.sh" "${BASE_ARGS[@]}"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
OOS_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
ROUTER_DIR="$RUN_DIR/step-perfect-prototype-support-router"

node "$ROOT_DIR/tools/build_perfect_prototype_low_gap_top_support_router.mjs" \
  --train-input="$TRAIN_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --support-cases-file="$DEFAULT_SUPPORT_CASES_FILE" \
  --out-dir="$ROUTER_DIR" \
  --family-id=low_gap_top_continuation \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --min-crossfit-positive-windows=2 \
  --max-crossfit-negative-windows=0 \
  --max-threshold-features=4

if [[ -f "$ROUTER_DIR/no_support_prototype_router_summary.json" ]]; then
  echo "[fatal] no feasible low-gap-top support prototype router. see $ROUTER_DIR/no_support_prototype_router_summary.json" >&2
  exit 42
fi

node "$ROOT_DIR/tools/report_perfect_prototype_low_gap_top_support_router_oos.mjs" \
  --artifact="$ROUTER_DIR/support_prototype_router_artifact.json" \
  --input="$TRAIN_INPUT_PATH" \
  --support-cases-file="$DEFAULT_SUPPORT_CASES_FILE" \
  --out="$ROUTER_DIR/support_prototype_router_train_report.json"

node "$ROOT_DIR/tools/report_perfect_prototype_low_gap_top_support_router_oos.mjs" \
  --artifact="$ROUTER_DIR/support_prototype_router_artifact.json" \
  --input="$OOS_INPUT_PATH" \
  --support-cases-file="$DEFAULT_SUPPORT_CASES_FILE" \
  --out="$ROUTER_DIR/support_prototype_router_oos_report.json"

echo "[ok] low-gap-top support prototype router solve complete"
echo "runId=$RUN_ID"
echo "routerDir=$ROUTER_DIR"

