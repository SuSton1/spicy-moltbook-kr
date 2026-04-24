#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_DAILY_CANONICAL_WINNER_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_CONFIG_PATH="${PERFECT_PROTO_DAILY_CANONICAL_WINNER_CONFIG_PATH:-config/lab.config.server.lite.stepb_dplus1_plus_lite_lane_local.json}"
DEFAULT_RUN_ID="perfect_proto_daily_canonical_winner_slate_contrastive_top1_v53_$(date +%Y%m%d_%H%M%S)"
EXPECTED_BASELINE_LINE_ID="stepb_dplus1_plus_lite_lane_local"
EXPECTED_CONTEXT_SURFACE="v5_contextual_plus_lite_lane_local_pool8"
EXPECTED_MAX_GAP_TRADING_DAYS="100000"

RUN_ID="$DEFAULT_RUN_ID"
SUPPORT_CASES_FILE="$DEFAULT_SUPPORT_CASES_FILE"
CONFIG_PATH="$DEFAULT_CONFIG_PATH"
TRAIN_START="2023-01-01"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
TRAIN_LIMIT_ROWS=""
OOS_LIMIT_ROWS=""
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
    --train-limit-rows=*)
      TRAIN_LIMIT_ROWS="${arg#*=}"
      ;;
    --oos-limit-rows=*)
      OOS_LIMIT_ROWS="${arg#*=}"
      ;;
    *)
      EXTRA_ARGS+=("$arg")
      ;;
  esac
done

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi

[[ -f "$CONFIG_PATH" ]] || {
  echo "[fatal] config not found: $CONFIG_PATH" >&2
  exit 4
}
[[ -f "$LIB_PATH" ]] || {
  echo "[fatal] baseline wrapper helper library not found: $LIB_PATH" >&2
  exit 4
}
source "$LIB_PATH"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_DIR="$RUN_DIR/step-perfect-prototype-daily-train-pack"
OOS_DIR="$RUN_DIR/step-perfect-prototype-daily-oos-pack"
TRAIN_CONTROL_DIR="$RUN_DIR/step-perfect-prototype-daily-train-control-pack"
OOS_CONTROL_DIR="$RUN_DIR/step-perfect-prototype-daily-oos-control-pack"
FAMILY_DIR="$RUN_DIR/step-perfect-prototype-daily-canonical-winner-slate"
TRAIN_STEPA_RUN_ID="${RUN_ID}_train_stepa"
OOS_STEPA_RUN_ID="${RUN_ID}_oos_stepa"
TRAIN_STEPA_DIR="$ROOT_DIR/artifacts/runs/$TRAIN_STEPA_RUN_ID/step-a"
OOS_STEPA_DIR="$ROOT_DIR/artifacts/runs/$OOS_STEPA_RUN_ID/step-a"
TRAIN_CONFIG_PATH="$RUN_DIR/train_runtime_config.json"
OOS_CONFIG_PATH="$RUN_DIR/oos_runtime_config.json"
TRAIN_INPUT_PATH="$TRAIN_DIR/daily_pack.jsonl"
OOS_INPUT_PATH="$OOS_DIR/daily_pack.jsonl"
TRAIN_CONTROL_INPUT_PATH="$TRAIN_CONTROL_DIR/daily_pack.jsonl"
OOS_CONTROL_INPUT_PATH="$OOS_CONTROL_DIR/daily_pack.jsonl"

validate_baseline_contract_config \
  "$CONFIG_PATH" \
  "$EXPECTED_BASELINE_LINE_ID" \
  "$EXPECTED_MAX_GAP_TRADING_DAYS" \
  "$EXPECTED_CONTEXT_SURFACE"
write_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_START" "$TRAIN_END" "decision_date_only"
write_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_START" "$OOS_END" "decision_date_only"
rewrite_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "1"
rewrite_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "1"
validate_baseline_contract_config \
  "$TRAIN_CONFIG_PATH" \
  "$EXPECTED_BASELINE_LINE_ID" \
  "$EXPECTED_MAX_GAP_TRADING_DAYS" \
  "$EXPECTED_CONTEXT_SURFACE"
validate_baseline_contract_config \
  "$OOS_CONFIG_PATH" \
  "$EXPECTED_BASELINE_LINE_ID" \
  "$EXPECTED_MAX_GAP_TRADING_DAYS" \
  "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "1"
validate_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "1"

eval "$(
  node --input-type=module - "same_day_plus_recent_upto_1d" "1" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"

