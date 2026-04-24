#!/usr/bin/env bash
set -euo pipefail

feature_pack_path=""
side_feature_path=""
gate_id=""
out_path=""
meta_out=""
decision_from=""
decision_to=""
skip_verify=0

for arg in "$@"; do
  case "$arg" in
    --feature-pack-path=*)
      feature_pack_path="${arg#*=}"
      ;;
    --side-feature-path=*)
      side_feature_path="${arg#*=}"
      ;;
    --gate-id=*)
      gate_id="${arg#*=}"
      ;;
    --out=*)
      out_path="${arg#*=}"
      ;;
    --meta-out=*)
      meta_out="${arg#*=}"
      ;;
    --decision-from=*)
      decision_from="${arg#*=}"
      ;;
    --decision-to=*)
      decision_to="${arg#*=}"
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

if [[ -z "${feature_pack_path}" || -z "${side_feature_path}" || -z "${gate_id}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_feature_pack_bridge.sh --feature-pack-path=PATH --side-feature-path=PATH --gate-id=ID --out=PATH [--meta-out=PATH --decision-from=YYYY-MM-DD --decision-to=YYYY-MM-DD]" >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_side_daily_feature_pack_bridge.mjs
  "--feature-pack-path=${feature_pack_path}"
  "--side-feature-path=${side_feature_path}"
  "--gate-id=${gate_id}"
  "--out=${out_path}"
)

if [[ -n "${meta_out}" ]]; then
  cmd+=("--meta-out=${meta_out}")
fi
if [[ -n "${decision_from}" ]]; then
  cmd+=("--decision-from=${decision_from}")
fi
if [[ -n "${decision_to}" ]]; then
  cmd+=("--decision-to=${decision_to}")
fi

"${cmd[@]}"
if (( skip_verify == 0 )); then
  npm run verify
fi
echo "DONE run_tp12_side_daily_feature_pack_bridge out=${out_path}"
