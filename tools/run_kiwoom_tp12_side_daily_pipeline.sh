#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

manifest_path=""
feature_pack_path=""
run_id=""
out_root=""
feature_out=""
feature_summary_out=""
bridge_out_dir=""
pipeline_summary_out=""
candle_path="data/candle_daily.jsonl"
investor_daily_path="data/intraday_side/investor_daily.jsonl"
program_daily_path="data/intraday_side/program_daily.jsonl"
trade_strength_daily_path="data/intraday_side/trade_strength_daily.jsonl"
dataset_ids="investor_daily,program_daily"
gate_ids="d0_close"
decision_from=""
decision_to=""

for arg in "$@"; do
  case "$arg" in
    --manifest-path=*)
      manifest_path="${arg#*=}"
      ;;
    --feature-pack-path=*)
      feature_pack_path="${arg#*=}"
      ;;
    --run-id=*)
      run_id="${arg#*=}"
      ;;
    --out-root=*)
      out_root="${arg#*=}"
      ;;
    --feature-out=*)
      feature_out="${arg#*=}"
      ;;
    --feature-summary-out=*)
      feature_summary_out="${arg#*=}"
      ;;
    --bridge-out-dir=*)
      bridge_out_dir="${arg#*=}"
      ;;
    --summary-out=*)
      pipeline_summary_out="${arg#*=}"
      ;;
    --candle-path=*)
      candle_path="${arg#*=}"
      ;;
    --investor-daily-path=*)
      investor_daily_path="${arg#*=}"
      ;;
    --program-daily-path=*)
      program_daily_path="${arg#*=}"
      ;;
    --trade-strength-daily-path=*)
      trade_strength_daily_path="${arg#*=}"
      ;;
    --dataset-ids=*)
      dataset_ids="${arg#*=}"
      ;;
    --gate-ids=*)
      gate_ids="${arg#*=}"
      ;;
    --decision-from=*)
      decision_from="${arg#*=}"
      ;;
    --decision-to=*)
      decision_to="${arg#*=}"
      ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${manifest_path}" || -z "${feature_pack_path}" ]]; then
  echo "usage: bash tools/run_kiwoom_tp12_side_daily_pipeline.sh --manifest-path=PATH --feature-pack-path=PATH [args...]" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="tp12_side_daily_$(date +%Y%m%d_%H%M%S)"
fi
if [[ -z "${out_root}" ]]; then
  out_root="artifacts/tp12_side_daily/pipeline/run=${run_id}"
fi
if [[ -z "${feature_out}" ]]; then
  feature_out="${out_root}/features/feature_rows.jsonl"
fi
if [[ -z "${feature_summary_out}" ]]; then
  feature_summary_out="${out_root}/features/feature_summary.json"
fi
if [[ -z "${bridge_out_dir}" ]]; then
  bridge_out_dir="${out_root}/bridged_feature_pack"
fi
if [[ -z "${pipeline_summary_out}" ]]; then
  pipeline_summary_out="${out_root}/pipeline_summary.json"
fi

bash tools/run_tp12_side_daily_feature_dataset.sh \
  "--manifest-path=${manifest_path}" \
  "--out=${feature_out}" \
  "--summary-out=${feature_summary_out}" \
  "--candle-path=${candle_path}" \
  "--investor-daily-path=${investor_daily_path}" \
  "--program-daily-path=${program_daily_path}" \
  "--trade-strength-daily-path=${trade_strength_daily_path}" \
  "--dataset-ids=${dataset_ids}" \
  ${decision_from:+--decision-from="${decision_from}"} \
  ${decision_to:+--decision-to="${decision_to}"} \
  "--skip-verify"

IFS=',' read -r -a gate_id_array <<< "${gate_ids}"
bridged_outputs=()
for raw_gate_id in "${gate_id_array[@]}"; do
  gate_id="$(echo "${raw_gate_id}" | xargs)"
  if [[ -z "${gate_id}" ]]; then
    continue
  fi
  out_path="${bridge_out_dir}/decision_candidates_feature_pack_side_${gate_id}.jsonl"
  meta_out="${out_path}.meta.json"
  bash tools/run_tp12_side_daily_feature_pack_bridge.sh \
    "--feature-pack-path=${feature_pack_path}" \
    "--side-feature-path=${feature_out}" \
    "--gate-id=${gate_id}" \
    "--out=${out_path}" \
    "--meta-out=${meta_out}" \
    ${decision_from:+--decision-from="${decision_from}"} \
    ${decision_to:+--decision-to="${decision_to}"} \
    "--skip-verify"
  bridged_outputs+=("${gate_id}:${out_path}")
done

node --input-type=module - "${pipeline_summary_out}" "${run_id}" "${manifest_path}" "${feature_pack_path}" "${feature_out}" "${feature_summary_out}" "${bridge_out_dir}" "${candle_path}" "${dataset_ids}" "${gate_ids}" "${decision_from}" "${decision_to}" "${bridged_outputs[@]}" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"

const [
  summaryOut,
  runId,
  manifestPath,
  featurePackPath,
  sideFeaturePath,
  sideFeatureSummaryPath,
  bridgeOutDir,
  candlePath,
  datasetIds,
  gateIds,
  decisionFrom,
  decisionTo,
  ...bridgedOutputsRaw
] = process.argv.slice(2)

const bridgedOutputs = bridgedOutputsRaw.map((entry) => {
  const splitIndex = String(entry).indexOf(":")
  return {
    gateId: splitIndex >= 0 ? entry.slice(0, splitIndex) : entry,
    outPath: splitIndex >= 0 ? entry.slice(splitIndex + 1) : "",
  }
})

const summary = {
  kind: "tp12_side_daily_pipeline_v1",
  runId,
  manifestPath,
  featurePackPath,
  sideFeaturePath,
  sideFeatureSummaryPath,
  bridgeOutDir,
  candlePath,
  datasetIds: String(datasetIds).split(",").map((value) => value.trim()).filter(Boolean),
  gateIds: String(gateIds).split(",").map((value) => value.trim()).filter(Boolean),
  decisionFrom: String(decisionFrom || "").trim() || null,
  decisionTo: String(decisionTo || "").trim() || null,
  bridgedOutputs,
}
await fs.mkdir(path.dirname(summaryOut), { recursive: true })
await fs.writeFile(summaryOut, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
NODE

npm run verify

echo "DONE run_kiwoom_tp12_side_daily_pipeline run_id=${run_id} summary=${pipeline_summary_out}"
