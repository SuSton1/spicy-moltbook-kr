#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

mode="probe"
run_id=""
manifest_path="meta/public_kr_partial_coverage_anomaly_manifest.json"
dates_csv=""
lifecycle_path="data/historical_symbol_lifecycle.jsonl"
shares_path="data/historical_shares_intervals.jsonl"
config_path="config/lab.config.server.lite.json"
data_dir="data"
shard_count=5
max_workers_per_shard=3
active_candle_provider="krx"
launch_stagger_sec=2
krx_min_interval_ms=1000
krx_cooldown_ms=60000
overwrite_stage=0
min_local_ratio="0.85"
min_recovery_rate="0.80"

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --mode=*)
      mode="${1#*=}"
      shift
      ;;
    --mode)
      mode="${2:-}"
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
    --manifest-path=*)
      manifest_path="${1#*=}"
      shift
      ;;
    --dates=*)
      dates_csv="${1#*=}"
      shift
      ;;
    --dates)
      dates_csv="${2:-}"
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
    --data-dir=*)
      data_dir="${1#*=}"
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
    --min-local-ratio=*)
      min_local_ratio="${1#*=}"
      shift
      ;;
    --min-recovery-rate=*)
      min_recovery_rate="${1#*=}"
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

if [[ "${mode}" != "probe" && "${mode}" != "apply" ]]; then
  echo "invalid --mode: ${mode} (expected probe|apply)" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="partial_cov_repair_$(date +%Y%m%d_%H%M%S)"
fi

if [[ ! -f "${manifest_path}" ]]; then
  echo "missing manifest path: ${manifest_path}" >&2
  exit 1
fi

mapfile -t target_dates < <(
  python3 - "${manifest_path}" "${dates_csv}" <<'PY'
import json
import sys

manifest_path = sys.argv[1]
dates_csv = sys.argv[2].strip()
if dates_csv:
    rows = [part.strip() for part in dates_csv.split(",") if part.strip()]
else:
    with open(manifest_path, encoding="utf-8") as fh:
        payload = json.load(fh)
    rows = [str(row.get("dateKey") or "").strip() for row in (payload.get("anomalyDates") or []) if str(row.get("dateKey") or "").strip()]
for row in rows:
    print(row)
PY
)

if [[ "${#target_dates[@]}" -eq 0 ]]; then
  echo "no target dates resolved" >&2
  exit 1
fi

run_root="artifacts/data_quality/partial_coverage_repair/run=${run_id}"
mkdir -p "${run_root}"

for date_key in "${target_dates[@]}"; do
  date_slug="${date_key//-/}"
  stage_run_id="${run_id}_${date_slug}"
  universe_mode="$(
    python3 - "${manifest_path}" "${date_key}" <<'PY'
import json
import sys

manifest_path = sys.argv[1]
date_key = sys.argv[2]
with open(manifest_path, encoding="utf-8") as fh:
    payload = json.load(fh)
for row in payload.get("anomalyDates") or []:
    if str(row.get("dateKey") or "").strip() == date_key:
        print(str(row.get("defaultUniverseMode") or "all_common").strip() or "all_common")
        break
else:
    print("all_common")
PY
  )"
  date_root="${run_root}/${date_slug}"
  mkdir -p "${date_root}"

  stage_cmd=(
    bash tools/run_public_kr_historical_stage_only.sh
    --from="${date_key}" \
    --to="${date_key}" \
    --run-id="${stage_run_id}" \
    --lifecycle-path="${lifecycle_path}" \
    --shares-path="${shares_path}" \
    --config="${config_path}" \
    --shard-count="${shard_count}" \
    --max-workers-per-shard="${max_workers_per_shard}" \
    --active-candle-provider="${active_candle_provider}" \
    --launch-stagger-sec="${launch_stagger_sec}" \
    --krx-min-interval-ms="${krx_min_interval_ms}" \
    --krx-cooldown-ms="${krx_cooldown_ms}" \
    --universe-mode="${universe_mode}"
  )
  if (( overwrite_stage == 1 )); then
    stage_cmd+=(--overwrite-stage)
  fi
  "${stage_cmd[@]}"

  stage_root_base="artifacts/backfill/public_kr_historical/run=${stage_run_id}"
  validate_args=(
    python3 tools/validate_public_kr_targeted_repair_stage.py
    --from "${date_key}"
    --to "${date_key}"
    --data-dir "${data_dir}"
    --summary-out "${date_root}/validation_summary.json"
    --min-local-ratio "${min_local_ratio}"
    --min-recovery-rate "${min_recovery_rate}"
  )
  merge_args=(
    python3 tools/merge_public_kr_historical_stage.py
    --from "${date_key}"
    --to "${date_key}"
    --data-dir "${data_dir}"
    --backup-root "artifacts/backups"
    --lock-path "artifacts/backfill/public_kr_historical/merge.lock"
    --merge-journal "artifacts/backfill/public_kr_historical/merge_journal.jsonl"
  )
  for (( shard_idx=0; shard_idx<shard_count; shard_idx+=1 )); do
    validate_args+=(--stage-root "${stage_root_base}/shard=${shard_idx}")
    merge_args+=(--stage-root "${stage_root_base}/shard=${shard_idx}")
  done
  "${validate_args[@]}"

  if [[ "${mode}" == "apply" ]]; then
    "${merge_args[@]}"
  fi
done

if [[ "${mode}" == "apply" ]]; then
  node tools/build_recommendation_close_ret_sidecar.mjs --candle-path="${data_dir}/candle_daily.jsonl" --overwrite=true
  python3 tools/audit_public_kr_partial_coverage_dates.py \
    --data-dir="${data_dir}" \
    --manifest-path="${manifest_path}" \
    --summary-out="${run_root}/post_repair_partial_coverage_audit.json"
  npm run verify
fi

echo "DONE run_public_kr_targeted_date_repair mode=${mode} run_root=${run_root}"
