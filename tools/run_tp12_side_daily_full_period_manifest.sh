#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

train_run_dir=""
oos_run_dir=""
allowlist_path=""
out_path=""
summary_out=""
candle_path="data/candle_daily.jsonl"
allowed_lanes=""
tail_policy="require_full_window"
train_date_from=""
train_date_to=""
oos_date_from=""
oos_date_to=""
skip_verify=0

for arg in "$@"; do
  case "$arg" in
    --train-run-dir=*) train_run_dir="${arg#*=}" ;;
    --oos-run-dir=*) oos_run_dir="${arg#*=}" ;;
    --allowlist-path=*) allowlist_path="${arg#*=}" ;;
    --out=*) out_path="${arg#*=}" ;;
    --summary-out=*) summary_out="${arg#*=}" ;;
    --candle-path=*) candle_path="${arg#*=}" ;;
    --allowed-lanes=*) allowed_lanes="${arg#*=}" ;;
    --tail-policy=*) tail_policy="${arg#*=}" ;;
    --train-date-from=*) train_date_from="${arg#*=}" ;;
    --train-date-to=*) train_date_to="${arg#*=}" ;;
    --oos-date-from=*) oos_date_from="${arg#*=}" ;;
    --oos-date-to=*) oos_date_to="${arg#*=}" ;;
    --skip-verify) skip_verify=1 ;;
    *) echo "unknown arg: ${arg}" >&2; exit 1 ;;
  esac
done

if [[ -z "${train_run_dir}" || -z "${oos_run_dir}" || -z "${allowlist_path}" || -z "${out_path}" || -z "${train_date_from}" || -z "${train_date_to}" || -z "${oos_date_from}" || -z "${oos_date_to}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_full_period_manifest.sh --train-run-dir=PATH --oos-run-dir=PATH --allowlist-path=PATH --out=PATH --train-date-from=YYYY-MM-DD --train-date-to=YYYY-MM-DD --oos-date-from=YYYY-MM-DD --oos-date-to=YYYY-MM-DD [--summary-out=PATH --allowed-lanes=csv --tail-policy=require_full_window|allow_partial]" >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_side_daily_full_period_manifest.mjs
  "--train-run-dir=${train_run_dir}"
  "--oos-run-dir=${oos_run_dir}"
  "--allowlist-path=${allowlist_path}"
  "--out=${out_path}"
  "--candle-path=${candle_path}"
  "--tail-policy=${tail_policy}"
  "--train-date-from=${train_date_from}"
  "--train-date-to=${train_date_to}"
  "--oos-date-from=${oos_date_from}"
  "--oos-date-to=${oos_date_to}"
)
if [[ -n "${summary_out}" ]]; then
  cmd+=("--summary-out=${summary_out}")
fi
if [[ -n "${allowed_lanes}" ]]; then
  cmd+=("--allowed-lanes=${allowed_lanes}")
fi

"${cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_full_period_manifest out=${out_path}"
