#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

source tools/load_krx_mdc_env.sh

PYTHON_BIN="${PYTHON_BIN:-.venv-datafill/bin/python}"
NODE_BIN="${NODE_BIN:-node}"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python runtime not found: ${PYTHON_BIN}" >&2
  exit 1
fi

date_from=""
date_to=""
run_id=""
lifecycle_path="data/historical_symbol_lifecycle.jsonl"
shares_path="data/historical_shares_intervals.jsonl"
config_path="config/lab.config.server.lite.json"
shard_count=5
max_workers_per_shard=3
active_candle_provider="yahoo"
universe_mode="all_common"
overwrite_stage=0
launch_stagger_sec=2
krx_min_interval_ms=1000
krx_cooldown_ms=60000

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --from=*)
      date_from="${1#*=}"
      shift
      ;;
    --from)
      date_from="${2:-}"
      shift 2
      ;;
    --to=*)
      date_to="${1#*=}"
      shift
      ;;
    --to)
      date_to="${2:-}"
      shift 2
      ;;
    --run-id=*)
      run_id="${1#*=}"
      shift
      ;;
    --run-id)
      run_id="${2:-}"
      shift 2
      ;;
    --lifecycle-path=*)
      lifecycle_path="${1#*=}"
      shift
      ;;
    --shares-path=*)
      shares_path="${1#*=}"
      shift
      ;;
    --config=*)
      config_path="${1#*=}"
      shift
      ;;
    --shard-count=*)
      shard_count="${1#*=}"
      shift
      ;;
    --max-workers-per-shard=*)
      max_workers_per_shard="${1#*=}"
      shift
      ;;
    --active-candle-provider=*)
      active_candle_provider="${1#*=}"
      shift
      ;;
    --launch-stagger-sec=*)
      launch_stagger_sec="${1#*=}"
      shift
      ;;
    --krx-min-interval-ms=*)
      krx_min_interval_ms="${1#*=}"
      shift
      ;;
    --krx-cooldown-ms=*)
      krx_cooldown_ms="${1#*=}"
      shift
      ;;
    --universe-mode=*)
      universe_mode="${1#*=}"
      shift
      ;;
    --overwrite-stage)
      overwrite_stage=1
      shift
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ "${active_candle_provider}" != "yahoo" && "${active_candle_provider}" != "krx" ]]; then
  echo "invalid --active-candle-provider: ${active_candle_provider} (expected yahoo|krx)" >&2
  exit 1
fi

if [[ -z "${date_from}" || -z "${date_to}" ]]; then
  echo "usage: bash tools/run_public_kr_historical_backfill.sh --from=YYYY-MM-DD --to=YYYY-MM-DD [--run-id=ID]" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="historical_$(date +%Y%m%d_%H%M%S)"
fi

if [[ ! -f "${lifecycle_path}" ]]; then
  echo "missing lifecycle path: ${lifecycle_path}" >&2
  exit 1
fi
if [[ ! -f "${shares_path}" ]]; then
  echo "missing shares path: ${shares_path}" >&2
  exit 1
fi

run_root="artifacts/backfill/public_kr_historical/run=${run_id}"
log_dir="${run_root}/logs"
mkdir -p "${log_dir}"

"${PYTHON_BIN}" tools/plan_public_kr_historical_shards.py \
  --from="${date_from}" \
  --to="${date_to}" \
  --lifecycle-path="${lifecycle_path}" \
  --shard-count="${shard_count}" \
  --active-candle-provider="${active_candle_provider}" \
  --summary-out="${run_root}/shard_plan.json"

pids=()
stage_roots=()
for (( shard_idx=0; shard_idx<shard_count; shard_idx+=1 )); do
  stage_root="${run_root}/shard=${shard_idx}"
  stage_roots+=("${stage_root}")
  log_file="${log_dir}/shard=${shard_idx}.log"
  summary_out="${stage_root}/summary.json"
  cmd=(
    "${PYTHON_BIN}" tools/backfill_public_kr_historical.py
    "--from=${date_from}"
    "--to=${date_to}"
    "--config=${config_path}"
    "--lifecycle-path=${lifecycle_path}"
    "--shares-path=${shares_path}"
    "--stage-root=${stage_root}"
    "--historical-candle-provider=explicit_source_plan"
    "--active-candle-provider=${active_candle_provider}"
    "--symbol-shard-index=${shard_idx}"
    "--symbol-shard-count=${shard_count}"
    "--max-workers=${max_workers_per_shard}"
    "--krx-min-interval-ms=${krx_min_interval_ms}"
    "--krx-cooldown-ms=${krx_cooldown_ms}"
    "--universe-mode=${universe_mode}"
    "--run-id=${run_id}"
    "--worker-id=shard-${shard_idx}"
    "--summary-out=${summary_out}"
  )
  if (( overwrite_stage == 1 )); then
    cmd+=("--overwrite-stage")
  fi
  printf 'launch shard=%s cmd=' "${shard_idx}"
  printf '%q ' "${cmd[@]}"
  printf '\n'
  "${cmd[@]}" >"${log_file}" 2>&1 &
  pids+=("$!")
  if (( shard_idx + 1 < shard_count )) && [[ "${launch_stagger_sec}" != "0" ]]; then
    sleep "${launch_stagger_sec}"
  fi
done

worker_failed=0
for idx in "${!pids[@]}"; do
  if ! wait "${pids[$idx]}"; then
    worker_failed=1
    echo "worker failed shard=${idx} log=${log_dir}/shard=${idx}.log" >&2
  fi
done

if (( worker_failed == 1 )); then
  echo "historical stage workers failed; inspect ${log_dir}" >&2
  exit 1
fi

for stage_root in "${stage_roots[@]}"; do
  "${PYTHON_BIN}" tools/qc_public_kr_historical_stage.py --stage-root="${stage_root}"
done

mapfile -t quarter_ranges < <(
  "${PYTHON_BIN}" - "${ROOT}" "${date_from}" "${date_to}" <<'PY'
import sys
from pathlib import Path
root = Path(sys.argv[1])
tools_dir = root / "tools"
if str(tools_dir) not in sys.path:
    sys.path.insert(0, str(tools_dir))
from fill_public_kr_daily import parse_day
from public_kr_historical_common import iter_quarter_ranges
day_from = parse_day(sys.argv[2])
day_to = parse_day(sys.argv[3])
rows = iter_quarter_ranges(day_from, day_to)
for row in reversed(rows):
    print(f"{row['from']} {row['to']}")
PY
)

for range_row in "${quarter_ranges[@]}"; do
  range_from="${range_row%% *}"
  range_to="${range_row##* }"
  merge_cmd=(
    "${PYTHON_BIN}" tools/merge_public_kr_historical_stage.py
    "--from=${range_from}"
    "--to=${range_to}"
    "--lifecycle-path=${lifecycle_path}"
  )
  for stage_root in "${stage_roots[@]}"; do
    merge_cmd+=("--stage-root=${stage_root}")
  done
  "${merge_cmd[@]}"
done

"${NODE_BIN}" tools/build_recommendation_close_ret_sidecar.mjs --candle-path=data/candle_daily.jsonl --overwrite=true
npm run verify

echo "DONE run_public_kr_historical_backfill run_root=${run_root}"
