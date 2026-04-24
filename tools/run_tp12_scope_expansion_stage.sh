#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_scope_expansion_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_scope_expansion_stage.sh --run-id=<run_id> [--contract-path=PATH] [--scope-id=LOW] [--window-group=screen|final|all] [--window-ids=w1,w2] [--candle-path=PATH] [--max-rules=N]
Fail-fast wrapper for the explicit LOW x lb5 scope-expansion stage. This wrapper intentionally allows only the first widened scope (`LOW`).
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
RUN_ID=""
SCOPE_ID="LOW"
WINDOW_GROUP="screen"
WINDOW_IDS=""
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --scope-id=*) SCOPE_ID="${1#*=}"; shift ;;
    --window-group=*) WINDOW_GROUP="${1#*=}"; shift ;;
    --window-ids=*) WINDOW_IDS="${1#*=}"; shift ;;
    --candle-path=*) CANDLE_PATH="${1#*=}"; shift ;;
    --max-rules=*) MAX_RULES="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
  esac
done

[[ -n "$RUN_ID" ]] || { echo "--run-id is required" >&2; exit 1; }
[[ "$SCOPE_ID" == "LOW" ]] || {
  echo "[fatal] run_tp12_scope_expansion_stage.sh only supports --scope-id=LOW. Use the legacy explicit wrappers for baseline or future widened scopes." >&2
  exit 4
}
[[ -f "$CONTRACT_PATH" ]] || { echo "[fatal] contract path missing: $CONTRACT_PATH" >&2; exit 4; }
[[ -f "$CANDLE_PATH" ]] || { echo "[fatal] candle path missing: $CANDLE_PATH" >&2; exit 4; }

args=(
  "--contract-path=${CONTRACT_PATH}"
  "--run-id=${RUN_ID}"
  "--scope-id=${SCOPE_ID}"
  "--window-group=${WINDOW_GROUP}"
  "--candle-path=${CANDLE_PATH}"
)
if [[ -n "$WINDOW_IDS" ]]; then
  args+=("--window-ids=${WINDOW_IDS}")
fi
if [[ -n "$MAX_RULES" ]]; then
  args+=("--max-rules=${MAX_RULES}")
fi

bash "${ROOT_DIR}/tools/run_stepb_tp12_no_stop_scope_expansion.sh" "${args[@]}"
