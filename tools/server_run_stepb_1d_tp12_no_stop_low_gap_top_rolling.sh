#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_stepb_1d_tp12_no_stop_low_gap_top_rolling.sh --run-id=<run_id> [--contract-path=PATH --window-group=screen|final|all --max-rules=N]" >&2
  exit 1
fi

cmd=(bash tools/run_stepb_1d_tp12_no_stop_low_gap_top_rolling.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
