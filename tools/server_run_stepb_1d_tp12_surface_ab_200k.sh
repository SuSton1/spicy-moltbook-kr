#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_RUN_ID="perfect_proto_stepb_1d_tp12_surface_ab_200k_$(date +%Y%m%d_%H%M%S)"

RUN_ID="$DEFAULT_RUN_ID"
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
MAX_SEARCH_STATES="200000"
MIN_HIT_COUNT="4"
MIN_TRAIN_MATCHED_DATES="4"
MIN_TRAIN_MATCHED_MONTHS="4"
MIN_TRAIN_MATCHED_FOLDS="3"
FOLD_SCHEME="chronological_4"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepb_1d_tp12_surface_ab_200k.sh [--run-id=<run_id>] [--train-start=YYYY-MM-DD] [--train-end=YYYY-MM-DD] [--oos-start=YYYY-MM-DD] [--oos-end=YYYY-MM-DD] [--max-search-states=200000] [--min-hit-count=4]
Runs a server-only 1D / 3-day / 12% / 4% surface A/B experiment:
  - control baseline surface v3_contextual_plus_lite
  - variant TP12 surface v7_contextual_plus_lite_tp12
Both children use:
  - strict_label_boundary
  - discoveryUniverseId=recent_impulse_upto_1d
  - requestedLookbackTradingDays=1
  - NEXT_DAY_OPEN / 3d / 12% / 4%
  - baseline conjunction language
  - max-rule-size=6
EOF
}

for arg in "$@"; do
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --max-search-states=*) MAX_SEARCH_STATES="${arg#*=}" ;;
    --min-hit-count=*) MIN_HIT_COUNT="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      fatal "Unknown argument: $arg"
      ;;
  esac
done

[[ "$ROOT_DIR" == "$EXPECTED_SERVER_ROOT" ]] || fatal "Run this wrapper on the server repo root: expected=$EXPECTED_SERVER_ROOT actual=$ROOT_DIR"

CONTROL_RUN_ID="${RUN_ID}_control"
VARIANT_RUN_ID="${RUN_ID}_surface_v1"
PARENT_RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
OUT_DIR="$PARENT_RUN_DIR/step-perfect-prototype-1d-tp12-surface-ab-report"
CONTROL_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_target12.json"
VARIANT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_target12_surface_v1.json"

mkdir -p "$OUT_DIR"

run_child() {
  local variant="$1"
  local run_id="$2"
  local config_path="$3"
  local expected_line_id="$4"
  local expected_surface="$5"
  local exit_code=0
  local started_at=0
  local finished_at=0
  local elapsed_sec=0

  started_at="$(date +%s)"
  set +e
  STEPB_PLUS_LITE_WRAPPER_LINE_ID="$expected_line_id" \
    STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE="$expected_surface" \
    bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite.sh" \
      --config="$config_path" \
      --run-id="$run_id" \
      --split-policy=strict_label_boundary \
      --train-start="$TRAIN_START" \
      --train-end="$TRAIN_END" \
      --oos-start="$OOS_START" \
      --oos-end="$OOS_END" \
      --selection-mode=union_all \
      --discovery-universe-id=recent_impulse_upto_1d \
      --recent-impulse-lookback-days=1 \
      --min-hit-count="$MIN_HIT_COUNT" \
      --enable-train-matched-date-prune=true \
      --min-train-matched-dates="$MIN_TRAIN_MATCHED_DATES" \
      --min-train-matched-months="$MIN_TRAIN_MATCHED_MONTHS" \
      --min-train-matched-folds="$MIN_TRAIN_MATCHED_FOLDS" \
      --fold-scheme="$FOLD_SCHEME" \
      --max-rule-size=6 \
      --max-search-states="$MAX_SEARCH_STATES"
  exit_code=$?
  set -e
  finished_at="$(date +%s)"
  elapsed_sec="$(( finished_at - started_at ))"
  printf '%s\n' "$exit_code" > "$OUT_DIR/${variant}_exit_code.txt"
  cat > "$OUT_DIR/${variant}_runtime.json" <<EOF
{
  "variant": "$variant",
  "runId": "$run_id",
  "exitCode": $exit_code,
  "wallClockSec": $elapsed_sec
}
EOF
  if [[ "$exit_code" -ne 0 && "$exit_code" -ne 42 ]]; then
    fatal "${variant} child run failed unexpectedly with exit=${exit_code}"
  fi
}

run_child \
  "control" \
  "$CONTROL_RUN_ID" \
  "$CONTROL_CONFIG" \
  "stepb_dplus1_plus_lite_target12" \
  "v3_contextual_plus_lite"

run_child \
  "variant" \
  "$VARIANT_RUN_ID" \
  "$VARIANT_CONFIG" \
  "stepb_dplus1_plus_lite_target12_surface_v1" \
  "v7_contextual_plus_lite_tp12"

CONTROL_EXIT_CODE="$(cat "$OUT_DIR/control_exit_code.txt")"
VARIANT_EXIT_CODE="$(cat "$OUT_DIR/variant_exit_code.txt")"
CONTROL_WALL_SEC="$(node --input-type=module - "$OUT_DIR/control_runtime.json" <<'NODE'
import fs from "node:fs/promises"
const [inputPath] = process.argv.slice(2)
const payload = JSON.parse(await fs.readFile(inputPath, "utf8"))
console.log(Number(payload?.wallClockSec ?? 0) || 0)
NODE
)"
VARIANT_WALL_SEC="$(node --input-type=module - "$OUT_DIR/variant_runtime.json" <<'NODE'
import fs from "node:fs/promises"
const [inputPath] = process.argv.slice(2)
const payload = JSON.parse(await fs.readFile(inputPath, "utf8"))
console.log(Number(payload?.wallClockSec ?? 0) || 0)
NODE
)"

node tools/build_stepb_1d_tp12_surface_ab_report.mjs \
  --run-id="$RUN_ID" \
  --control-run-id="$CONTROL_RUN_ID" \
  --variant-run-id="$VARIANT_RUN_ID" \
  --control-exit-code="$CONTROL_EXIT_CODE" \
  --variant-exit-code="$VARIANT_EXIT_CODE" \
  --control-wall-sec="$CONTROL_WALL_SEC" \
  --variant-wall-sec="$VARIANT_WALL_SEC" \
  --out-dir="$OUT_DIR"

cat <<EOF
[done] 1D TP12 surface A/B completed
  parentRunId=$RUN_ID
  controlRunId=$CONTROL_RUN_ID exit=$CONTROL_EXIT_CODE
  variantRunId=$VARIANT_RUN_ID exit=$VARIANT_EXIT_CODE
  report=$OUT_DIR/report.md
EOF
