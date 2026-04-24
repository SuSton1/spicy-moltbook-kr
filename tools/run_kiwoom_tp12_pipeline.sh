#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

manifest_path=""
run_dir=""
events_path=""
summary_path=""
allowlist_path=""
pipeline_run_id=""
feature_pack_path=""
out_root=""
manifest_out=""
manifest_summary_out=""
feature_out=""
feature_summary_out=""
bridge_out_dir=""
pipeline_summary_out=""
gate_ids="d0_close,d1_0905,d1_0915,d1_0930"
data_dir="data"
decision_from=""
decision_to=""
allowed_lanes=""
tail_policy="require_full_window"
symbol_shard_index=""
symbol_shard_count=""
side_max_workers=1
minute_max_workers=1
side_max_pages_per_symbol=4096
minute_max_pages_per_symbol=20000
base_url=""
retries=2
sleep_ms=400
min_interval_ms=1200
cooldown_429_ms=30000
trace_root=""
overwrite_stage=0
crawl_anchor_date=""
candle_path="data/candle_daily.jsonl"
minute_cache_date_limit=16

for arg in "$@"; do
  case "$arg" in
    --manifest-path=*)
      manifest_path="${arg#*=}"
      ;;
    --run-dir=*)
      run_dir="${arg#*=}"
      ;;
    --events-path=*)
      events_path="${arg#*=}"
      ;;
    --summary-path=*)
      summary_path="${arg#*=}"
      ;;
    --allowlist-path=*)
      allowlist_path="${arg#*=}"
      ;;
    --run-id=*|--pipeline-run-id=*)
      pipeline_run_id="${arg#*=}"
      ;;
    --feature-pack-path=*)
      feature_pack_path="${arg#*=}"
      ;;
    --out-root=*)
      out_root="${arg#*=}"
      ;;
    --manifest-out=*)
      manifest_out="${arg#*=}"
      ;;
    --manifest-summary-out=*)
      manifest_summary_out="${arg#*=}"
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
    --gate-ids=*)
      gate_ids="${arg#*=}"
      ;;
    --data-dir=*)
      data_dir="${arg#*=}"
      ;;
    --decision-from=*)
      decision_from="${arg#*=}"
      ;;
    --decision-to=*)
      decision_to="${arg#*=}"
      ;;
    --allowed-lanes=*)
      allowed_lanes="${arg#*=}"
      ;;
    --tail-policy=*)
      tail_policy="${arg#*=}"
      ;;
    --symbol-shard-index=*)
      symbol_shard_index="${arg#*=}"
      ;;
    --symbol-shard-count=*)
      symbol_shard_count="${arg#*=}"
      ;;
    --side-max-workers=*)
      side_max_workers="${arg#*=}"
      ;;
    --minute-max-workers=*)
      minute_max_workers="${arg#*=}"
      ;;
    --side-max-pages-per-symbol=*)
      side_max_pages_per_symbol="${arg#*=}"
      ;;
    --minute-max-pages-per-symbol=*)
      minute_max_pages_per_symbol="${arg#*=}"
      ;;
    --base-url=*)
      base_url="${arg#*=}"
      ;;
    --retries=*)
      retries="${arg#*=}"
      ;;
    --sleep-ms=*)
      sleep_ms="${arg#*=}"
      ;;
    --min-interval-ms=*)
      min_interval_ms="${arg#*=}"
      ;;
    --cooldown-429-ms=*)
      cooldown_429_ms="${arg#*=}"
      ;;
    --trace-root=*)
      trace_root="${arg#*=}"
      ;;
    --overwrite-stage)
      overwrite_stage=1
      ;;
    --crawl-anchor-date=*)
      crawl_anchor_date="${arg#*=}"
      ;;
    --candle-path=*)
      candle_path="${arg#*=}"
      ;;
    --minute-cache-date-limit=*)
      minute_cache_date_limit="${arg#*=}"
      ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${feature_pack_path}" ]]; then
  echo "run_kiwoom_tp12_pipeline.sh requires --feature-pack-path=PATH" >&2
  exit 1
fi

if [[ -n "${manifest_path}" && ( -n "${run_dir}" || -n "${events_path}" || -n "${summary_path}" ) ]]; then
  echo "run_kiwoom_tp12_pipeline.sh accepts either --manifest-path or Step-A source args, not both" >&2
  exit 1
fi
if [[ -n "${manifest_path}" && -n "${allowlist_path}" ]]; then
  echo "run_kiwoom_tp12_pipeline.sh does not accept --allowlist-path when --manifest-path is already provided" >&2
  exit 1
fi

