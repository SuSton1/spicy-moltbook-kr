#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"

usage() {
  cat <<EOF
Usage: bash tools/run_daily_ops_once.sh
Runs the canonical daily ops flow: public fill -> live priority stack.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  echo "[fatal] run_daily_ops_once.sh must run from $EXPECTED_REAL, got $ROOT_REAL" >&2
  exit 4
fi

cd "$ROOT_DIR"
exec node tools/server_run_daily_ops_stack.mjs "$@"
