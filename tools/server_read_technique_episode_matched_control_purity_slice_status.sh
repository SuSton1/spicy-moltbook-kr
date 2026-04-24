#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_read_technique_episode_matched_control_purity_slice_status.sh --run-id=<run_id> [--tail-lines=N]" >&2
  exit 1
fi

bash "$ROOT_DIR/tools/run_server_command.sh" --skip-sync bash tools/read_technique_episode_matched_control_purity_slice_status.sh "$@"
