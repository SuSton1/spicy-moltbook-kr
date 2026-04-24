#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

"$ROOT_DIR/tools/run_server_command.sh" bash tools/server_prejump_curated_perfect_prototypes_after_close.sh "$@"
