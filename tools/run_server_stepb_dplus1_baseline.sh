#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: tools/run_server_stepb_dplus1_baseline.sh [--skip-sync] --split-policy=decision_date_only|strict_label_boundary [additional server_run_stepb_dplus1_baseline.sh args...]
EOF
}

skip_sync=0
if [[ "${1:-}" == "--skip-sync" ]]; then
  skip_sync=1
  shift
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

cmd=("$ROOT_DIR/tools/run_server_command.sh")
if [[ $skip_sync -eq 1 ]]; then
  cmd+=(--skip-sync)
fi
cmd+=(bash tools/server_run_stepb_dplus1_baseline.sh "$@")
"${cmd[@]}"
