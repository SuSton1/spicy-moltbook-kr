#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash tools/run_server_command.sh bash tools/run_tp12_year2hit_zero_fp_micro_split.sh "$@"
