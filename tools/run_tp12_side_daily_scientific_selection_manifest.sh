#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

pipeline_summary_path=""
out_path=""
variant_selection_map=""
variant_selection_summary_map=""
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --pipeline-summary-path=*)
      pipeline_summary_path="${1#*=}"
      shift
      ;;
    --out=*)
      out_path="${1#*=}"
      shift
      ;;
    --variant-selection-map=*)
      variant_selection_map="${1#*=}"
      shift
      ;;
    --variant-selection-summary-map=*)
      variant_selection_summary_map="${1#*=}"
      shift
      ;;
    --skip-verify)
      skip_verify=1
      shift
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${pipeline_summary_path}" || -z "${out_path}" || -z "${variant_selection_map}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_scientific_selection_manifest.sh --pipeline-summary-path=PATH --variant-selection-map='variant=PATH;variant2=PATH' --out=PATH [--variant-selection-summary-map='variant=PATH;variant2=PATH']" >&2
  echo "  PATH may be an exact selected-row .jsonl, open_eval_manifest.json, step-perfect-prototype-open-eval-report dir, or a run dir containing that report." >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_side_daily_scientific_selection_manifest.mjs
  "--pipeline-summary-path=${pipeline_summary_path}"
  "--variant-selection-map=${variant_selection_map}"
  "--out=${out_path}"
)
if [[ -n "${variant_selection_summary_map}" ]]; then
  cmd+=("--variant-selection-summary-map=${variant_selection_summary_map}")
fi

"${cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_scientific_selection_manifest out=${out_path}"
