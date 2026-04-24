#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec "$ROOT_DIR/tools/run_server_command.sh" "bash" "tools/server_run_stepb_plus_lite_widened_recent_matrix.sh" "$@"
