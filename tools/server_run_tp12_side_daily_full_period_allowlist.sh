#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_full_period_allowlist.sh --run-dir=PATH [args...]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_full_period_allowlist.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
