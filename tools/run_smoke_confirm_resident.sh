#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/run_smoke_confirm_resident.sh --config=config/lab.config.server.lite.json --run-id=<RUN_ID> [--session-id=<SESSION_ID>] [--phase=both|smoke|confirm] [--smoke-runs=12] [--confirm-runs=36]
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec npm run lab:smoke-confirm -- "$@"
