#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_year2x8_bank_discovery_matrix.sh --run-id=<run_id> [--contract-path=PATH --scope-ids=... --candidate-ids=... --window-group=screen|all --max-rules=N]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_year2x8_bank_discovery_matrix.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
