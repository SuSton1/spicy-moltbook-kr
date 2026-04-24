#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
DEFAULT_CONFIG_PATH="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_target12.json"
DEFAULT_RUN_ID="perfect_proto_stepb_1d_tp12_low_gap_top_execution_menu_200k_$(date +%Y%m%d_%H%M%S)"
DEFAULT_SCOPE_RUN_ID="perfect_proto_stepb_1d_tp12_low_subscopes_control_200k_20260403_gap_top"
DEFAULT_SCOPE_LABEL="LOW_GAP_TOP"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"
EXPECTED_BASELINE_LINE_ID="stepb_dplus1_plus_lite_target12"
EXPECTED_CONTEXT_SURFACE="v3_contextual_plus_lite"
EXPECTED_MAX_GAP_TRADING_DAYS="100000"

RUN_ID="$DEFAULT_RUN_ID"
CONFIG_PATH="$DEFAULT_CONFIG_PATH"
SCOPE_RUN_ID="$DEFAULT_SCOPE_RUN_ID"
SCOPE_LABEL="$DEFAULT_SCOPE_LABEL"
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
RECENT_START="2026-02-01"
RECENT_END="2026-04-02"
LOOKBACK_DAYS="1"
DISCOVERY_UNIVERSE_ID="recent_impulse_upto_1d"
FOLD_SCHEME="chronological_4"
HOLD_DAYS="3"
TARGET_PCT="0.12"
STOP_LOSS_PCT="0.04"
REPORT_NODE_HEAP_MB="4096"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_report_node() {
  NODE_OPTIONS="--max-old-space-size=$REPORT_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<EOF2
Usage: bash tools/server_run_stepb_1d_tp12_execution_menu_low_gap_top_200k.sh [--run-id=<run_id>] [--scope-run-id=<child_run_id>] [--recent-start=YYYY-MM-DD] [--recent-end=YYYY-MM-DD]
Builds a fresh recent LOW_GAP_TOP pack and evaluates a fixed touch-donor execution menu on:
  - source train
  - source OOS
  - recent replay window
Defaults:
  scope-run-id=$DEFAULT_SCOPE_RUN_ID
  recent-start=$RECENT_START
  recent-end=$RECENT_END
  donor contract=NEXT_DAY_OPEN / 3d / +12% touch / no stop gate
  policy menu=stop recovery v1
EOF2
}

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --scope-run-id=*) SCOPE_RUN_ID="${arg#*=}" ;;
    --scope-label=*) SCOPE_LABEL="${arg#*=}" ;;
    --candle-path=*) CANDLE_PATH="${arg#*=}" ;;
    --recent-start=*) RECENT_START="${arg#*=}" ;;
    --recent-end=*) RECENT_END="${arg#*=}" ;;
    --lookback-days=*) LOOKBACK_DAYS="${arg#*=}" ;;
    --discovery-universe-id=*) DISCOVERY_UNIVERSE_ID="${arg#*=}" ;;
    --fold-scheme=*) FOLD_SCHEME="${arg#*=}" ;;
    --hold-days=*) HOLD_DAYS="${arg#*=}" ;;
    --target-pct=*) TARGET_PCT="${arg#*=}" ;;
    --stop-loss-pct=*) STOP_LOSS_PCT="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "Unknown argument: $arg" ;;
  esac
done

[[ "$ROOT_DIR" == "$EXPECTED_SERVER_ROOT" ]] || fatal "Run this wrapper on the server repo root: expected=$EXPECTED_SERVER_ROOT actual=$ROOT_DIR"
[[ -f "$CONFIG_PATH" ]] || fatal "config missing: $CONFIG_PATH"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"
[[ -f "$LIB_PATH" ]] || fatal "missing baseline helper library: $LIB_PATH"
source "$LIB_PATH"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
REPORT_DIR="$RUN_DIR/step-perfect-prototype-1d-tp12-execution-menu-report"
RUNTIME_DIR="$RUN_DIR/runtime"
RECENT_CONFIG_PATH="$RUNTIME_DIR/recent_config.json"
RECENT_STEPA_RUN_ID="${RUN_ID}_stepa_recent"
RECENT_STEPA_DIR="$ROOT_DIR/artifacts/runs/$RECENT_STEPA_RUN_ID/step-a"
RECENT_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-recent-pack"
RECENT_SCOPE_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-recent-low-gap-top-pack"
mkdir -p "$RUN_DIR" "$REPORT_DIR" "$RUNTIME_DIR"

