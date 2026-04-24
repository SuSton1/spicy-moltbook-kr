#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_no_stop_lb5_live_like_oos_replay.sh --run-id=<run_id> [--contract-path=PATH]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_no_stop_lb5_live_like_oos_replay.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
