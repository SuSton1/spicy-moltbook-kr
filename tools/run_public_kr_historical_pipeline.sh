#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

date_from=""
date_to=""
run_id=""
lifecycle_output="data/historical_symbol_lifecycle.jsonl"
shares_output="data/historical_shares_intervals.jsonl"
shares_max_workers=1
shares_krx_max_workers=1
shares_krx_min_interval_ms=1000
shares_krx_cooldown_ms=60000
shard_count=5
max_workers_per_shard=3
launch_stagger_sec=2
universe_mode="all_common"
overwrite_stage=0

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
    --lifecycle-output=*)
      lifecycle_output="${1#*=}"
      shift
      ;;
    --shares-output=*)
      shares_output="${1#*=}"
      shift
      ;;
    --shares-max-workers=*)
      shares_max_workers="${1#*=}"
      shift
      ;;
    --shares-krx-max-workers=*)
      shares_krx_max_workers="${1#*=}"
      shift
      ;;
    --shares-krx-min-interval-ms=*)
      shares_krx_min_interval_ms="${1#*=}"
      shift
      ;;
    --shares-krx-cooldown-ms=*)
      shares_krx_cooldown_ms="${1#*=}"
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
    --launch-stagger-sec=*)
      launch_stagger_sec="${1#*=}"
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

if [[ -z "${date_from}" || -z "${date_to}" ]]; then
  echo "usage: bash tools/run_public_kr_historical_pipeline.sh --from=YYYY-MM-DD --to=YYYY-MM-DD [--run-id=ID]" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="historical_pipeline_$(date +%Y%m%d_%H%M%S)"
fi

bash tools/run_public_kr_historical_inputs.sh \
  --from="${date_from}" \
  --to="${date_to}" \
  --run-id="${run_id}" \
  --lifecycle-output="${lifecycle_output}" \
  --shares-output="${shares_output}" \
  --shares-max-workers="${shares_max_workers}" \
  --shares-krx-max-workers="${shares_krx_max_workers}" \
  --shares-krx-min-interval-ms="${shares_krx_min_interval_ms}" \
  --shares-krx-cooldown-ms="${shares_krx_cooldown_ms}"

backfill_args=(
  --from="${date_from}"
  --to="${date_to}"
  --run-id="${run_id}"
  --lifecycle-path="${lifecycle_output}"
  --shares-path="${shares_output}"
  --shard-count="${shard_count}"
  --max-workers-per-shard="${max_workers_per_shard}"
  --launch-stagger-sec="${launch_stagger_sec}"
  --universe-mode="${universe_mode}"
)

if (( overwrite_stage == 1 )); then
  backfill_args+=(--overwrite-stage)
fi

bash tools/run_public_kr_historical_backfill.sh "${backfill_args[@]}"

echo "DONE run_public_kr_historical_pipeline run_id=${run_id}"
