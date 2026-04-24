#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if [[ $# -lt 2 ]]; then
  echo "usage: bash tools/server_run_tp12_intraday_feature_dataset.sh --manifest-path=... --out=... [args...]" >&2
  exit 1
fi

cmd=(bash tools/run_tp12_intraday_feature_dataset.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
