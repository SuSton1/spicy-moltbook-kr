#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_technique_cluster_template_rolling.sh --run-id=<run_id> --plan-path=PATH [--contract-path=PATH --template-ids=... --max-templates=N --window-group=screen|all --max-rules=N]" >&2
  exit 1
fi

cmd=(bash tools/run_technique_cluster_template_rolling.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
