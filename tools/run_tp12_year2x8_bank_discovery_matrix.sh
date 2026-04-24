#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_year2x8_bank_discovery_research_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_year2x8_bank_discovery_matrix.sh --run-id=<run_id> [--contract-path=PATH] [--scope-ids=LOW_GAP_TOP,LOW] [--candidate-ids=lb1,lb5] [--window-group=screen|all] [--candle-path=PATH] [--max-rules=N]
Server-only helper that runs the year2x8 bank-discovery matrix by deriving per-cell rolling contracts and delegating to the fixed TP12 no-stop scope rolling wrapper.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
RUN_ID=""
SCOPE_IDS=""
CANDIDATE_IDS=""
WINDOW_GROUP=""
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES=""

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
    --scope-ids=*)
      SCOPE_IDS="${1#*=}"
      shift
      ;;
    --candidate-ids=*)
      CANDIDATE_IDS="${1#*=}"
      shift
      ;;
    --window-group=*)
      WINDOW_GROUP="${1#*=}"
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
[[ -n "$RUN_ID" ]] || fatal "--run-id is required"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-year2x8-bank-discovery"
MANIFEST_PATH="$OUT_DIR/matrix_manifest.json"
SUMMARY_PATH="$OUT_DIR/matrix_summary.json"
MANIFEST_CELLS_JSONL="$OUT_DIR/matrix_manifest_cells.jsonl"
DERIVED_CONTRACT_DIR="$OUT_DIR/candidate_contracts"
CELLS_TSV="$OUT_DIR/resolved_cells.tsv"

if [[ -e "$OUT_DIR" ]]; then
  fatal "matrix out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR" "$DERIVED_CONTRACT_DIR"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$SCOPE_IDS" "$CANDIDATE_IDS" "$WINDOW_GROUP" "$CELLS_TSV" <<'NODE'
import fs from "node:fs/promises"

import { loadTp12Year2x8BankDiscoveryContract } from "./src/lib/tp12_year2x8_contract.mjs"
import { resolveTp12Year2x8BankDiscoveryCells } from "./src/lib/tp12_bank_grid_contracts.mjs"

const [contractPath, scopeIdsCsv, candidateIdsCsv, requestedWindowGroup, cellsTsvPath] = process.argv.slice(2)
const contract = await loadTp12Year2x8BankDiscoveryContract({
  contractPath,
  cwd: process.cwd(),
})
const scopeIds = String(scopeIdsCsv ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const candidateIds = String(candidateIdsCsv ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const cells = resolveTp12Year2x8BankDiscoveryCells({
  year2x8Contract: contract,
  scopeIds,
  candidateIds,
})
if (cells.length < 1) {
  throw new Error("No year2x8 discovery cells resolved")
}
await fs.writeFile(
  cellsTsvPath,
  `${cells.map((cell) => [cell.cellId, cell.scopeId, cell.candidateId, cell.lookbackTradingDays].join("\t")).join("\n")}\n`,
  "utf8",
)
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("RESOLVED_WINDOW_GROUP", String(requestedWindowGroup ?? "").trim() || contract.bankDiscovery.screenWindowGroup || "screen")
emit("CELL_COUNT", cells.length)
NODE
)"

while IFS=$'\t' read -r CELL_ID SCOPE_ID CANDIDATE_ID LOOKBACK_TRADING_DAYS || [[ -n "${CELL_ID:-}" ]]; do
  [[ -n "${CELL_ID:-}" ]] || continue
  CHILD_RUN_ID="${RUN_ID}_${CELL_ID}"
  CHILD_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}_${CELL_ID}.json"

  node tools/build_tp12_year2x8_bank_discovery_candidate_contract.mjs \
    "--contract-path=${RESOLVED_CONTRACT_PATH}" \
    "--scope-id=${SCOPE_ID}" \
    "--candidate-id=${CANDIDATE_ID}" \
    "--out=${CHILD_CONTRACT_PATH}" >/dev/null

  child_args=(
    "--contract-path=${CHILD_CONTRACT_PATH}"
    "--run-id=${CHILD_RUN_ID}"
    "--window-group=${RESOLVED_WINDOW_GROUP}"
    "--candle-path=${CANDLE_PATH}"
  )
  if [[ -n "$MAX_RULES" ]]; then
    child_args+=("--max-rules=${MAX_RULES}")
  fi
  bash tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh "${child_args[@]}"

  CHILD_SUMMARY_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_summary.json"
  CHILD_REPORT_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_report.md"
  [[ -f "$CHILD_SUMMARY_PATH" ]] || fatal "missing child rolling summary: $CHILD_SUMMARY_PATH"

  entry_json="$(
    node --input-type=module - "$CELL_ID" "$SCOPE_ID" "$CANDIDATE_ID" "$LOOKBACK_TRADING_DAYS" "$CHILD_RUN_ID" "$CHILD_CONTRACT_PATH" "$CHILD_SUMMARY_PATH" "$CHILD_REPORT_PATH" <<'NODE'
const [cellId, scopeId, candidateId, lookbackTradingDays, childRunId, childContractPath, rollingSummaryPath, rollingReportPath] =
  process.argv.slice(2)
console.log(
  JSON.stringify({
    cellId,
    scopeId,
    candidateId,
    lookbackTradingDays: Number(lookbackTradingDays),
    childRunId,
    childContractPath,
    rollingSummaryPath,
    rollingReportPath,
  }),
)
NODE
  )"
  printf '%s\n' "$entry_json" >> "$MANIFEST_CELLS_JSONL"
done < "$CELLS_TSV"

node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$RESOLVED_CONTRACT_PATH" "$RESOLVED_WINDOW_GROUP" "$MANIFEST_CELLS_JSONL" "$SCOPE_IDS" "$CANDIDATE_IDS" <<'NODE'
import fs from "node:fs/promises"

import { writeJson } from "./src/lib/io.mjs"

const [manifestPath, runId, contractPath, windowGroup, cellsJsonlPath, requestedScopeIdsCsv, requestedCandidateIdsCsv] =
  process.argv.slice(2)
const lines = String(await fs.readFile(cellsJsonlPath, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
const cells = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`Malformed matrix manifest cell entry at ${cellsJsonlPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
  }
})
await writeJson(manifestPath, {
  kind: "tp12_year2x8_bank_discovery_manifest_v1",
  generatedAt: new Date().toISOString(),
  runId,
  contractPath,
  windowGroup,
  requestedScopeIds: String(requestedScopeIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  requestedCandidateIds: String(requestedCandidateIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  cells,
})
NODE

node tools/build_tp12_year2x8_bank_discovery_summary.mjs \
  "--contract-path=${RESOLVED_CONTRACT_PATH}" \
  "--manifest-path=${MANIFEST_PATH}" \
  "--out=${SUMMARY_PATH}" \
  "--candle-path=${CANDLE_PATH}" >/dev/null

echo "[done] tp12 year2x8 bank discovery matrix completed runId=${RUN_ID} cells=${CELL_COUNT} summary=${SUMMARY_PATH}"