if [[ -z "${manifest_path}" ]]; then
  if [[ -n "${run_dir}" ]]; then
    :
  elif [[ -n "${events_path}" && -n "${summary_path}" ]]; then
    :
  else
    echo "run_kiwoom_tp12_pipeline.sh requires --manifest-path or Step-A source args (--run-dir or --events-path with --summary-path)" >&2
    exit 1
  fi
fi

if [[ -z "${gate_ids//,/}" ]]; then
  echo "run_kiwoom_tp12_pipeline.sh requires at least one gate id" >&2
  exit 1
fi

if [[ -z "${pipeline_run_id}" ]]; then
  if [[ -n "${run_dir}" ]]; then
    pipeline_run_id="$(basename "${run_dir%/}")"
  elif [[ -n "${manifest_path}" ]]; then
    pipeline_run_id="$(basename "$(dirname "${manifest_path}")")"
  else
    pipeline_run_id="kiwoom_tp12_pipeline_$(date +%Y%m%d_%H%M%S)"
  fi
fi

if [[ -z "${out_root}" ]]; then
  out_root="artifacts/tp12_intraday/pipeline/run=${pipeline_run_id}"
fi
if [[ -z "${manifest_out}" ]]; then
  manifest_out="${out_root}/request_manifest/requests.jsonl"
fi
if [[ -z "${manifest_summary_out}" ]]; then
  manifest_summary_out="${out_root}/request_manifest/manifest_summary.json"
fi
if [[ -z "${feature_out}" ]]; then
  feature_out="${out_root}/features/feature_rows.jsonl"
fi
if [[ -z "${feature_summary_out}" ]]; then
  feature_summary_out="${out_root}/features/feature_rows_summary.json"
fi
if [[ -z "${bridge_out_dir}" ]]; then
  bridge_out_dir="${out_root}/bridged_feature_pack"
fi
if [[ -z "${pipeline_summary_out}" ]]; then
  pipeline_summary_out="${out_root}/pipeline_summary.json"
fi

if [[ -z "${manifest_path}" ]]; then
  inputs_cmd=(
    bash tools/run_kiwoom_tp12_inputs.sh
    "--out=${manifest_out}"
    "--summary-out=${manifest_summary_out}"
    "--candle-path=${candle_path}"
    "--tail-policy=${tail_policy}"
    "--skip-verify"
  )
  if [[ -n "${run_dir}" ]]; then
    inputs_cmd+=("--run-dir=${run_dir}")
  else
    inputs_cmd+=("--events-path=${events_path}" "--summary-path=${summary_path}")
  fi
  if [[ -n "${decision_from}" ]]; then
    inputs_cmd+=("--decision-from=${decision_from}")
  fi
  if [[ -n "${decision_to}" ]]; then
    inputs_cmd+=("--decision-to=${decision_to}")
  fi
  if [[ -n "${allowed_lanes}" ]]; then
    inputs_cmd+=("--allowed-lanes=${allowed_lanes}")
  fi
  if [[ -n "${allowlist_path}" ]]; then
    inputs_cmd+=("--allowlist-path=${allowlist_path}")
  fi
  "${inputs_cmd[@]}"
  manifest_path="${manifest_out}"
fi

backfill_cmd=(
  bash tools/run_kiwoom_tp12_backfill.sh
  "--manifest-path=${manifest_path}"
  "--run-id=${pipeline_run_id}"
  "--data-dir=${data_dir}"
  "--side-max-workers=${side_max_workers}"
  "--minute-max-workers=${minute_max_workers}"
  "--side-max-pages-per-symbol=${side_max_pages_per_symbol}"
  "--minute-max-pages-per-symbol=${minute_max_pages_per_symbol}"
  "--retries=${retries}"
  "--sleep-ms=${sleep_ms}"
  "--min-interval-ms=${min_interval_ms}"
  "--cooldown-429-ms=${cooldown_429_ms}"
  "--candle-path=${candle_path}"
  "--skip-verify"
)
if [[ -n "${decision_from}" ]]; then
  backfill_cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  backfill_cmd+=("--decision-to=${decision_to}")
fi
if [[ -n "${symbol_shard_index}" ]]; then
  backfill_cmd+=("--symbol-shard-index=${symbol_shard_index}")
fi
if [[ -n "${symbol_shard_count}" ]]; then
  backfill_cmd+=("--symbol-shard-count=${symbol_shard_count}")
fi
if [[ -n "${base_url}" ]]; then
  backfill_cmd+=("--base-url=${base_url}")
fi
if [[ -n "${trace_root}" ]]; then
  backfill_cmd+=("--trace-root=${trace_root}")
fi
if [[ -n "${crawl_anchor_date}" ]]; then
  backfill_cmd+=("--crawl-anchor-date=${crawl_anchor_date}")
