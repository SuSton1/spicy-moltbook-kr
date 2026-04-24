#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if [[ $# -lt 4 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_feature_pack_bridge.sh --feature-pack-path=... --side-feature-path=... --gate-id=... --out=... [args...]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_feature_pack_bridge.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
