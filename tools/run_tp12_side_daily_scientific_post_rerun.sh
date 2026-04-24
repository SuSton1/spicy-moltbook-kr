#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

contract_path="meta/tp12_side_daily_research_contract.json"
downstream_run_dir=""
train_run_dir=""
oos_run_dir=""
feature_pack_path=""
run_id=""
out_root=""
allowed_lanes=""
gate_id="d0_close"
variant_selection_map=""
variant_selection_summary_map=""
selection_manifest_out=""
comparison_report_out=""
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) contract_path="${1#*=}" ; shift ;;
    --downstream-run-dir=*) downstream_run_dir="${1#*=}" ; shift ;;
    --train-run-dir=*) train_run_dir="${1#*=}" ; shift ;;
    --oos-run-dir=*) oos_run_dir="${1#*=}" ; shift ;;
    --feature-pack-path=*) feature_pack_path="${1#*=}" ; shift ;;
    --run-id=*) run_id="${1#*=}" ; shift ;;
    --out-root=*) out_root="${1#*=}" ; shift ;;
    --allowed-lanes=*) allowed_lanes="${1#*=}" ; shift ;;
    --gate-id=*) gate_id="${1#*=}" ; shift ;;
    --variant-selection-map=*) variant_selection_map="${1#*=}" ; shift ;;
    --variant-selection-summary-map=*) variant_selection_summary_map="${1#*=}" ; shift ;;
    --selection-manifest-out=*) selection_manifest_out="${1#*=}" ; shift ;;
    --comparison-report-out=*) comparison_report_out="${1#*=}" ; shift ;;
    --skip-verify) skip_verify=1 ; shift ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${downstream_run_dir}" || -z "${train_run_dir}" || -z "${oos_run_dir}" || -z "${feature_pack_path}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_scientific_post_rerun.sh --downstream-run-dir=PATH --train-run-dir=PATH --oos-run-dir=PATH --feature-pack-path=PATH [--contract-path=meta/tp12_side_daily_research_contract.json --run-id=ID --out-root=PATH --allowed-lanes=csv --gate-id=d0_close --variant-selection-map='variant=path;variant2=path' --variant-selection-summary-map='variant=path;variant2=path' --selection-manifest-out=PATH --comparison-report-out=PATH]" >&2
  exit 1
fi

if [[ -n "${variant_selection_summary_map}" && -z "${variant_selection_map}" ]]; then
  echo "variant-selection-summary-map requires variant-selection-map" >&2
  exit 1
fi
if [[ -n "${selection_manifest_out}" && -z "${variant_selection_map}" ]]; then
  echo "selection-manifest-out requires variant-selection-map" >&2
  exit 1
fi
if [[ -n "${comparison_report_out}" && -z "${variant_selection_map}" ]]; then
  echo "comparison-report-out requires variant-selection-map" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="tp12_side_daily_scientific_post_rerun_$(date +%Y%m%d_%H%M%S)"
fi
if [[ -z "${out_root}" ]]; then
  out_root="artifacts/tp12_side_daily/scientific_control/run=${run_id}"
fi

pipeline_cmd=(
  bash tools/run_tp12_side_daily_scientific_control_pipeline.sh
  "--contract-path=${contract_path}"
  "--downstream-run-dir=${downstream_run_dir}"
  "--train-run-dir=${train_run_dir}"
  "--oos-run-dir=${oos_run_dir}"
  "--feature-pack-path=${feature_pack_path}"
  "--run-id=${run_id}"
  "--out-root=${out_root}"
  "--gate-id=${gate_id}"
  --skip-verify
)
if [[ -n "${allowed_lanes}" ]]; then
  pipeline_cmd+=("--allowed-lanes=${allowed_lanes}")
fi

"${pipeline_cmd[@]}"

pipeline_summary_path="${out_root}/pipeline_summary.json"

if [[ -n "${variant_selection_map}" ]]; then
  if [[ -z "${selection_manifest_out}" ]]; then
    selection_manifest_out="${out_root}/selection_manifest.json"
  fi
  selection_cmd=(
    bash tools/run_tp12_side_daily_scientific_selection_manifest.sh
    "--pipeline-summary-path=${pipeline_summary_path}"
    "--variant-selection-map=${variant_selection_map}"
    "--out=${selection_manifest_out}"
    --skip-verify
  )
  if [[ -n "${variant_selection_summary_map}" ]]; then
    selection_cmd+=("--variant-selection-summary-map=${variant_selection_summary_map}")
  fi
  "${selection_cmd[@]}"

  if [[ -z "${comparison_report_out}" ]]; then
    comparison_report_out="${out_root}/scientific_comparison_report.json"
  fi
  bash tools/run_tp12_side_daily_scientific_comparison_report.sh \
    "--pipeline-summary-path=${pipeline_summary_path}" \
    "--selection-manifest-path=${selection_manifest_out}" \
    "--out=${comparison_report_out}" \
    --skip-verify
fi

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_scientific_post_rerun run_id=${run_id} pipeline_summary=${pipeline_summary_path}"
