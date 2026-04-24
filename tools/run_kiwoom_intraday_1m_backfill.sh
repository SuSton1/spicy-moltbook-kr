#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

source tools/load_kiwoom_rest_env.sh

PYTHON_BIN="${PYTHON_BIN:-.venv-datafill/bin/python}"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python runtime not found: ${PYTHON_BIN}" >&2
  exit 1
fi

manifest_path=""
stage_root=""
run_id=""
data_dir="data"
decision_from=""
decision_to=""
symbol_shard_index=""
symbol_shard_count=""
max_workers=1
max_pages_per_symbol=20000
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

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --manifest-path=*) manifest_path="${1#*=}"; shift ;;
    --stage-root=*) stage_root="${1#*=}"; shift ;;
    --run-id=*) run_id="${1#*=}"; shift ;;
    --data-dir=*) data_dir="${1#*=}"; shift ;;
    --decision-from=*) decision_from="${1#*=}"; shift ;;
    --decision-to=*) decision_to="${1#*=}"; shift ;;
    --symbol-shard-index=*) symbol_shard_index="${1#*=}"; shift ;;
    --symbol-shard-count=*) symbol_shard_count="${1#*=}"; shift ;;
    --max-workers=*) max_workers="${1#*=}"; shift ;;
    --max-pages-per-symbol=*) max_pages_per_symbol="${1#*=}"; shift ;;
    --base-url=*) base_url="${1#*=}"; shift ;;
    --retries=*) retries="${1#*=}"; shift ;;
    --sleep-ms=*) sleep_ms="${1#*=}"; shift ;;
    --min-interval-ms=*) min_interval_ms="${1#*=}"; shift ;;
    --cooldown-429-ms=*) cooldown_429_ms="${1#*=}"; shift ;;
    --trace-root=*) trace_root="${1#*=}"; shift ;;
    --crawl-anchor-date=*) crawl_anchor_date="${1#*=}"; shift ;;
    --candle-path=*) candle_path="${1#*=}"; shift ;;
    --overwrite-stage) overwrite_stage=1; shift ;;
    --skip-verify) skip_verify=1; shift ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
  esac
done

if [[ -z "${manifest_path}" ]]; then
  echo "usage: bash tools/run_kiwoom_intraday_1m_backfill.sh --manifest-path=PATH [args...]" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="kiwoom_intraday_1m_$(date +%Y%m%d_%H%M%S)"
fi

if [[ -z "${stage_root}" ]]; then
  stage_root="artifacts/backfill/kiwoom_intraday_1m/run=${run_id}"
fi

cmd=(
  "${PYTHON_BIN}" tools/backfill_kiwoom_intraday_1m.py
  "--manifest-path=${manifest_path}"
  "--stage-root=${stage_root}"
  "--run-id=${run_id}"
  "--max-workers=${max_workers}"
  "--max-pages-per-symbol=${max_pages_per_symbol}"
  "--retries=${retries}"
  "--sleep-ms=${sleep_ms}"
  "--min-interval-ms=${min_interval_ms}"
  "--cooldown-429-ms=${cooldown_429_ms}"
  "--candle-path=${candle_path}"
)

if [[ -n "${decision_from}" ]]; then cmd+=("--decision-from=${decision_from}"); fi
if [[ -n "${decision_to}" ]]; then cmd+=("--decision-to=${decision_to}"); fi
if [[ -n "${symbol_shard_index}" ]]; then cmd+=("--symbol-shard-index=${symbol_shard_index}"); fi
if [[ -n "${symbol_shard_count}" ]]; then cmd+=("--symbol-shard-count=${symbol_shard_count}"); fi
if [[ -n "${base_url}" ]]; then cmd+=("--base-url=${base_url}"); fi
if [[ -n "${trace_root}" ]]; then cmd+=("--trace-root=${trace_root}"); fi
if [[ -n "${crawl_anchor_date}" ]]; then cmd+=("--crawl-anchor-date=${crawl_anchor_date}"); fi
if (( overwrite_stage == 1 )); then cmd+=("--overwrite-stage"); fi

"${cmd[@]}"
"${PYTHON_BIN}" tools/qc_kiwoom_intraday_1m_stage.py --stage-root="${stage_root}" --candle-path="${candle_path}"
"${PYTHON_BIN}" tools/merge_kiwoom_intraday_stage.py --stage-root="${stage_root}" --data-dir="${data_dir}"
if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_kiwoom_intraday_1m_backfill stage_root=${stage_root}"
