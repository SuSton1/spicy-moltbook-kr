#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

pipeline_summary_path=""
selection_manifest_path=""
out_path=""
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --pipeline-summary-path=*)
      pipeline_summary_path="${1#*=}"
      shift
      ;;
    --selection-manifest-path=*)
      selection_manifest_path="${1#*=}"
      shift
      ;;
    --out=*)
      out_path="${1#*=}"
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

if [[ -z "${pipeline_summary_path}" || -z "${selection_manifest_path}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_scientific_comparison_report.sh --pipeline-summary-path=PATH --selection-manifest-path=PATH --out=PATH" >&2
  exit 1
fi

node tools/build_tp12_side_daily_scientific_comparison_report.mjs \
  "--pipeline-summary-path=${pipeline_summary_path}" \
  "--selection-manifest-path=${selection_manifest_path}" \
  "--out=${out_path}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_scientific_comparison_report out=${out_path}"
