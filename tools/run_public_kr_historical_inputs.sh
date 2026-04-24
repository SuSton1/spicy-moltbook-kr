#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

source tools/load_krx_mdc_env.sh

PYTHON_BIN="${PYTHON_BIN:-.venv-datafill/bin/python}"
if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python runtime not found: ${PYTHON_BIN}" >&2
  exit 1
fi

date_from=""
date_to=""
run_id=""
lifecycle_output="data/historical_symbol_lifecycle.jsonl"
shares_output="data/historical_shares_intervals.jsonl"
lifecycle_retries=4
lifecycle_sleep_ms=250
shares_max_workers=1
shares_krx_max_workers=1
shares_retries=4
shares_sleep_ms=250
shares_krx_min_interval_ms=1000
shares_krx_cooldown_ms=60000

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
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${date_from}" || -z "${date_to}" ]]; then
  echo "usage: bash tools/run_public_kr_historical_inputs.sh --from=YYYY-MM-DD --to=YYYY-MM-DD [--run-id=ID]" >&2
  exit 1
fi

if [[ -z "${run_id}" ]]; then
  run_id="historical_inputs_$(date +%Y%m%d_%H%M%S)"
fi

run_root="artifacts/backfill/public_kr_historical_inputs/run=${run_id}"
mkdir -p "${run_root}"

"${PYTHON_BIN}" tools/probe_public_kr_krx_contract.py \
  --auth-mode=login-required \
  --output="${run_root}/krx_contract_probe.json" \
  --trace-dir="${run_root}/krx_contract_probe"

"${PYTHON_BIN}" tools/build_historical_symbol_lifecycle.py \
  --from="${date_from}" \
  --to="${date_to}" \
  --output="${lifecycle_output}" \
  --summary-out="${run_root}/lifecycle_summary.json" \
  --audit-dir="${run_root}/audit" \
  --retries="${lifecycle_retries}" \
  --sleep-ms="${lifecycle_sleep_ms}"

"${PYTHON_BIN}" tools/build_historical_shares_intervals.py \
  --from="${date_from}" \
  --to="${date_to}" \
  --lifecycle-path="${lifecycle_output}" \
  --output="${shares_output}" \
  --summary-out="${run_root}/shares_summary.json" \
  --audit-dir="${run_root}/audit" \
  --max-workers="${shares_max_workers}" \
  --krx-max-workers="${shares_krx_max_workers}" \
  --krx-min-interval-ms="${shares_krx_min_interval_ms}" \
  --krx-cooldown-ms="${shares_krx_cooldown_ms}" \
  --retries="${shares_retries}" \
  --sleep-ms="${shares_sleep_ms}"

echo "DONE run_public_kr_historical_inputs run_root=${run_root}"
