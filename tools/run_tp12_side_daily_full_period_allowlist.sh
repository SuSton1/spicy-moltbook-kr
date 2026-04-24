#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

run_dir=""
out_dir=""
decision_from=""
decision_to=""
allowed_lanes=""
skip_verify=0

for arg in "$@"; do
  case "$arg" in
    --run-dir=*)
      run_dir="${arg#*=}"
      ;;
    --out-dir=*)
      out_dir="${arg#*=}"
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
    --skip-verify)
      skip_verify=1
      ;;
    *)
      echo "unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${run_dir}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_full_period_allowlist.sh --run-dir=PATH [--out-dir=PATH --decision-from=YYYY-MM-DD --decision-to=YYYY-MM-DD --allowed-lanes=csv]" >&2
  exit 1
fi

train_pack_path="${run_dir}/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
oos_pack_path="${run_dir}/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"

if [[ ! -f "${train_pack_path}" ]]; then
  echo "missing train downstream pack: ${train_pack_path}" >&2
  exit 1
fi
if [[ ! -f "${oos_pack_path}" ]]; then
  echo "missing oos downstream pack: ${oos_pack_path}" >&2
  exit 1
fi

if [[ -z "${out_dir}" ]]; then
  out_dir="${run_dir}/step-perfect-prototype-open-full-period-pack"
fi

full_pack_path="${out_dir}/daily_pack.jsonl"
full_pack_summary="${out_dir}/downstream_full_period_pack_summary.json"
allowlist_out="${out_dir}/allowlist_rows.jsonl"
allowlist_summary="${out_dir}/allowlist_summary.json"

bash tools/run_tp12_side_daily_downstream_full_period_pack.sh \
  --train-pack-path="${train_pack_path}" \
  --oos-pack-path="${oos_pack_path}" \
  --out="${full_pack_path}" \
  --summary-out="${full_pack_summary}" \
  --skip-verify

allowlist_cmd=(
  bash tools/run_tp12_intraday_allowlist_from_pack.sh
  "--input=${full_pack_path}"
  "--out=${allowlist_out}"
  "--summary-out=${allowlist_summary}"
  --skip-verify
)
if [[ -n "${decision_from}" ]]; then
  allowlist_cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  allowlist_cmd+=("--decision-to=${decision_to}")
fi
if [[ -n "${allowed_lanes}" ]]; then
  allowlist_cmd+=("--allowed-lanes=${allowed_lanes}")
fi

"${allowlist_cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_full_period_allowlist pack=${full_pack_path} allowlist=${allowlist_out}"