const [discoveryUniverseId, requestedLookbackTradingDaysRaw] = process.argv.slice(2)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays: Number(requestedLookbackTradingDaysRaw),
})
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
NODE
)"

node "$ROOT_DIR/src/cli.mjs" step-a --config="$TRAIN_CONFIG_PATH" --run-id="$TRAIN_STEPA_RUN_ID"
node "$ROOT_DIR/src/cli.mjs" step-a --config="$OOS_CONFIG_PATH" --run-id="$OOS_STEPA_RUN_ID"

TRAIN_PACK_ARGS=(
  --config="$TRAIN_CONFIG_PATH"
  --out-dir="$TRAIN_DIR"
  --start="$TRAIN_START"
  --end="$TRAIN_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_daily_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id=same_day_plus_recent_upto_1d
  --requested-lookback-trading-days=1
  --seed-input="$TRAIN_STEPA_DIR/events_high8_lite.jsonl"
  --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES"
  --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"
)
OOS_PACK_ARGS=(
  --config="$OOS_CONFIG_PATH"
  --out-dir="$OOS_DIR"
  --start="$OOS_START"
  --end="$OOS_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_daily_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id=same_day_plus_recent_upto_1d
  --requested-lookback-trading-days=1
  --seed-input="$OOS_STEPA_DIR/events_high8_lite.jsonl"
  --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES"
  --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"
)
TRAIN_CONTROL_PACK_ARGS=(
  --config="$TRAIN_CONFIG_PATH"
  --out-dir="$TRAIN_CONTROL_DIR"
  --start="$TRAIN_START"
  --end="$TRAIN_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_daily_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id=afree_open
)
OOS_CONTROL_PACK_ARGS=(
  --config="$OOS_CONFIG_PATH"
  --out-dir="$OOS_CONTROL_DIR"
  --start="$OOS_START"
  --end="$OOS_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_daily_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id=afree_open
)
if [[ -n "$TRAIN_LIMIT_ROWS" ]]; then
  TRAIN_PACK_ARGS+=(--limit-rows="$TRAIN_LIMIT_ROWS")
  TRAIN_CONTROL_PACK_ARGS+=(--limit-rows="$TRAIN_LIMIT_ROWS")
fi
if [[ -n "$OOS_LIMIT_ROWS" ]]; then
  OOS_PACK_ARGS+=(--limit-rows="$OOS_LIMIT_ROWS")
  OOS_CONTROL_PACK_ARGS+=(--limit-rows="$OOS_LIMIT_ROWS")
fi

node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" "${TRAIN_PACK_ARGS[@]}"
node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" "${OOS_PACK_ARGS[@]}"
node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" "${TRAIN_CONTROL_PACK_ARGS[@]}"
node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" "${OOS_CONTROL_PACK_ARGS[@]}"

node "$ROOT_DIR/tools/build_perfect_prototype_daily_canonical_winner_slate.mjs" \
  --train-input="$TRAIN_INPUT_PATH" \
  --train-control-input="$TRAIN_CONTROL_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --oos-control-input="$OOS_CONTROL_INPUT_PATH" \
  --support-cases-file="$SUPPORT_CASES_FILE" \
  --out-dir="$FAMILY_DIR" \
  --family-id=daily_canonical_winner_slate_contrastive_top1 \
  --discovery-universe-id=same_day_plus_recent_upto_1d \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --min-crossfit-positive-windows=2 \
  --max-crossfit-negative-windows=0 \
  --min-oos-match-count=3 \
  --lookback-trading-days=4 \
  --control-pool-size=5 \
  --audit-min-pairwise-win-rate=0.9 \
  --audit-min-same-date-beat-rate=0.9 \
  --audit-min-matched-control-beat-rate=0.85 \
  --audit-min-failure-beat-rate=0.85 \
  --audit-min-fold-pairwise-win-rate=0.8 \
  --audit-max-hard-negative-leak-count=0 \
  "${EXTRA_ARGS[@]}"

if [[ -f "$FAMILY_DIR/no_support_daily_canonical_winner_slate_summary.json" ]]; then
  echo "[fatal] no feasible daily canonical winner-slate artifact. see $FAMILY_DIR/no_support_daily_canonical_winner_slate_summary.json" >&2
  exit 42
fi

echo "[ok] daily canonical winner-slate solve complete"
echo "runId=$RUN_ID"
echo "familyDir=$FAMILY_DIR"
