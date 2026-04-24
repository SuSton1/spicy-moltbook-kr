#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_SCOPE_EXPANSION_CONTRACT_PATH="meta/tp12_no_stop_scope_expansion_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_stepb_tp12_no_stop_scope_expansion.sh --run-id=<run_id> --scope-id=<LOW_GAP_TOP|LOW|MID|TOP> [--contract-path=PATH] [--window-group=screen|final|all] [--window-ids=w1,w2] [--candle-path=PATH] [--max-rules=N]
Server-only helper that builds one lb5-fixed scope-expansion rolling contract and runs the matching rolling experiment.
EOF
}

CONTRACT_PATH="$DEFAULT_SCOPE_EXPANSION_CONTRACT_PATH"
RUN_ID=""
SCOPE_ID=""
WINDOW_GROUP="screen"
WINDOW_IDS=""
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
    --scope-id=*)
      SCOPE_ID="${1#*=}"
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
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

scope_slug="$(
  node --input-type=module - "$SCOPE_ID" <<'NODE'
import { buildTp12NoStopScopeExpansionScopeSlug } from "./src/lib/tp12_no_stop_scope_expansion_contract.mjs"
const [scopeId] = process.argv.slice(2)
console.log(buildTp12NoStopScopeExpansionScopeSlug(scopeId))
NODE
)"

DERIVED_CONTRACT_DIR="$ROOT_DIR/artifacts/tp12_no_stop_scope_expansion/candidate_contracts"
DERIVED_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}_${scope_slug}.json"

if [[ -e "$DERIVED_CONTRACT_PATH" ]]; then
  fatal "scope expansion candidate contract already exists: $DERIVED_CONTRACT_PATH"
fi
mkdir -p "$DERIVED_CONTRACT_DIR"

node tools/build_tp12_no_stop_scope_expansion_candidate_contract.mjs \
  "--contract-path=${CONTRACT_PATH}" \
  "--scope-id=${SCOPE_ID}" \
  "--out=${DERIVED_CONTRACT_PATH}" >/dev/null

rolling_args=(
  "--contract-path=${DERIVED_CONTRACT_PATH}"
  "--run-id=${RUN_ID}"
  "--window-group=${WINDOW_GROUP}"
  "--candle-path=${CANDLE_PATH}"
)
if [[ -n "$WINDOW_IDS" ]]; then
  rolling_args+=("--window-ids=${WINDOW_IDS}")
fi
if [[ -n "$MAX_RULES" ]]; then
  rolling_args+=("--max-rules=${MAX_RULES}")
fi

bash tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh "${rolling_args[@]}"

echo "[done] tp12 no-stop scope expansion completed scopeId=${SCOPE_ID} runId=${RUN_ID} contract=${DERIVED_CONTRACT_PATH}"
