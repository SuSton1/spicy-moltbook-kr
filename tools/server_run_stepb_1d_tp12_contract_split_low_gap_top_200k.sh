#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_RUN_ID="perfect_proto_stepb_1d_tp12_low_gap_top_touch_contract_200k_$(date +%Y%m%d_%H%M%S)"
DEFAULT_SCOPE_RUN_ID="perfect_proto_stepb_1d_tp12_low_subscopes_control_200k_20260403_gap_top"
DEFAULT_SCOPE_LABEL="LOW_GAP_TOP"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"
REPORT_NODE_HEAP_MB="4096"

RUN_ID="$DEFAULT_RUN_ID"
SCOPE_RUN_ID="$DEFAULT_SCOPE_RUN_ID"
SCOPE_LABEL="$DEFAULT_SCOPE_LABEL"
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
FOLD_SCHEME="chronological_4"
HOLD_DAYS="3"
TARGET_PCT="0.12"
STOP_LOSS_PCT="0.04"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_report_node() {
  NODE_OPTIONS="--max-old-space-size=$REPORT_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<EOF2
Usage: bash tools/server_run_stepb_1d_tp12_contract_split_low_gap_top_200k.sh [--run-id=<run_id>] [--scope-run-id=<child_run_id>] [--scope-label=LOW_GAP_TOP] [--candle-path=<data/candle_daily.jsonl>] [--fold-scheme=chronological_4] [--hold-days=3] [--target-pct=0.12] [--stop-loss-pct=0.04]
Runs the server-only LOW_GAP_TOP TP12 contract-split report against an existing filtered child run.
Defaults:
  scope-run-id=$DEFAULT_SCOPE_RUN_ID
  scope-label=$DEFAULT_SCOPE_LABEL
  contract=NEXT_DAY_OPEN / 3d / +12% touch / no stop gate
  clean validation reuses the existing NEXT_DAY_OPEN / 3d / TP12 / SL4 metrics from the source run
EOF2
}

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --scope-run-id=*) SCOPE_RUN_ID="${arg#*=}" ;;
    --scope-label=*) SCOPE_LABEL="${arg#*=}" ;;
    --candle-path=*) CANDLE_PATH="${arg#*=}" ;;
    --fold-scheme=*) FOLD_SCHEME="${arg#*=}" ;;
    --hold-days=*) HOLD_DAYS="${arg#*=}" ;;
    --target-pct=*) TARGET_PCT="${arg#*=}" ;;
    --stop-loss-pct=*) STOP_LOSS_PCT="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "Unknown argument: $arg" ;;
  esac
done

[[ "$ROOT_DIR" == "$EXPECTED_SERVER_ROOT" ]] || fatal "Run this wrapper on the server repo root: expected=$EXPECTED_SERVER_ROOT actual=$ROOT_DIR"
[[ -n "$RUN_ID" ]] || fatal "--run-id must not be empty"
[[ -n "$SCOPE_RUN_ID" ]] || fatal "--scope-run-id must not be empty"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

PARENT_RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
OUT_DIR="$PARENT_RUN_DIR/step-perfect-prototype-1d-tp12-contract-split-report"
mkdir -p "$OUT_DIR"

started_at="$(date +%s)"
run_report_node tools/build_stepb_1d_tp12_contract_split_report.mjs \
  --scope-run-id="$SCOPE_RUN_ID" \
  --scope-label="$SCOPE_LABEL" \
  --out-dir="$OUT_DIR" \
  --candle-path="$CANDLE_PATH" \
  --fold-scheme="$FOLD_SCHEME" \
  --hold-days="$HOLD_DAYS" \
  --target-pct="$TARGET_PCT" \
  --stop-loss-pct="$STOP_LOSS_PCT"
finished_at="$(date +%s)"
elapsed_sec="$(( finished_at - started_at ))"

cat > "$OUT_DIR/runtime.json" <<EOF2
{
  "runId": "$RUN_ID",
  "scopeRunId": "$SCOPE_RUN_ID",
  "scopeLabel": "$SCOPE_LABEL",
  "wallClockSec": $elapsed_sec,
  "foldScheme": "$FOLD_SCHEME",
  "holdDays": $HOLD_DAYS,
  "targetPct": $TARGET_PCT,
  "stopLossPct": $STOP_LOSS_PCT
}
EOF2

cat <<EOF2
[done] 1D TP12 LOW_GAP_TOP contract split completed
  runId=$RUN_ID
  scopeRunId=$SCOPE_RUN_ID
  outDir=$OUT_DIR
  report=$OUT_DIR/report.md
EOF2
