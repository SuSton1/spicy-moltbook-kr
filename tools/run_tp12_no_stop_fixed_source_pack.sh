#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_fixed_year2hit_research_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_no_stop_fixed_source_pack.sh --split-id=<id> --run-id=<run_id> [--contract-path=PATH]
Server-only helper that resolves one explicit fixed split and rebuilds fresh train/oos open packs plus control-input provenance.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
SPLIT_ID=""
RUN_ID=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      CONTRACT_PATH="${1#*=}"
      shift
      ;;
    --split-id=*)
      SPLIT_ID="${1#*=}"
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
  fatal "tp12 no-stop fixed source-pack builder must run from $EXPECTED_REAL, got $ROOT_REAL"
fi
[[ -n "$SPLIT_ID" ]] || fatal "--split-id is required"
[[ -n "$RUN_ID" ]] || fatal "--run-id is required"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$SPLIT_ID" <<'NODE'
import {
  loadTp12NoStopFixedResearchContract,
  resolveTp12NoStopFixedSplit,
} from "./src/lib/tp12_no_stop_fixed_contract.mjs"

const [contractPath, splitId] = process.argv.slice(2)
const contract = await loadTp12NoStopFixedResearchContract({
  contractPath,
  cwd: process.cwd(),
})
const split = resolveTp12NoStopFixedSplit({
  contract,
  splitId,
})
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
const emitNumber = (key, value) => {
  console.log(`${key}=${Number(value)}`)
}
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("SPLIT_KIND", split.kind)
emit("TRAIN_START", split.trainDateFrom)
emit("TRAIN_END", split.trainDateTo)
emit("OOS_START", split.oosDateFrom)
emit("OOS_END", split.oosDateTo)
emit("CONFIG_PATH", contract.searchContract.configPath)
emit("EXPECTED_LINE_ID", contract.searchContract.lineId)
emit("EXPECTED_CONTEXT_SURFACE", contract.searchContract.contextSurface)
emit("SPLIT_POLICY", contract.searchContract.splitPolicy)
emit("DISCOVERY_UNIVERSE_ID", contract.inputContract.discoveryUniverseId)
emitNumber("RECENT_IMPULSE_LOOKBACK_DAYS", contract.inputContract.requestedLookbackTradingDays)
NODE
)"

DERIVED_CONTRACT_DIR="$ROOT/artifacts/tp12_no_stop_fixed/split_contracts"
DERIVED_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}.json"

node --input-type=module - "$CONTRACT_PATH" "$SPLIT_ID" "$DERIVED_CONTRACT_PATH" <<'NODE'
import { loadTp12NoStopFixedResearchContract, writeTp12NoStopFixedDerivedSideDailyContract } from "./src/lib/tp12_no_stop_fixed_contract.mjs"

const [contractPath, splitId, outPath] = process.argv.slice(2)
const contract = await loadTp12NoStopFixedResearchContract({
  contractPath,
  cwd: process.cwd(),
})
await writeTp12NoStopFixedDerivedSideDailyContract({
  fixedContract: contract,
  splitId,
  outPath,
})
NODE

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

node --input-type=module - "$DERIVED_CONTRACT_PATH" "$RUN_ID" "$SPLIT_ID" "$SPLIT_KIND" <<'NODE'
import path from "node:path"
import { writeJson } from "./src/lib/io.mjs"

const [derivedContractPath, runId, splitId, splitKind] = process.argv.slice(2)
const outPath = path.join(
  process.cwd(),
  "artifacts",
  "tp12_no_stop_fixed",
  "split_contracts",
  `${runId}_summary.json`,
)
await writeJson(outPath, {
  generatedAt: new Date().toISOString(),
  runId,
  splitId,
  splitKind,
  derivedContractPath,
})
NODE

echo "[done] tp12 no-stop fixed source pack completed runId=${RUN_ID} splitId=${SPLIT_ID} contract=${DERIVED_CONTRACT_PATH}"
