#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_kiwoom_tp12_pipeline.sh --feature-pack-path=... [--manifest-path=... | --run-dir=... | --events-path=... --summary-path=...] [--allowlist-path=...]" >&2
  exit 1
fi

cmd=(bash tools/run_kiwoom_tp12_pipeline.sh "$@")
bash tools/run_server_command.sh "${cmd[@]}"
