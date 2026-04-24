#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_stepb_tp12_no_gap_addon_rolling.sh --run-id=<id> --candidate-id=<id> [extra args...]" >&2
  exit 1
fi

bash "$ROOT_DIR/tools/run_server_command.sh" bash tools/run_stepb_tp12_no_gap_addon_rolling.sh "$@"
