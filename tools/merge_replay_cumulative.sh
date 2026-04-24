#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_HELPER="${SCRIPT_DIR}/merge_replay_cumulative.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required: ${NODE_HELPER}" >&2
  exit 1
fi

exec node "${NODE_HELPER}" "$@"
