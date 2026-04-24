#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_year2x8_bank_discovery_research_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"
DEFAULT_MAX_RULES="300000"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_year2x8_topcell_final_confirm.sh --run-id=<run_id> --scope-id=<scope> --candidate-id=<candidate> [--contract-path=PATH] [--candle-path=PATH] [--max-rules=N]
Server-only helper that reruns one year2x8 top cell in final-confirm mode (20M full-train / untouched OOS) and writes a compact final summary.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
RUN_ID=""
SCOPE_ID=""
CANDIDATE_ID=""
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES="$DEFAULT_MAX_RULES"

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
    --scope-id=*)
      SCOPE_ID="${1#*=}"
      shift
      ;;
    --candidate-id=*)
      CANDIDATE_ID="${1#*=}"
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
[[ -n "$SCOPE_ID" ]] || fatal "--scope-id is required"
[[ -n "$CANDIDATE_ID" ]] || fatal "--candidate-id is required"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"
[[ "$MAX_RULES" =~ ^[0-9]+$ && "$MAX_RULES" -ge 1 ]] || fatal "--max-rules must be a positive integer"

DERIVED_CONTRACT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/candidate_contracts"
DERIVED_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}_final_contract.json"
OUT_SUMMARY_PATH="$ROOT_DIR/artifacts/runs/$RUN_ID/final_confirm_summary.json"
ROLLING_SUMMARY_PATH="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_summary.json"

mkdir -p "$DERIVED_CONTRACT_DIR"
[[ ! -e "$DERIVED_CONTRACT_PATH" ]] || fatal "derived contract already exists: $DERIVED_CONTRACT_PATH"

node tools/build_tp12_year2x8_bank_discovery_candidate_contract.mjs \
  "--contract-path=${CONTRACT_PATH}" \
  "--scope-id=${SCOPE_ID}" \
  "--candidate-id=${CANDIDATE_ID}" \
  "--out=${DERIVED_CONTRACT_PATH}" >/dev/null

bash tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh \
  "--contract-path=${DERIVED_CONTRACT_PATH}" \
  "--run-id=${RUN_ID}" \
  "--window-group=final" \
  "--candle-path=${CANDLE_PATH}" \
  "--max-rules=${MAX_RULES}"

[[ -f "$ROLLING_SUMMARY_PATH" ]] || fatal "missing rolling summary: $ROLLING_SUMMARY_PATH"

node tools/build_tp12_year2x8_final_confirm_summary.mjs \
  "--contract-path=${CONTRACT_PATH}" \
  "--rolling-summary-path=${ROLLING_SUMMARY_PATH}" \
  "--scope-id=${SCOPE_ID}" \
  "--candidate-id=${CANDIDATE_ID}" \
  "--run-id=${RUN_ID}" \
  "--out=${OUT_SUMMARY_PATH}" \
  "--candle-path=${CANDLE_PATH}" >/dev/null

echo "[done] tp12 year2x8 top-cell final confirm completed runId=${RUN_ID} scopeId=${SCOPE_ID} candidateId=${CANDIDATE_ID} summary=${OUT_SUMMARY_PATH}"
