#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_execution_learning_bundle.sh --pipeline-summary-path=... --selection-manifest-path=... --out-dir=..." >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_execution_learning_bundle.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
