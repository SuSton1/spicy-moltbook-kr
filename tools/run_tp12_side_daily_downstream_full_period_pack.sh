#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

train_pack_path=""
oos_pack_path=""
out_path=""
summary_out=""
skip_verify=0

for arg in "$@"; do
  case "$arg" in
    --train-pack-path=*)
      train_pack_path="${arg#*=}"
      ;;
    --oos-pack-path=*)
      oos_pack_path="${arg#*=}"
      ;;
    --out=*)
      out_path="${arg#*=}"
      ;;
    --summary-out=*)
      summary_out="${arg#*=}"
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

if [[ -z "${train_pack_path}" || -z "${oos_pack_path}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_downstream_full_period_pack.sh --train-pack-path=PATH --oos-pack-path=PATH --out=PATH [--summary-out=PATH]" >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_side_daily_downstream_full_period_pack.mjs
  "--train-pack-path=${train_pack_path}"
  "--oos-pack-path=${oos_pack_path}"
  "--out=${out_path}"
)
if [[ -n "${summary_out}" ]]; then
  cmd+=("--summary-out=${summary_out}")
fi

"${cmd[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_downstream_full_period_pack out=${out_path}"
