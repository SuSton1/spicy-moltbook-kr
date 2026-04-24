#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_technique_episode_substrate_discovery.sh --run-id=<run_id> --rows-path=PATH [--contract-path=PATH --default-scope-id=SCOPE --default-lookback-candidate-id=ID]" >&2
  exit 1
fi

bash "$ROOT_DIR/tools/run_server_command.sh" bash tools/run_technique_episode_substrate_discovery.sh "$@"
