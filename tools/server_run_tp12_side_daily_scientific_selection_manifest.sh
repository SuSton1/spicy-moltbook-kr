#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "usage: bash tools/server_run_tp12_side_daily_scientific_selection_manifest.sh --pipeline-summary-path=... --variant-selection-map='variant=path;variant2=path' --out=..." >&2
  echo "  path may be an exact selected-row .jsonl, open_eval_manifest.json, step-perfect-prototype-open-eval-report dir, or a run dir." >&2
  exit 1
fi

cmd=(bash tools/run_tp12_side_daily_scientific_selection_manifest.sh "$@")
bash "${ROOT_DIR}/tools/run_server_command.sh" "${cmd[@]}"
