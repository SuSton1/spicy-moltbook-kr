#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if [[ $# -lt 2 ]]; then
  echo "usage: bash tools/server_run_public_kr_historical_pipeline.sh --from=YYYY-MM-DD --to=YYYY-MM-DD [args...]" >&2
  exit 1
fi

cmd=(bash tools/run_public_kr_historical_pipeline.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
