#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

run_dir=""
events_path=""
summary_path=""
allowlist_path=""
out_path=""
summary_out=""
candle_path="data/candle_daily.jsonl"
decision_from=""
decision_to=""
allowed_lanes=""
tail_policy="require_full_window"
skip_verify=0

for arg in "$@"; do
  case "$arg" in
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
    --out=*)
      out_path="${arg#*=}"
      ;;
    --summary-out=*)
      summary_out="${arg#*=}"
      ;;
    --candle-path=*)
      candle_path="${arg#*=}"
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
    --skip-verify)
      skip_verify=1
      ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${run_dir}" && ( -n "${events_path}" || -n "${summary_path}" ) ]]; then
  echo "run_kiwoom_tp12_inputs.sh accepts either --run-dir or --events-path/--summary-path, not both" >&2
  exit 1
fi

if [[ -z "${run_dir}" && ( -z "${events_path}" || -z "${summary_path}" ) ]]; then
  echo "usage: bash tools/run_kiwoom_tp12_inputs.sh (--run-dir=PATH | --events-path=PATH --summary-path=PATH) [--allowlist-path=PATH --out=PATH --summary-out=PATH --decision-from=YYYY-MM-DD --decision-to=YYYY-MM-DD --allowed-lanes=csv --tail-policy=require_full_window|allow_partial]" >&2
  exit 1
fi

source_run_id=""
if [[ -n "${run_dir}" ]]; then
  source_run_id="$(basename "${run_dir%/}")"
else
  source_run_id="$(basename "$(dirname "$(dirname "${events_path}")")")"
fi

if [[ -z "${out_path}" ]]; then
  out_path="artifacts/tp12_intraday/request_manifest/run=${source_run_id}/requests.jsonl"
fi

if [[ -z "${summary_out}" ]]; then
  summary_out="$(dirname "${out_path}")/manifest_summary.json"
fi

cmd=(
  node tools/build_tp12_stepa_intraday_manifest.mjs
  "--out=${out_path}"
  "--summary-out=${summary_out}"
  "--candle-path=${candle_path}"
  "--tail-policy=${tail_policy}"
)

if [[ -n "${run_dir}" ]]; then
  cmd+=("--run-dir=${run_dir}")
else
  cmd+=("--events-path=${events_path}" "--summary-path=${summary_path}")
fi
if [[ -n "${decision_from}" ]]; then
  cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  cmd+=("--decision-to=${decision_to}")
fi
if [[ -n "${allowed_lanes}" ]]; then
  cmd+=("--allowed-lanes=${allowed_lanes}")
fi
if [[ -n "${allowlist_path}" ]]; then
  cmd+=("--allowlist-path=${allowlist_path}")
fi

"${cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_kiwoom_tp12_inputs out=${out_path}"
