#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_LOW_GAP_TOP_DECISION_SET_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_RUN_ID="${STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX:-perfect_proto_low_gap_top_support_metric_decision_set_v30}_$(date +%Y%m%d_%H%M%S)"

RUN_ID="$DEFAULT_RUN_ID"
HAS_RUN_ID="false"
HAS_SUPPORT_FEATURE_CASES_FILE="false"
HAS_SUPPORT_CASES_FILE="false"

for arg in "$@"; do
  case "$arg" in
    --run-id=*)
      RUN_ID="${arg#*=}"
      HAS_RUN_ID="true"
      ;;
    --support-feature-cases-file=*) HAS_SUPPORT_FEATURE_CASES_FILE="true" ;;
    --support-cases-file=*)
      HAS_SUPPORT_CASES_FILE="true"
      ;;
  esac
done

BASE_ARGS=(
  --run-id="$RUN_ID"
  --recent-only-family-ids=low_gap_top_continuation
  --enable-subgroup-prepass=true
  --enable-subgroup-stability=true
  --enable-subgroup-diversity=true
  --subgroup-min-matched-dates=10
  --subgroup-min-matched-months=6
  --subgroup-min-matched-folds=4
  --subgroup-max-root-seeds=64
  --subgroup-max-manifests=12
  --subgroup-min-selection-frequency=0.5
  --subgroup-min-fold-presence-count=3
  --subgroup-min-window-presence-count=2
  --subgroup-max-token-jaccard=0.8
  --subgroup-max-axis-overlap=2
  --subgroup-max-date-cover-jaccard=0.9
  --subgroup-early-date-retention-ratio=0.6
  --subgroup-early-month-retention-ratio=0.75
  --subgroup-early-fold-retention-ratio=0.75
  --enable-exact-completion-solver=true
  --exact-completion-mode=counterexample_core_frontier
  --exact-completion-max-candidates=24
  --exact-completion-max-additional-tokens=3
  --enable-crossfit-hard-negative-refinement=true
  --crossfit-holdout-windows=6
  --crossfit-min-window-support=2
  --crossfit-hard-negative-weight=4
  --low-family-search-min-hit-count=4
  --low-family-min-train-matched-dates=4
  --low-family-min-train-matched-months=4
  --low-family-min-train-matched-folds=4
  --enable-support-manifold-signature=true
  --enable-support-metric-features=true
  --enable-adaptive-threshold-atoms=true
  --enable-interval-atoms=true
  --enable-macro-atoms=true
  --enable-support-anchor-atoms=true
)
if [[ "$HAS_SUPPORT_FEATURE_CASES_FILE" != "true" ]]; then
  BASE_ARGS+=(--support-feature-cases-file="$DEFAULT_SUPPORT_CASES_FILE")
fi
BASE_ARGS+=("$@")

bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_mid_low.sh" "${BASE_ARGS[@]}"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
FREEZE_RESULT_PATH="$RUN_DIR/freeze_result.json"
TRAIN_MINE_DIR="$ROOT_DIR/artifacts/runs/${RUN_ID}_train_mine/step-perfect-prototype"
LEADERBOARD_PATH="$RUN_DIR/step-perfect-prototype-open-eval-report/selection_leaderboard.json"
TRAIN_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
OOS_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
DECISION_SET_DIR="$RUN_DIR/step-perfect-prototype-decision-set"

if [[ ! -f "$FREEZE_RESULT_PATH" ]]; then
  echo "[fatal] missing freeze_result.json for runId=$RUN_ID" >&2
  exit 42
fi
FROZEN_CATALOG_PATH="$(node --input-type=module -e 'import fs from "node:fs/promises"; const payload = JSON.parse(await fs.readFile(process.argv[1], "utf8")); process.stdout.write(String(payload?.outPath ?? ""))' "$FREEZE_RESULT_PATH")"
if [[ -z "$FROZEN_CATALOG_PATH" ]]; then
  echo "[fatal] freeze_result.json did not resolve a frozen catalog path for runId=$RUN_ID" >&2
  exit 42
fi

SUPPORT_CASES_FILE="$DEFAULT_SUPPORT_CASES_FILE"
if [[ "$HAS_SUPPORT_CASES_FILE" == "true" ]]; then
  for arg in "$@"; do
    case "$arg" in
      --support-cases-file=*) SUPPORT_CASES_FILE="${arg#*=}" ;;
    esac
  done
fi

node "$ROOT_DIR/tools/solve_perfect_prototype_low_gap_top_decision_set.mjs" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --leaderboard="$LEADERBOARD_PATH" \
  --train-input="$TRAIN_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --support-cases-file="$SUPPORT_CASES_FILE" \
  --out-dir="$DECISION_SET_DIR" \
  --family-id=low_gap_top_continuation \
  --candidate-limit=48 \
  --max-clauses=3 \
  --max-clause-size=3 \
  --min-clause-train-dates=3 \
  --min-clause-train-months=3 \
  --min-clause-train-folds=1 \
  --max-clause-crossfit-negative-windows=0 \
  --min-clause-crossfit-positive-windows=1 \
  --crossfit-window-count=6 \
  --crossfit-fold-count=4 \
  --crossfit-min-window-support=2 \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --max-crossfit-negative-windows=0 \
  --min-crossfit-positive-windows=2 \
  --min-oos-precision=1 \
  --min-oos-match-count=3 \
  --min-oos-unique-dates=3

if [[ -f "$DECISION_SET_DIR/no_decision_set_summary.json" ]]; then
  echo "[fatal] no feasible low-gap-top decision set. see $DECISION_SET_DIR/no_decision_set_summary.json" >&2
  exit 42
fi

echo "[ok] low-gap-top decision-set solve complete"
echo "runId=$RUN_ID"
echo "decisionSetDir=$DECISION_SET_DIR"
