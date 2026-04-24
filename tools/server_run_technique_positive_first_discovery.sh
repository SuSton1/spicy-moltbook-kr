#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_technique_positive_first_discovery.sh [--detach] [--skip-sync] --run-id=<run_id> --rows-path=PATH [--contract-path=PATH --label-id=LABEL --default-scope-id=SCOPE --default-lookback-candidate-id=ID --max-patterns=N]" >&2
  exit 1
fi

detach=0
skip_sync=0
forwarded=()
while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --detach) detach=1; shift ;;
    --skip-sync) skip_sync=1; shift ;;
    *) forwarded+=("$1"); shift ;;
  esac
done

if [[ ${#forwarded[@]} -lt 1 ]]; then
  echo "usage: bash tools/server_run_technique_positive_first_discovery.sh [--detach] [--skip-sync] --run-id=<run_id> --rows-path=PATH [--contract-path=PATH --label-id=LABEL --default-scope-id=SCOPE --default-lookback-candidate-id=ID --max-patterns=N]" >&2
  exit 1
fi

if [[ $detach -eq 1 ]]; then
  cmd=(bash tools/launch_technique_positive_first_discovery_detached.sh "${forwarded[@]}")
else
  cmd=(bash tools/run_technique_positive_first_discovery.sh "${forwarded[@]}")
fi

if [[ $skip_sync -eq 1 ]]; then
  bash "${ROOT_DIR}/tools/run_server_command.sh" --skip-sync "${cmd[@]}"
else
  bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
fi
