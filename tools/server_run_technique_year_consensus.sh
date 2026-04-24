#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_technique_year_consensus.sh --run-id=<run_id> --template-screen-summary-path=PATH [--contract-path=PATH --template-ids=...]" >&2
  exit 1
fi

cmd=(bash tools/run_technique_year_consensus.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
