#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT_DIR/tools/run_server_command.sh" bash -lc "cd /home/moltook/apps/stockdesk-lab-lite && bash tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_support_atlas.sh $*"
