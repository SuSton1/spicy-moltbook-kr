#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_RUN_ID="perfect_proto_low_1d_recent_significant_episode_exact_bank_v60a_$(date +%Y%m%d_%H%M%S)"
DEFAULT_CONFIG_PATH="${PERFECT_PROTO_V60A_CONFIG_PATH:-config/lab.config.server.lite.stepb_dplus1_plus_lite_recent_mid_low.json}"

ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  echo "[fatal] server_run_stepb_dplus1_plus_lite_recent_low_significant_episode_exact_bank.sh must run from $EXPECTED_REAL, got $ROOT_REAL" >&2
  exit 4
fi

RUN_ID="$DEFAULT_RUN_ID"
CONFIG_PATH="$DEFAULT_CONFIG_PATH"
BUILD_EXTRA_ARGS=()
BASE_EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --run-id=*)
      RUN_ID="${arg#*=}"
      ;;
    --config=*)
      CONFIG_PATH="${arg#*=}"
      ;;
    --family-ids=*|--lookback-trading-days=*|--min-train-dates=*|--min-train-months=*|--min-train-folds=*|--min-union-dates=*|--min-union-months=*|--min-union-folds=*|--min-selection-frequency=*|--min-fold-presence-count=*|--min-window-presence-count=*|--q-value-threshold=*|--max-episode-seed-tokens=*|--max-additional-episode-tokens=*|--max-union-rules=*|--max-union-rules-per-family=*)
      BUILD_EXTRA_ARGS+=("$arg")
      ;;
    *)
      BASE_EXTRA_ARGS+=("$arg")
      ;;
  esac
done

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi

BASE_WRAPPER="$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_low_only.sh"
[[ -x "$BASE_WRAPPER" || -f "$BASE_WRAPPER" ]] || { echo "[fatal] base recent-low-only wrapper missing: $BASE_WRAPPER" >&2; exit 4; }
[[ -f "$CONFIG_PATH" ]] || { echo "[fatal] config not found: $CONFIG_PATH" >&2; exit 4; }

bash "$BASE_WRAPPER" --run-id="$RUN_ID" --config="$CONFIG_PATH" "${BASE_EXTRA_ARGS[@]}"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
OOS_INPUT_PATH="$RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
TRAIN_MINE_CATALOG_PATH="$ROOT_DIR/artifacts/runs/${RUN_ID}_train_mine/step-perfect-prototype/catalog.json"
REPORT_DIR="$RUN_DIR/step-perfect-prototype-low-1d-recent-significant-episode-exact-bank"

[[ -f "$TRAIN_INPUT_PATH" ]] || { echo "[fatal] train pack missing: $TRAIN_INPUT_PATH" >&2; exit 4; }
[[ -f "$OOS_INPUT_PATH" ]] || { echo "[fatal] oos pack missing: $OOS_INPUT_PATH" >&2; exit 4; }
[[ -f "$TRAIN_MINE_CATALOG_PATH" ]] || { echo "[fatal] train mine catalog missing: $TRAIN_MINE_CATALOG_PATH" >&2; exit 4; }

node "$ROOT_DIR/tools/build_perfect_prototype_low_1d_recent_significant_episode_exact_bank.mjs" \
  --config="$CONFIG_PATH" \
  --train-input="$TRAIN_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --catalog="$TRAIN_MINE_CATALOG_PATH" \
  --out-dir="$REPORT_DIR" \
  "${BUILD_EXTRA_ARGS[@]}"

echo "[ok] v60a LOW recent significant episode exact bank complete"
echo "runId=$RUN_ID"
echo "reportDir=$REPORT_DIR"
