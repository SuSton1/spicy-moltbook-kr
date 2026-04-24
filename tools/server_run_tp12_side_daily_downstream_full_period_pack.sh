#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_downstream_full_period_pack.sh [args...]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_downstream_full_period_pack.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
