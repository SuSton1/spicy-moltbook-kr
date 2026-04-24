#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_scientific_control_pipeline.sh --downstream-run-dir=... --train-run-dir=... --oos-run-dir=... --feature-pack-path=... [args...]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_scientific_control_pipeline.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
