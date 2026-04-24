#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

source tools/load_kiwoom_rest_env.sh

manifest_path=""
run_id=""
data_dir="data"
decision_from=""
decision_to=""
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
skip_verify=0

for arg in "$@"; do
  case "$arg" in
    --manifest-path=*)
      manifest_path="${arg#*=}"
      ;;
    --run-id=*)
      run_id="${arg#*=}"
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
    --skip-verify)
      skip_verify=1
      ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${manifest_path}" ]]; then
  echo "usage: bash tools/run_kiwoom_tp12_backfill.sh --manifest-path=PATH [--run-id=ID --data-dir=PATH --decision-from=YYYY-MM-DD --decision-to=YYYY-MM-DD --symbol-shard-index=N --symbol-shard-count=N]" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="kiwoom_tp12_backfill_$(date +%Y%m%d_%H%M%S)"
fi

stage_root_base="artifacts/backfill/kiwoom_tp12/run=${run_id}"
side_trace_root=""
minute_trace_root=""
if [[ -n "${trace_root}" ]]; then
  side_trace_root="${trace_root%/}/side_daily"
  minute_trace_root="${trace_root%/}/minute_1m"
fi

datasets=(investor_daily program_daily trade_strength_daily)
for dataset in "${datasets[@]}"; do
  cmd=(
    bash tools/run_kiwoom_side_daily_backfill.sh
    "--dataset=${dataset}"
    "--manifest-path=${manifest_path}"
    "--stage-root=${stage_root_base}/side_daily/dataset=${dataset}"
    "--run-id=${run_id}"
    "--data-dir=${data_dir}"
    "--max-workers=${side_max_workers}"
    "--max-pages-per-symbol=${side_max_pages_per_symbol}"
    "--retries=${retries}"
    "--sleep-ms=${sleep_ms}"
    "--min-interval-ms=${min_interval_ms}"
    "--cooldown-429-ms=${cooldown_429_ms}"
    "--skip-verify"
  )
  if [[ -n "${decision_from}" ]]; then
    cmd+=("--decision-from=${decision_from}")
  fi
  if [[ -n "${decision_to}" ]]; then
    cmd+=("--decision-to=${decision_to}")
  fi
  if [[ -n "${symbol_shard_index}" ]]; then
    cmd+=("--symbol-shard-index=${symbol_shard_index}")
  fi
  if [[ -n "${symbol_shard_count}" ]]; then
    cmd+=("--symbol-shard-count=${symbol_shard_count}")
  fi
  if [[ -n "${base_url}" ]]; then
    cmd+=("--base-url=${base_url}")
  fi
  if [[ -n "${side_trace_root}" ]]; then
    cmd+=("--trace-root=${side_trace_root}/dataset=${dataset}")
  fi
  if (( overwrite_stage == 1 )); then
    cmd+=("--overwrite-stage")
  fi
  "${cmd[@]}"
done

minute_cmd=(
  bash tools/run_kiwoom_intraday_1m_backfill.sh
  "--manifest-path=${manifest_path}"
  "--stage-root=${stage_root_base}/minute_1m"
  "--run-id=${run_id}"
  "--data-dir=${data_dir}"
  "--max-workers=${minute_max_workers}"
  "--max-pages-per-symbol=${minute_max_pages_per_symbol}"
  "--retries=${retries}"
  "--sleep-ms=${sleep_ms}"
  "--min-interval-ms=${min_interval_ms}"
  "--cooldown-429-ms=${cooldown_429_ms}"
  "--candle-path=${candle_path}"
  "--skip-verify"
)

if [[ -n "${decision_from}" ]]; then
  minute_cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  minute_cmd+=("--decision-to=${decision_to}")
fi
if [[ -n "${symbol_shard_index}" ]]; then
  minute_cmd+=("--symbol-shard-index=${symbol_shard_index}")
fi
if [[ -n "${symbol_shard_count}" ]]; then
  minute_cmd+=("--symbol-shard-count=${symbol_shard_count}")
fi
if [[ -n "${base_url}" ]]; then
  minute_cmd+=("--base-url=${base_url}")
fi
if [[ -n "${minute_trace_root}" ]]; then
  minute_cmd+=("--trace-root=${minute_trace_root}")
fi
if [[ -n "${crawl_anchor_date}" ]]; then
  minute_cmd+=("--crawl-anchor-date=${crawl_anchor_date}")
fi
if (( overwrite_stage == 1 )); then
  minute_cmd+=("--overwrite-stage")
fi

"${minute_cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_kiwoom_tp12_backfill manifest=${manifest_path} run_id=${run_id}"
