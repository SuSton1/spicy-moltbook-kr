#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="${STOCKDESK_SERVER_HOST:-spicy-moltbook}"
SERVER_REPO_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"

usage() {
  cat <<'EOF'
Usage: tools/run_server_command.sh [--skip-sync] <command...>
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

if [[ $skip_sync -eq 0 ]]; then
  "$ROOT_DIR/scripts/sync_to_server.sh" "$ROOT_DIR/" "${SERVER_HOST}:${SERVER_REPO_ROOT}/"
fi

printf -v remote_cmd '%q ' "$@"
ssh -o BatchMode=yes "$SERVER_HOST" "cd $(printf '%q' "$SERVER_REPO_ROOT") && ${remote_cmd}"
