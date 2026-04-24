#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/technique_episode_substrate_contract.json"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

RUN_ID=""
ROWS_PATH=""
CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
DEFAULT_SCOPE_ID=""
DEFAULT_LOOKBACK_CANDIDATE_ID=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --rows-path=*) ROWS_PATH="${1#*=}"; shift ;;
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --default-scope-id=*) DEFAULT_SCOPE_ID="${1#*=}"; shift ;;
    --default-lookback-candidate-id=*) DEFAULT_LOOKBACK_CANDIDATE_ID="${1#*=}"; shift ;;
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
[[ -n "$ROWS_PATH" ]] || fatal "--rows-path is required"
[[ -f "$ROWS_PATH" ]] || fatal "rows path missing: $ROWS_PATH"
[[ -f "$CONTRACT_PATH" ]] || fatal "contract path missing: $CONTRACT_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-episode-substrate"
[[ ! -e "$OUT_DIR" ]] || fatal "episode-substrate out dir already exists: $OUT_DIR"
mkdir -p "$OUT_DIR"

EPISODES_PATH="$OUT_DIR/episode_windows.jsonl"
EPISODE_SUMMARY_PATH="$OUT_DIR/episode_window_summary.json"
PATTERNS_PATH="$OUT_DIR/verified_patterns.jsonl"
SUMMARY_PATH="$OUT_DIR/episode_substrate_summary.json"

WINDOW_ARGS=(
  "--rows-path=$ROWS_PATH"
  "--out=$EPISODES_PATH"
  "--summary-out=$EPISODE_SUMMARY_PATH"
  "--contract-path=$CONTRACT_PATH"
)
if [[ -n "$DEFAULT_SCOPE_ID" ]]; then
  WINDOW_ARGS+=("--default-scope-id=$DEFAULT_SCOPE_ID")
fi
if [[ -n "$DEFAULT_LOOKBACK_CANDIDATE_ID" ]]; then
  WINDOW_ARGS+=("--default-lookback-candidate-id=$DEFAULT_LOOKBACK_CANDIDATE_ID")
fi

node tools/build_technique_episode_windows.mjs "${WINDOW_ARGS[@]}"

node tools/build_technique_episode_substrate_report.mjs   "--episodes-path=$EPISODES_PATH"   "--out=$PATTERNS_PATH"   "--summary-out=$SUMMARY_PATH"   "--contract-path=$CONTRACT_PATH"

echo "[done] technique episode substrate discovery completed runId=${RUN_ID} summary=${SUMMARY_PATH}"
