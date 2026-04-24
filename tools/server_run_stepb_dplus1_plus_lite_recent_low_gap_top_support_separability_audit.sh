#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_LOW_GAP_TOP_SEPARABILITY_AUDIT_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_RUN_ID="${STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX:-perfect_proto_low_gap_top_support_separability_audit_v46}_$(date +%Y%m%d_%H%M%S)"

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
  --recent-only-family-ids=low_gap_top_continuation
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
AUDIT_DIR="$RUN_DIR/step-perfect-prototype-support-separability-audit"

node "$ROOT_DIR/tools/build_perfect_prototype_low_gap_top_support_separability_audit.mjs" \
  --train-input="$TRAIN_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --support-cases-file="$SUPPORT_CASES_FILE" \
  --out-dir="$AUDIT_DIR" \
  --family-id=low_gap_top_continuation \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --min-heldout-pairwise-win-rate=0.9 \
  --min-fold-pairwise-win-rate=0.8 \
  --min-runner-up-beat-rate=0.85 \
  --min-positive-signature-count=2 \
  --max-hard-negative-leak-count=0 \
  --lookback-trading-days=4 \
  --control-pool-size=5

if [[ -f "$AUDIT_DIR/no_support_separability_summary.json" ]]; then
  echo "[fatal] no feasible low-gap-top support separability family. see $AUDIT_DIR/no_support_separability_summary.json" >&2
  exit 42
fi

echo "[ok] low-gap-top support separability audit complete"
echo "runId=$RUN_ID"
echo "auditDir=$AUDIT_DIR"