fi
if (( overwrite_stage == 1 )); then
  backfill_cmd+=("--overwrite-stage")
fi
"${backfill_cmd[@]}"

minute_root="${data_dir%/}/intraday_1m"
minute_presence_path="${data_dir%/}/intraday_1m_presence_daily.jsonl"
investor_daily_path="${data_dir%/}/intraday_side/investor_daily.jsonl"
program_daily_path="${data_dir%/}/intraday_side/program_daily.jsonl"
trade_strength_daily_path="${data_dir%/}/intraday_side/trade_strength_daily.jsonl"

feature_cmd=(
  bash tools/run_tp12_intraday_feature_dataset.sh
  "--manifest-path=${manifest_path}"
  "--out=${feature_out}"
  "--summary-out=${feature_summary_out}"
  "--minute-root=${minute_root}"
  "--minute-presence-path=${minute_presence_path}"
  "--investor-daily-path=${investor_daily_path}"
  "--program-daily-path=${program_daily_path}"
  "--trade-strength-daily-path=${trade_strength_daily_path}"
  "--gate-ids=${gate_ids}"
  "--minute-cache-date-limit=${minute_cache_date_limit}"
  "--skip-verify"
)
if [[ -n "${decision_from}" ]]; then
  feature_cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  feature_cmd+=("--decision-to=${decision_to}")
fi
"${feature_cmd[@]}"

IFS=',' read -r -a gate_id_array <<< "${gate_ids}"
normalized_gate_ids=()
for gate_id in "${gate_id_array[@]}"; do
  gate_id="${gate_id//[[:space:]]/}"
  if [[ -z "${gate_id}" ]]; then
    continue
  fi
  normalized_gate_ids+=("${gate_id}")
  bridge_cmd=(
    bash tools/run_tp12_intraday_feature_pack_bridge.sh
    "--feature-pack-path=${feature_pack_path}"
    "--intraday-feature-path=${feature_out}"
    "--gate-id=${gate_id}"
    "--out=${bridge_out_dir}/decision_candidates_feature_pack_intraday_${gate_id}.jsonl"
    "--meta-out=${bridge_out_dir}/decision_candidates_feature_pack_intraday_${gate_id}_meta.json"
    "--skip-verify"
  )
  if [[ -n "${decision_from}" ]]; then
    bridge_cmd+=("--decision-from=${decision_from}")
  fi
  if [[ -n "${decision_to}" ]]; then
    bridge_cmd+=("--decision-to=${decision_to}")
  fi
  "${bridge_cmd[@]}"
done

if [[ ${#normalized_gate_ids[@]} -eq 0 ]]; then
  echo "run_kiwoom_tp12_pipeline.sh produced an empty gate list after normalization" >&2
  exit 1
fi

gate_ids_csv=""
for gate_id in "${normalized_gate_ids[@]}"; do
  if [[ -n "${gate_ids_csv}" ]]; then
    gate_ids_csv+=","
  fi
  gate_ids_csv+="${gate_id}"
done

node --input-type=module - "${pipeline_summary_out}" "${pipeline_run_id}" "${manifest_path}" "${feature_pack_path}" "${feature_out}" "${gate_ids_csv}" "${bridge_out_dir}" "${data_dir}" "${decision_from}" "${decision_to}" "${allowlist_path}" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"

const [
  summaryOut,
  runId,
  manifestPath,
  featurePackPath,
  intradayFeaturePath,
  gateIdsCsv,
  bridgeOutDir,
  dataDir,
  decisionFrom,
  decisionTo,
  allowlistPath,
] = process.argv.slice(2)

const gateIds = String(gateIdsCsv ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const bridgedOutputs = Object.fromEntries(
  gateIds.map((gateId) => [
    gateId,
    {
      featurePackPath: path.join(bridgeOutDir, `decision_candidates_feature_pack_intraday_${gateId}.jsonl`),
      metaPath: path.join(bridgeOutDir, `decision_candidates_feature_pack_intraday_${gateId}_meta.json`),
    },
  ]),
)

const payload = {
  kind: "kiwoom_tp12_intraday_pipeline_v1",
  runId,
  manifestPath,
  featurePackPath,
  intradayFeaturePath,
  bridgeOutDir,
  dataDir,
  decisionFrom: decisionFrom || null,
  decisionTo: decisionTo || null,
  allowlistPath: allowlistPath || null,
  gateIds,
  bridgedOutputs,
}

await fs.mkdir(path.dirname(summaryOut), { recursive: true })
await fs.writeFile(summaryOut, JSON.stringify(payload, null, 2) + "\n", "utf8")
NODE

npm run verify

echo "DONE run_kiwoom_tp12_pipeline run_id=${pipeline_run_id} summary=${pipeline_summary_out}"
