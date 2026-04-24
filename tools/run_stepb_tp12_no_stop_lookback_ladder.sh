#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_lookback_ladder_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_stepb_tp12_no_stop_lookback_ladder.sh --run-id=<run_id> [--contract-path=PATH] [--candidate-group=sparse|dense_fill|all] [--candidate-ids=lb1,lb3] [--window-group=screen|final|all] [--window-ids=w1,w2]
Server-only orchestrator for the deferred TP12 no-stop lookback ladder scaffold.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
RUN_ID=""
CANDIDATE_GROUP="sparse"
CANDIDATE_IDS=""
WINDOW_GROUP="screen"
WINDOW_IDS=""

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
    --candidate-group=*)
      CANDIDATE_GROUP="${1#*=}"
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
    --window-ids=*)
      WINDOW_IDS="${1#*=}"
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

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$CANDIDATE_GROUP" "$CANDIDATE_IDS" <<'NODE'
import {
  loadTp12NoStopLookbackLadderContract,
  resolveTp12NoStopLookbackCandidates,
} from "./src/lib/tp12_no_stop_lookback_ladder_contract.mjs"

const [contractPath, candidateGroup, candidateIdsRaw] = process.argv.slice(2)
const ladderContract = await loadTp12NoStopLookbackLadderContract({
  contractPath,
  cwd: process.cwd(),
})
const candidateIds = String(candidateIdsRaw ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const candidates = resolveTp12NoStopLookbackCandidates({
  ladderContract,
  candidateGroup,
  candidateIds,
})
if (candidates.length < 1) {
  throw new Error(`No lookback ladder candidates resolved for group=${candidateGroup}`)
}
const emit = (key, value) => console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
emit("RESOLVED_CONTRACT_PATH", ladderContract.contractPath)
emit("CANDIDATE_ID_LIST", candidates.map((candidate) => candidate.candidateId).join(","))
NODE
)"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-tp12-no-stop-lookback-ladder"
MANIFEST_PATH="$OUT_DIR/lookback_ladder_manifest.json"
SUMMARY_PATH="$OUT_DIR/lookback_ladder_summary.json"
CANDIDATE_JSONL="$OUT_DIR/lookback_candidates.jsonl"

if [[ -e "$OUT_DIR" ]]; then
  fatal "lookback ladder out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR/candidate_contracts"

candidate_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '_'
}

IFS=',' read -r -a candidate_ids_array <<< "$CANDIDATE_ID_LIST"
for candidate_id in "${candidate_ids_array[@]}"; do
  [[ -n "$candidate_id" ]] || continue
  slug="$(candidate_slug "$candidate_id")"
  candidate_contract_path="$OUT_DIR/candidate_contracts/${slug}.json"
  candidate_run_id="${RUN_ID}_${slug}"

  node tools/build_tp12_no_stop_lookback_ladder_candidate_contract.mjs \
    "--contract-path=${RESOLVED_CONTRACT_PATH}" \
    "--candidate-id=${candidate_id}" \
    "--out=${candidate_contract_path}" >/dev/null

  rolling_cmd=(
    bash
    tools/run_stepb_1d_tp12_no_stop_low_gap_top_rolling.sh
    "--contract-path=${candidate_contract_path}"
    "--run-id=${candidate_run_id}"
    "--window-group=${WINDOW_GROUP}"
  )
  if [[ -n "$WINDOW_IDS" ]]; then
    rolling_cmd+=("--window-ids=${WINDOW_IDS}")
  fi
  "${rolling_cmd[@]}"

  rolling_out_dir="$ROOT_DIR/artifacts/runs/${candidate_run_id}/step-perfect-prototype-1d-tp12-no-stop-rolling"
  rolling_summary_path="$rolling_out_dir/rolling_summary.json"
  rolling_report_path="$rolling_out_dir/rolling_report.md"
  entry_json="$(node --input-type=module - "$candidate_id" "$candidate_run_id" "$candidate_contract_path" "$rolling_summary_path" "$rolling_report_path" <<'NODE'
const [candidateId, candidateRunId, candidateContractPath, rollingSummaryPath, rollingReportPath] = process.argv.slice(2)
console.log(
  JSON.stringify({
    candidateId,
    candidateRunId,
    candidateContractPath,
    rollingSummaryPath,
    rollingReportPath,
  }),
)
NODE
)"
  printf '%s\n' "$entry_json" >> "$CANDIDATE_JSONL"
done

node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$CANDIDATE_GROUP" "$WINDOW_GROUP" "$RESOLVED_CONTRACT_PATH" "$CANDIDATE_JSONL" "$CANDIDATE_ID_LIST" "$WINDOW_IDS" <<'NODE'
import fs from "node:fs/promises"

import { writeJson } from "./src/lib/io.mjs"

const [manifestPath, runId, candidateGroup, windowGroup, contractPath, candidatesJsonlPath, requestedCandidateIdsRaw, requestedWindowIdsRaw] =
  process.argv.slice(2)
const lines = String(await fs.readFile(candidatesJsonlPath, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
const candidates = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(
      `Malformed lookback ladder candidate entry at ${candidatesJsonlPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
})
const requestedCandidateIds = String(requestedCandidateIdsRaw ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
const requestedWindowIds = String(requestedWindowIdsRaw ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
await writeJson(manifestPath, {
  kind: "tp12_no_stop_lookback_ladder_manifest_v1",
  generatedAt: new Date().toISOString(),
  runId,
  candidateGroup,
  windowGroup,
  contractPath,
  requestedCandidateIds,
  requestedWindowIds,
  candidates,
})
NODE

bash tools/run_tp12_no_stop_lookback_ladder_summary.sh \
  "--contract-path=${RESOLVED_CONTRACT_PATH}" \
  "--manifest-path=${MANIFEST_PATH}" \
  "--out=${SUMMARY_PATH}"

echo "[done] tp12 no-stop lookback ladder completed runId=${RUN_ID} summary=${SUMMARY_PATH}"
