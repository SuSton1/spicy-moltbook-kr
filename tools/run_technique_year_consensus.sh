#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/technique_grammar_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF2'
Usage: bash tools/run_technique_year_consensus.sh --run-id=<run_id> --template-screen-summary-path=PATH [--contract-path=PATH] [--template-ids=id1,id2]
Server-only helper that extracts rule-level year-consensus artifacts from a completed technique template screen summary.
EOF2
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
TEMPLATE_SCREEN_SUMMARY_PATH=""
RUN_ID=""
TEMPLATE_IDS=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --template-screen-summary-path=*) TEMPLATE_SCREEN_SUMMARY_PATH="${1#*=}"; shift ;;
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --template-ids=*) TEMPLATE_IDS="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
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
[[ -n "$TEMPLATE_SCREEN_SUMMARY_PATH" ]] || fatal "--template-screen-summary-path is required"
[[ -f "$CONTRACT_PATH" ]] || fatal "contract path missing: $CONTRACT_PATH"
[[ -f "$TEMPLATE_SCREEN_SUMMARY_PATH" ]] || fatal "template screen summary path missing: $TEMPLATE_SCREEN_SUMMARY_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-year-consensus"
if [[ -e "$OUT_DIR" ]]; then
  fatal "technique year-consensus out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR"

args=(
  "--contract-path=${CONTRACT_PATH}"
  "--template-screen-summary-path=${TEMPLATE_SCREEN_SUMMARY_PATH}"
  "--out-dir=${OUT_DIR}"
)
if [[ -n "$TEMPLATE_IDS" ]]; then
  args+=("--template-ids=${TEMPLATE_IDS}")
fi

node tools/build_technique_year_consensus_summary.mjs "${args[@]}"

echo "[done] technique year-consensus completed runId=${RUN_ID} outDir=${OUT_DIR}"
