#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_control.sh --manifest-path=... --feature-pack-path=... --out=... [--contract-path=meta/tp12_side_daily_research_contract.json args...]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_control.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
