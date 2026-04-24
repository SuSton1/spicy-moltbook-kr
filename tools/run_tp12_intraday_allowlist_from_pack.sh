#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

input_path=""
out_path=""
summary_out=""
decision_from=""
decision_to=""
allowed_lanes=""
require_stepa_lane="true"
skip_verify=0

for arg in "$@"; do
  case "$arg" in
    --input=*)
      input_path="${arg#*=}"
      ;;
    --out=*)
      out_path="${arg#*=}"
      ;;
    --summary-out=*)
      summary_out="${arg#*=}"
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
    --require-stepa-lane=*)
      require_stepa_lane="${arg#*=}"
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

if [[ -z "${input_path}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_intraday_allowlist_from_pack.sh --input=PATH --out=PATH [--summary-out=PATH --decision-from=YYYY-MM-DD --decision-to=YYYY-MM-DD --allowed-lanes=csv --require-stepa-lane=true|false]" >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_intraday_allowlist_from_pack.mjs
  "--input=${input_path}"
  "--out=${out_path}"
  "--require-stepa-lane=${require_stepa_lane}"
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
if [[ -n "${allowed_lanes}" ]]; then
  cmd+=("--allowed-lanes=${allowed_lanes}")
fi

"${cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_intraday_allowlist_from_pack out=${out_path}"
