#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_stepb_tp12_no_stop_lookback_ladder.sh --run-id=<run_id> [--contract-path=PATH --candidate-group=sparse|dense_fill|all --window-group=screen|final|all]" >&2
  exit 1
fi

cmd=(bash tools/run_stepb_tp12_no_stop_lookback_ladder.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
