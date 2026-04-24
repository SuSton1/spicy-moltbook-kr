#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_intraday_allowlist_from_pack.sh --input=... --out=..." >&2
  exit 1
fi

cmd=(bash tools/run_tp12_intraday_allowlist_from_pack.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
