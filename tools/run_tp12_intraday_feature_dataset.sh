#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

manifest_path=""
out_path=""
summary_out=""
minute_root="data/intraday_1m"
minute_presence_path="data/intraday_1m_presence_daily.jsonl"
investor_daily_path="data/intraday_side/investor_daily.jsonl"
program_daily_path="data/intraday_side/program_daily.jsonl"
trade_strength_daily_path="data/intraday_side/trade_strength_daily.jsonl"
decision_from=""
decision_to=""
gate_ids=""
minute_cache_date_limit=16
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --manifest-path=*)
      manifest_path="${1#*=}"
      shift
      ;;
    --out=*)
      out_path="${1#*=}"
      shift
      ;;
    --summary-out=*)
      summary_out="${1#*=}"
      shift
      ;;
    --minute-root=*)
      minute_root="${1#*=}"
      shift
      ;;
    --minute-presence-path=*)
      minute_presence_path="${1#*=}"
      shift
      ;;
    --investor-daily-path=*)
      investor_daily_path="${1#*=}"
      shift
      ;;
    --program-daily-path=*)
      program_daily_path="${1#*=}"
      shift
      ;;
    --trade-strength-daily-path=*)
      trade_strength_daily_path="${1#*=}"
      shift
      ;;
    --decision-from=*)
      decision_from="${1#*=}"
      shift
      ;;
    --decision-to=*)
      decision_to="${1#*=}"
      shift
      ;;
    --gate-ids=*)
      gate_ids="${1#*=}"
      shift
      ;;
    --minute-cache-date-limit=*)
      minute_cache_date_limit="${1#*=}"
      shift
      ;;
    --skip-verify)
      skip_verify=1
      shift
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${manifest_path}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_intraday_feature_dataset.sh --manifest-path=PATH --out=PATH [args...]" >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_intraday_feature_dataset.mjs
  "--manifest-path=${manifest_path}"
  "--out=${out_path}"
  "--minute-root=${minute_root}"
  "--minute-presence-path=${minute_presence_path}"
  "--investor-daily-path=${investor_daily_path}"
  "--program-daily-path=${program_daily_path}"
  "--trade-strength-daily-path=${trade_strength_daily_path}"
  "--minute-cache-date-limit=${minute_cache_date_limit}"
)

if [[ -n "${summary_out}" ]]; then
  cmd+=("--summary-out=${summary_out}")
fi
if [[ -n "${decision_from}" ]]; then
  cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  cmd+=("--decision-to=${decision_to}")
fi
if [[ -n "${gate_ids}" ]]; then
  cmd+=("--gate-ids=${gate_ids}")
fi

"${cmd[@]}"
if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_intraday_feature_dataset out=${out_path}"
