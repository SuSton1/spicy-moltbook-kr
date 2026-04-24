#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_RUN_PREFIX="perfect_proto_stepb_recent_impulse_matrix_$(date +%Y%m%d_%H%M%S)"

CONFIG_PATH="$DEFAULT_CONFIG"
RUN_PREFIX="$DEFAULT_RUN_PREFIX"
SPLIT_POLICY=""
LOOKBACKS_RAW="1,2,3,4,5,6,7,8"
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
SELECTION_MODE="union_all"
CLOSE28_FILTER_PCT="28"
MIN_HIT_COUNT="6"
HIT_COUNT_MODE=""
HIT_COUNT_DAY_SYMBOL_CAP=""
MAX_GAP="100000"
MAX_RULE_SIZE="6"
MAX_SEED_TOKENS="4000"
MAX_RULES="4000"
MAX_SEARCH_STATES="20000000"
SEARCH_MODE="exact_indexed_kernel_v1"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepb_recent_impulse_matrix.sh --split-policy=decision_date_only|strict_label_boundary [--config=/abs/path/config.json] [--run-prefix=<prefix>] [--lookbacks=1,2,3,4,5,6,7,8] [server_run_stepb_dplus1_plus_lite.sh compatible tuning args...]
Runs recent_impulse_upto_Nd discovery families under the shared stepb_dplus1_plus_lite contract and writes a matrix manifest.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-prefix=*) RUN_PREFIX="${arg#*=}" ;;
    --split-policy=*) SPLIT_POLICY="${arg#*=}" ;;
    --lookbacks=*) LOOKBACKS_RAW="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --selection-mode=*) SELECTION_MODE="${arg#*=}" ;;
    --close28-filter-pct=*) CLOSE28_FILTER_PCT="${arg#*=}" ;;
    --min-hit-count=*) MIN_HIT_COUNT="${arg#*=}" ;;
    --hit-count-mode=*) HIT_COUNT_MODE="${arg#*=}" ;;
    --hit-count-day-symbol-cap=*) HIT_COUNT_DAY_SYMBOL_CAP="${arg#*=}" ;;
    --max-gap=*) MAX_GAP="${arg#*=}" ;;
    --max-rule-size=*) MAX_RULE_SIZE="${arg#*=}" ;;
    --max-seed-tokens=*) MAX_SEED_TOKENS="${arg#*=}" ;;
    --max-rules=*) MAX_RULES="${arg#*=}" ;;
    --max-search-states=*) MAX_SEARCH_STATES="${arg#*=}" ;;
    --search-mode=*) SEARCH_MODE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "unknown arg: $arg" ;;
  esac
done

ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "server-only recent impulse matrix wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi
[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"

case "$SPLIT_POLICY" in
  decision_date_only|strict_label_boundary) ;;
  "") fatal "missing --split-policy=decision_date_only|strict_label_boundary" ;;
  *) fatal "invalid --split-policy: $SPLIT_POLICY" ;;
esac

LOOKBACKS_NORMALIZED="$(
  node --input-type=module - "$LOOKBACKS_RAW" <<'NODE'
const [raw] = process.argv.slice(2)
const values = Array.from(
  new Set(
    String(raw ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 8),
  ),
).sort((left, right) => left - right)
if (values.length < 1) {
  throw new Error(`lookbacks must contain integers in [1,8], got ${raw || "null"}`)
}
process.stdout.write(values.join(","))
NODE
)"
IFS=',' read -r -a LOOKBACKS <<< "$LOOKBACKS_NORMALIZED"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_PREFIX"
MANIFEST_ROWS_PATH="$RUN_DIR/recent_impulse_matrix_runs.jsonl"
MANIFEST_PATH="$RUN_DIR/recent_impulse_matrix_manifest.json"
mkdir -p "$RUN_DIR"
: > "$MANIFEST_ROWS_PATH"

for LOOKBACK in "${LOOKBACKS[@]}"; do
  DISCOVERY_UNIVERSE_ID="recent_impulse_upto_${LOOKBACK}d"
  RUN_ID="${RUN_PREFIX}_${DISCOVERY_UNIVERSE_ID}"
  CMD=(
    bash tools/server_run_stepb_dplus1_plus_lite.sh
    --config="$CONFIG_PATH"
    --run-id="$RUN_ID"
    --split-policy="$SPLIT_POLICY"
    --train-start="$TRAIN_START"
    --train-end="$TRAIN_END"
    --oos-start="$OOS_START"
    --oos-end="$OOS_END"
    --selection-mode="$SELECTION_MODE"
    --close28-filter-pct="$CLOSE28_FILTER_PCT"
    --min-hit-count="$MIN_HIT_COUNT"
    --max-gap="$MAX_GAP"
    --max-rule-size="$MAX_RULE_SIZE"
    --max-seed-tokens="$MAX_SEED_TOKENS"
    --max-rules="$MAX_RULES"
    --max-search-states="$MAX_SEARCH_STATES"
    --search-mode="$SEARCH_MODE"
    --discovery-universe-id="$DISCOVERY_UNIVERSE_ID"
    --recent-impulse-lookback-days="$LOOKBACK"
  )
  if [[ -n "$HIT_COUNT_MODE" ]]; then
    CMD+=(--hit-count-mode="$HIT_COUNT_MODE")
  fi
  if [[ -n "$HIT_COUNT_DAY_SYMBOL_CAP" ]]; then
    CMD+=(--hit-count-day-symbol-cap="$HIT_COUNT_DAY_SYMBOL_CAP")
  fi
  "${CMD[@]}"
  node --input-type=module - "$MANIFEST_ROWS_PATH" "$RUN_ID" "$LOOKBACK" "$DISCOVERY_UNIVERSE_ID" <<'NODE'
import fs from "node:fs/promises"

const [rowsPath, runId, lookbackRaw, discoveryUniverseId] = process.argv.slice(2)
const lookback = Number(lookbackRaw)
const payload = {
  runId,
  discoveryUniverseId,
  requestedLookbackTradingDays: lookback,
  runDir: `artifacts/runs/${runId}`,
  freezeResultPath: `artifacts/runs/${runId}/freeze_result.json`,
}
await fs.appendFile(rowsPath, `${JSON.stringify(payload)}\n`, "utf8")
NODE
done

node --input-type=module - "$MANIFEST_ROWS_PATH" "$MANIFEST_PATH" "$RUN_PREFIX" "$CONFIG_PATH" "$SPLIT_POLICY" "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END" "$SELECTION_MODE" "$SEARCH_MODE" <<'NODE'
import fs from "node:fs/promises"

const [rowsPath, manifestPath, runPrefix, configPath, splitPolicy, trainStart, trainEnd, oosStart, oosEnd, selectionMode, searchMode] =
  process.argv.slice(2)
const lines = String(await fs.readFile(rowsPath, "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
const runs = lines.map((line) => JSON.parse(line))
await fs.writeFile(
  manifestPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    runPrefix,
    configPath,
    splitPolicy,
    selectionMode,
    searchMode,
    trainWindow: {
      start: trainStart,
      end: trainEnd,
    },
    oosWindow: {
      start: oosStart,
      end: oosEnd,
    },
    runs,
  }, null, 2)}\n`,
  "utf8",
)
NODE

echo "[ok] recent impulse matrix run complete"
echo "runPrefix=$RUN_PREFIX"
echo "manifest=$MANIFEST_PATH"
