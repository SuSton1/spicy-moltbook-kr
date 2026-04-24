#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "usage: bash tools/server_run_tp12_intraday_feature_pack_bridge.sh --feature-pack-path=... --intraday-feature-path=... --gate-id=... --out=..." >&2
  exit 1
fi

cmd=(bash tools/run_tp12_intraday_feature_pack_bridge.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
