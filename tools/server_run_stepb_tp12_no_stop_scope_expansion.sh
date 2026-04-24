#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_stepb_tp12_no_stop_scope_expansion.sh --run-id=<run_id> --scope-id=<LOW_GAP_TOP|LOW|MID|TOP> [--contract-path=PATH --window-group=screen|final|all --window-ids=w1,w2 --max-rules=N]" >&2
  exit 1
fi

cmd=(bash tools/run_stepb_tp12_no_stop_scope_expansion.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
