#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_rolling_research_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_no_stop_rolling_source_pack.sh --window-id=<id> --run-id=<run_id> [--contract-path=PATH]
Server-only helper that materializes one derived side-daily control contract for a rolling window
and rebuilds fresh train/oos open packs plus control-input provenance under the TP12 no-stop config.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
WINDOW_ID=""
RUN_ID=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      CONTRACT_PATH="${1#*=}"
      shift
      ;;
    --window-id=*)
      WINDOW_ID="${1#*=}"
      shift
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
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

cd "$ROOT"
ROOT_REAL="$(cd "$ROOT" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "tp12 no-stop rolling source-pack builder must run from $EXPECTED_REAL, got $ROOT_REAL"
fi
[[ -n "$WINDOW_ID" ]] || fatal "--window-id is required"
[[ -n "$RUN_ID" ]] || fatal "--run-id is required"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$WINDOW_ID" <<'NODE'
import {
  loadTp12NoStopRollingResearchContract,
  resolveTp12NoStopRollingWindow,
} from "./src/lib/tp12_no_stop_rolling_contract.mjs"

const [contractPath, windowId] = process.argv.slice(2)
const contract = await loadTp12NoStopRollingResearchContract({
  contractPath,
  cwd: process.cwd(),
})
const window = resolveTp12NoStopRollingWindow({
  contract,
  windowId,
})
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
const emitNumber = (key, value) => {
  console.log(`${key}=${Number(value)}`)
}
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("WINDOW_KIND", window.kind)
emit("TRAIN_START", window.trainDateFrom)
emit("TRAIN_END", window.trainDateTo)
emit("OOS_START", window.oosDateFrom)
emit("OOS_END", window.oosDateTo)
emit("CONFIG_PATH", contract.searchContract.configPath)
emit("EXPECTED_LINE_ID", contract.searchContract.lineId)
emit("EXPECTED_CONTEXT_SURFACE", contract.searchContract.contextSurface)
emit("SPLIT_POLICY", contract.searchContract.splitPolicy)
emit("DISCOVERY_UNIVERSE_ID", contract.inputContract.discoveryUniverseId)
emitNumber("RECENT_IMPULSE_LOOKBACK_DAYS", contract.inputContract.requestedLookbackTradingDays)
NODE
)"

DERIVED_CONTRACT_DIR="$ROOT/artifacts/tp12_no_stop_rolling/window_contracts"
DERIVED_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}.json"

node tools/build_tp12_no_stop_rolling_window_contract.mjs \
  "--contract-path=${RESOLVED_CONTRACT_PATH}" \
  "--window-id=${WINDOW_ID}" \
  "--out=${DERIVED_CONTRACT_PATH}" >/dev/null

STEPB_PLUS_LITE_WRAPPER_LINE_ID="$EXPECTED_LINE_ID" \
STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE="$EXPECTED_CONTEXT_SURFACE" \
bash tools/run_tp12_side_daily_control_inputs.sh \
  "--config=${CONFIG_PATH}" \
  "--contract-path=${DERIVED_CONTRACT_PATH}" \
  "--run-id=${RUN_ID}" \
  "--split-policy=${SPLIT_POLICY}" \
  "--train-start=${TRAIN_START}" \
  "--train-end=${TRAIN_END}" \
  "--oos-start=${OOS_START}" \
  "--oos-end=${OOS_END}" \
  "--discovery-universe-id=${DISCOVERY_UNIVERSE_ID}" \
  "--recent-impulse-lookback-days=${RECENT_IMPULSE_LOOKBACK_DAYS}"

node --input-type=module - "$DERIVED_CONTRACT_PATH" "$RUN_ID" "$WINDOW_ID" "$WINDOW_KIND" <<'NODE'
import path from "node:path"
import { writeJson } from "./src/lib/io.mjs"

const [derivedContractPath, runId, windowId, windowKind] = process.argv.slice(2)
const outPath = path.join(
  process.cwd(),
  "artifacts",
  "tp12_no_stop_rolling",
  "window_contracts",
  `${runId}_summary.json`,
)
await writeJson(outPath, {
  generatedAt: new Date().toISOString(),
  runId,
  windowId,
  windowKind,
  derivedContractPath,
})
NODE

echo "[done] tp12 no-stop rolling source pack completed runId=${RUN_ID} windowId=${WINDOW_ID} contract=${DERIVED_CONTRACT_PATH}"
