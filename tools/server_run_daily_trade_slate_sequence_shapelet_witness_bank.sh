#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_MECHANISM_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v30.json}"
DEFAULT_CONFIG_PATH="${PERFECT_PROTO_MECHANISM_CONFIG_PATH:-config/lab.config.server.lite.stepb_dplus1_plus_lite_lane_local.json}"
DEFAULT_RUN_ID="perfect_proto_daily_trade_slate_sequence_shapelet_witness_bank_v57_$(date +%Y%m%d_%H%M%S)"
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
TRAIN_MAX_DECISION_DATES="48"
OOS_MAX_DECISION_DATES="16"
MAX_ROWS_PER_DATE="128"
EXTRA_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --support-cases-file=*) SUPPORT_CASES_FILE="${arg#*=}" ;;
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --train-max-decision-dates=*) TRAIN_MAX_DECISION_DATES="${arg#*=}" ;;
    --oos-max-decision-dates=*) OOS_MAX_DECISION_DATES="${arg#*=}" ;;
    --max-rows-per-date=*) MAX_ROWS_PER_DATE="${arg#*=}" ;;
    *) EXTRA_ARGS+=("$arg") ;;
  esac
done

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi

[[ -f "$CONFIG_PATH" ]] || { echo "[fatal] config not found: $CONFIG_PATH" >&2; exit 4; }
[[ -f "$LIB_PATH" ]] || { echo "[fatal] baseline wrapper helper library not found: $LIB_PATH" >&2; exit 4; }
source "$LIB_PATH"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_DIR="$RUN_DIR/step-perfect-prototype-daily-train-pack"
OOS_DIR="$RUN_DIR/step-perfect-prototype-daily-oos-pack"
TRAIN_CONTROL_DIR="$RUN_DIR/step-perfect-prototype-daily-train-control-pack"
OOS_CONTROL_DIR="$RUN_DIR/step-perfect-prototype-daily-oos-control-pack"
FAMILY_DIR="$RUN_DIR/step-perfect-prototype-daily-trade-slate-sequence-shapelet-witness-bank"
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
TRAIN_POSITIVE_DATES_PATH="$RUN_DIR/train_positive_dates.json"
OOS_POSITIVE_DATES_PATH="$RUN_DIR/oos_positive_dates.json"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
write_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_START" "$TRAIN_END" "decision_date_only"
write_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_START" "$OOS_END" "decision_date_only"
rewrite_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "1"
rewrite_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "1"
validate_baseline_contract_config "$TRAIN_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_baseline_contract_config "$OOS_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
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

PRIMARY_COMMON_ARGS=(
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_daily_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --requested-lookback-trading-days=1
  --max-rows-per-date="$MAX_ROWS_PER_DATE"
  --decision-date-sampling-mode=decision_date_stratified
)

node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
  --config="$TRAIN_CONFIG_PATH" \
  --out-dir="$TRAIN_DIR" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --discovery-universe-id=same_day_plus_recent_upto_1d \
  --seed-input="$TRAIN_STEPA_DIR/events_high8_lite.jsonl" \
  --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
  --allowed-stepa-lanes="$ALLOWED_STEPA_LANES" \
  --max-decision-dates="$TRAIN_MAX_DECISION_DATES" \
  "${PRIMARY_COMMON_ARGS[@]}"

node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
  --config="$OOS_CONFIG_PATH" \
  --out-dir="$OOS_DIR" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --discovery-universe-id=same_day_plus_recent_upto_1d \
  --seed-input="$OOS_STEPA_DIR/events_high8_lite.jsonl" \
  --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
  --allowed-stepa-lanes="$ALLOWED_STEPA_LANES" \
  --max-decision-dates="$OOS_MAX_DECISION_DATES" \
  "${PRIMARY_COMMON_ARGS[@]}"

node "$ROOT_DIR/tools/extract_perfect_prototype_positive_dates.mjs" --input="$TRAIN_INPUT_PATH" --out="$TRAIN_POSITIVE_DATES_PATH"
node "$ROOT_DIR/tools/extract_perfect_prototype_positive_dates.mjs" --input="$OOS_INPUT_PATH" --out="$OOS_POSITIVE_DATES_PATH"

node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
  --config="$TRAIN_CONFIG_PATH" \
  --out-dir="$TRAIN_CONTROL_DIR" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --discovery-universe-id=afree_open \
  --max-decision-dates="$TRAIN_MAX_DECISION_DATES" \
  --max-rows-per-date="$MAX_ROWS_PER_DATE" \
  --decision-date-sampling-mode=decision_date_stratified \
  --exclude-decision-dates-file="$TRAIN_POSITIVE_DATES_PATH" \
  --surface-name="$EXPECTED_CONTEXT_SURFACE" \
  --source-type=perfect_prototype_daily_pack \
  --line-id="$EXPECTED_BASELINE_LINE_ID"

node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
  --config="$OOS_CONFIG_PATH" \
  --out-dir="$OOS_CONTROL_DIR" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --discovery-universe-id=afree_open \
  --max-decision-dates="$OOS_MAX_DECISION_DATES" \
  --max-rows-per-date="$MAX_ROWS_PER_DATE" \
  --decision-date-sampling-mode=decision_date_stratified \
  --exclude-decision-dates-file="$OOS_POSITIVE_DATES_PATH" \
  --surface-name="$EXPECTED_CONTEXT_SURFACE" \
  --source-type=perfect_prototype_daily_pack \
  --line-id="$EXPECTED_BASELINE_LINE_ID"

node "$ROOT_DIR/tools/build_perfect_prototype_daily_trade_slate_sequence_shapelet_witness_bank.mjs" \
  --config="$TRAIN_CONFIG_PATH" \
  --train-input="$TRAIN_INPUT_PATH" \
  --train-control-input="$TRAIN_CONTROL_INPUT_PATH" \
  --oos-input="$OOS_INPUT_PATH" \
  --oos-control-input="$OOS_CONTROL_INPUT_PATH" \
  --support-cases-file="$SUPPORT_CASES_FILE" \
  --out-dir="$FAMILY_DIR" \
  --family-id=daily_trade_slate_sequence_shapelet_witness_bank \
  --target-universe-id=daily_trade_slate_v1 \
  --supplier-universe-id=same_day_plus_recent_upto_1d \
  --min-train-dates=10 \
  --min-train-months=6 \
  --min-train-folds=4 \
  --max-crossfit-negative-windows=0 \
  --min-oos-match-count=3 \
  --gate-max-feature-pool=8 \
  --gate-max-feature-count=4 \
  --max-witness-per-positive-date=2 \
  --max-negative-per-positive-date=2 \
  --prototype-min-date-count=4 \
  --prototype-max-count=5 \
  --prototype-max-share=0.7 \
  "${EXTRA_ARGS[@]}"

if [[ -f "$FAMILY_DIR/no_support_daily_trade_slate_sequence_shapelet_witness_bank_summary.json" ]]; then
  echo "[fatal] no feasible daily trade-slate sequence-shapelet artifact. see $FAMILY_DIR/no_support_daily_trade_slate_sequence_shapelet_witness_bank_summary.json" >&2
  exit 42
fi

echo "[ok] daily trade-slate sequence-shapelet solve complete"
echo "runId=$RUN_ID"
echo "familyDir=$FAMILY_DIR"