write_period_config "$CONFIG_PATH" "$RECENT_CONFIG_PATH" "$RECENT_START" "$RECENT_END" "strict_label_boundary"
rewrite_recent_impulse_runtime_config "$RECENT_CONFIG_PATH" "$LOOKBACK_DAYS"
validate_baseline_contract_config "$RECENT_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$RECENT_CONFIG_PATH" "$LOOKBACK_DAYS"

eval "$(
  node --input-type=module - "$DISCOVERY_UNIVERSE_ID" "$LOOKBACK_DAYS" <<'NODE'
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

node "$ROOT_DIR/src/cli.mjs" step-a --config="$RECENT_CONFIG_PATH" --run-id="$RECENT_STEPA_RUN_ID"

node "$ROOT_DIR/tools/build_perfect_prototype_daily_pack.mjs" \
  --config="$RECENT_CONFIG_PATH" \
  --out-dir="$RECENT_PACK_DIR" \
  --start="$RECENT_START" \
  --end="$RECENT_END" \
  --surface-name="$EXPECTED_CONTEXT_SURFACE" \
  --source-type=perfect_prototype_stepb_open_eval_pack \
  --line-id="$EXPECTED_BASELINE_LINE_ID" \
  --discovery-universe-id="$DISCOVERY_UNIVERSE_ID" \
  --requested-lookback-trading-days="$LOOKBACK_DAYS" \
  --seed-input="$RECENT_STEPA_DIR/events_high8_lite.jsonl" \
  --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
  --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"

apply_strict_label_boundary_to_daily_pack "$RECENT_PACK_DIR" "$RECENT_START" "$RECENT_END" "strict_label_boundary"

node "$ROOT_DIR/tools/build_perfect_prototype_tp12_low_subscope_filtered_pack.mjs" \
  --input="$RECENT_PACK_DIR/daily_pack.jsonl" \
  --out-dir="$RECENT_SCOPE_PACK_DIR" \
  --subscope-id=LOW_GAP_TOP \
  --source-run-id="$RUN_ID" \
  --source-stage-label=recent \
  --row-contract=open_eval_recent_impulse_1d \
  --require-nonempty=true >/dev/null

started_at="$(date +%s)"
run_report_node "$ROOT_DIR/tools/build_stepb_1d_tp12_execution_menu_report.mjs" \
  --scope-run-id="$SCOPE_RUN_ID" \
  --scope-label="$SCOPE_LABEL" \
  --recent-input="$RECENT_SCOPE_PACK_DIR/daily_pack.jsonl" \
  --out-dir="$REPORT_DIR" \
  --candle-path="$CANDLE_PATH" \
  --fold-scheme="$FOLD_SCHEME" \
  --hold-days="$HOLD_DAYS" \
  --target-pct="$TARGET_PCT" \
  --stop-loss-pct="$STOP_LOSS_PCT"
finished_at="$(date +%s)"
elapsed_sec="$(( finished_at - started_at ))"

cat > "$REPORT_DIR/runtime.json" <<EOF2
{
  "runId": "$RUN_ID",
  "scopeRunId": "$SCOPE_RUN_ID",
  "scopeLabel": "$SCOPE_LABEL",
  "recentStart": "$RECENT_START",
  "recentEnd": "$RECENT_END",
  "recentConfigPath": "$RECENT_CONFIG_PATH",
  "recentPackPath": "$RECENT_PACK_DIR/daily_pack.jsonl",
  "recentScopePackPath": "$RECENT_SCOPE_PACK_DIR/daily_pack.jsonl",
  "discoveryUniverseId": "$DISCOVERY_UNIVERSE_ID",
  "lookbackDays": $LOOKBACK_DAYS,
  "foldScheme": "$FOLD_SCHEME",
  "holdDays": $HOLD_DAYS,
  "targetPct": $TARGET_PCT,
  "stopLossPct": $STOP_LOSS_PCT,
  "wallClockSec": $elapsed_sec
}
EOF2

cat <<EOF2
[done] 1D TP12 LOW_GAP_TOP execution menu completed
  runId=$RUN_ID
  scopeRunId=$SCOPE_RUN_ID
  recentScopePack=$RECENT_SCOPE_PACK_DIR/daily_pack.jsonl
  reportDir=$REPORT_DIR
  report=$REPORT_DIR/report.md
EOF2
