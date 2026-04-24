#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh --contract-path=PATH --run-id=<run_id> [--window-group=screen|final|all] [--window-ids=w1,w2] [--candle-path=PATH] [--max-rules=N] [--prune-source-runs]
Server-only orchestrator for TP12 no-stop scope-expansion rolling runs under a fixed lookback winner.
EOF
}

CONTRACT_PATH=""
RUN_ID=""
WINDOW_GROUP="screen"
WINDOW_IDS=""
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES=""
PRUNE_SOURCE_RUNS=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      CONTRACT_PATH="${1#*=}"
      shift
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
      shift
      ;;
    --window-group=*)
      WINDOW_GROUP="${1#*=}"
      shift
      ;;
    --window-ids=*)
      WINDOW_IDS="${1#*=}"
      shift
      ;;
    --candle-path=*)
      CANDLE_PATH="${1#*=}"
      shift
      ;;
    --max-rules=*)
      MAX_RULES="${1#*=}"
      shift
      ;;
    --prune-source-runs)
      PRUNE_SOURCE_RUNS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"
ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "Run this wrapper on the server repo root: expected=$EXPECTED_REAL actual=$ROOT_REAL"
fi
[[ -n "$CONTRACT_PATH" ]] || fatal "--contract-path is required"
[[ -n "$RUN_ID" ]] || fatal "--run-id is required"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$WINDOW_GROUP" "$WINDOW_IDS" <<'NODE'
import {
  loadTp12NoStopRollingResearchContract,
  resolveTp12NoStopRollingWindows,
} from "./src/lib/tp12_no_stop_rolling_contract.mjs"

const [contractPath, windowGroup, windowIdsRaw] = process.argv.slice(2)
const contract = await loadTp12NoStopRollingResearchContract({
  contractPath,
  cwd: process.cwd(),
})
const windowIds = String(windowIdsRaw ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const windows = resolveTp12NoStopRollingWindows({
  contract,
  windowGroup,
  windowIds,
})
if (windows.length < 1) {
  throw new Error(`No rolling windows resolved for group=${windowGroup}`)
}
const emit = (key, value) => console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("SCOPE_ID", contract.scopeId)
emit("WINDOW_ID_LIST", windows.map((window) => window.windowId).join(","))
NODE
)"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling"
MANIFEST_PATH="$OUT_DIR/rolling_manifest.json"
SUMMARY_PATH="$OUT_DIR/rolling_summary.json"
MANIFEST_WINDOWS_JSONL="$OUT_DIR/rolling_manifest_windows.jsonl"

if [[ -e "$OUT_DIR" ]]; then
  fatal "rolling out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR/windows"

window_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_'
}

prune_run_dir() {
  local run_id="$1"
  local run_dir="$ROOT_DIR/artifacts/runs/$run_id"
  if [[ ! -d "$run_dir" ]]; then
    return 0
  fi
  case "$run_dir" in
    "$ROOT_DIR"/artifacts/runs/*) ;;
    *)
      fatal "refusing to prune unexpected run dir: $run_dir"
      ;;
  esac
  rm -rf "$run_dir"
  echo "[pruned] source run artifacts runId=$run_id dir=$run_dir"
}

IFS=',' read -r -a window_ids_array <<< "$WINDOW_ID_LIST"
for window_id in "${window_ids_array[@]}"; do
  [[ -n "$window_id" ]] || continue
  slug="$(window_slug "$window_id")"
  source_run_id="${RUN_ID}_${slug}_source"
  scope_run_id="${RUN_ID}_${slug}_scope"
  window_out_dir="$OUT_DIR/windows/$slug"
  window_args=(
    "--contract-path=${RESOLVED_CONTRACT_PATH}"
    "--window-id=${window_id}"
    "--source-run-id=${source_run_id}"
    "--run-id=${scope_run_id}"
    "--candle-path=${CANDLE_PATH}"
  )
  if [[ -n "$MAX_RULES" ]]; then
    window_args+=("--max-rules=${MAX_RULES}")
  fi

  bash tools/run_tp12_no_stop_rolling_source_pack.sh \
    "--contract-path=${RESOLVED_CONTRACT_PATH}" \
    "--window-id=${window_id}" \
    "--run-id=${source_run_id}"

  bash tools/run_stepb_1d_tp12_no_stop_scope_window.sh "${window_args[@]}"

  node tools/build_stepb_1d_tp12_no_stop_window_report.mjs \
    "--contract-path=${RESOLVED_CONTRACT_PATH}" \
    "--window-id=${window_id}" \
    "--source-run-id=${source_run_id}" \
    "--scope-run-id=${scope_run_id}" \
    "--out-dir=${window_out_dir}" \
    "--candle-path=${CANDLE_PATH}"

  summary_path="$window_out_dir/window_summary.json"
  entry_json="$(node --input-type=module - "$window_id" "$source_run_id" "$scope_run_id" "$summary_path" <<'NODE'
const [windowId, sourceRunId, scopeRunId, summaryPath] = process.argv.slice(2)
console.log(
  JSON.stringify({
    windowId,
    sourceRunId,
    scopeRunId,
    summaryPath,
  }),
)
NODE
)"
  printf '%s\n' "$entry_json" >> "$MANIFEST_WINDOWS_JSONL"
  if [[ "$PRUNE_SOURCE_RUNS" == "1" ]]; then
    # Rolling summaries depend on the window report, not on the large source-run pack artifacts.
    prune_run_dir "$source_run_id"
  fi
done

node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$WINDOW_GROUP" "$RESOLVED_CONTRACT_PATH" "$MANIFEST_WINDOWS_JSONL" "$WINDOW_ID_LIST" "$MAX_RULES" "$SCOPE_ID" <<'NODE'
import fs from "node:fs/promises"

import { writeJson } from "./src/lib/io.mjs"

const [manifestPath, runId, windowGroup, contractPath, windowsJsonlPath, requestedWindowIdsRaw, maxRulesOverrideRaw, scopeId] =
  process.argv.slice(2)
const lines = String(await fs.readFile(windowsJsonlPath, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
const windows = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`Malformed rolling manifest window entry at ${windowsJsonlPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
  }
})
const requestedWindowIds = String(requestedWindowIdsRaw ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const maxRulesOverride = Number(maxRulesOverrideRaw)
await writeJson(manifestPath, {
  kind: "tp12_no_stop_scope_rolling_manifest_v1",
  generatedAt: new Date().toISOString(),
  runId,
  scopeId,
  windowGroup,
  contractPath,
  requestedWindowIds,
  maxRulesOverride:
    Number.isInteger(maxRulesOverride) && maxRulesOverride > 0 ? maxRulesOverride : null,
  windows,
})
NODE

bash tools/run_tp12_no_stop_rolling_summary.sh \
  "--contract-path=${RESOLVED_CONTRACT_PATH}" \
  "--manifest-path=${MANIFEST_PATH}" \
  "--out=${SUMMARY_PATH}"

echo "[done] tp12 no-stop scope rolling completed scopeId=${SCOPE_ID} runId=${RUN_ID} summary=${SUMMARY_PATH}"
