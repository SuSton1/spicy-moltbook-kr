#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_scientific_comparison_report.sh --pipeline-summary-path=... --selection-manifest-path=... --out=..." >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_scientific_comparison_report.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
