#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash tools/run_server_command.sh bash tools/run_stepb_1d_tp12_no_stop_scope_fixed_trainfirst.sh "$@"
