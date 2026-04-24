#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

manifest_path=""
feature_pack_path=""
out_path=""
label_out_path=""
summary_out_path=""
contract_path="meta/tp12_side_daily_research_contract.json"
candle_path="data/candle_daily.jsonl"
decision_from=""
decision_to=""
train_date_from=""
train_date_to=""
oos_date_from=""
oos_date_to=""
stepa_lane_set=""
target_label_ids=""
allowlist_policy=""
common_support_policy=""
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --manifest-path=*)
      manifest_path="${1#*=}"
      shift
      ;;
    --feature-pack-path=*)
      feature_pack_path="${1#*=}"
      shift
      ;;
    --out=*)
      out_path="${1#*=}"
      shift
      ;;
    --label-out=*)
      label_out_path="${1#*=}"
      shift
      ;;
    --summary-out=*)
      summary_out_path="${1#*=}"
      shift
      ;;
    --candle-path=*)
      candle_path="${1#*=}"
      shift
      ;;
    --contract-path=*)
      contract_path="${1#*=}"
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
    --train-date-from=*)
      train_date_from="${1#*=}"
      shift
      ;;
    --train-date-to=*)
      train_date_to="${1#*=}"
      shift
      ;;
    --oos-date-from=*)
      oos_date_from="${1#*=}"
      shift
      ;;
    --oos-date-to=*)
      oos_date_to="${1#*=}"
      shift
      ;;
    --stepa-lane-set=*)
      stepa_lane_set="${1#*=}"
      shift
      ;;
    --target-label-ids=*)
      target_label_ids="${1#*=}"
      shift
      ;;
    --allowlist-policy=*)
      allowlist_policy="${1#*=}"
      shift
      ;;
    --common-support-policy=*)
      common_support_policy="${1#*=}"
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

if [[ -z "${manifest_path}" || -z "${feature_pack_path}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_control.sh --manifest-path=PATH --feature-pack-path=PATH --out=PATH [--contract-path=meta/tp12_side_daily_research_contract.json args...]" >&2
  exit 1
fi

cmd=(
  node tools/build_tp12_side_daily_control.mjs
  "--manifest-path=${manifest_path}"
  "--feature-pack-path=${feature_pack_path}"
  "--out=${out_path}"
  "--contract-path=${contract_path}"
  "--candle-path=${candle_path}"
)

if [[ -n "${train_date_from}" ]]; then
  cmd+=("--train-date-from=${train_date_from}")
fi
if [[ -n "${train_date_to}" ]]; then
  cmd+=("--train-date-to=${train_date_to}")
fi
if [[ -n "${oos_date_from}" ]]; then
  cmd+=("--oos-date-from=${oos_date_from}")
fi
if [[ -n "${oos_date_to}" ]]; then
  cmd+=("--oos-date-to=${oos_date_to}")
fi
if [[ -n "${stepa_lane_set}" ]]; then
  cmd+=("--stepa-lane-set=${stepa_lane_set}")
fi
if [[ -n "${target_label_ids}" ]]; then
  cmd+=("--target-label-ids=${target_label_ids}")
fi
if [[ -n "${allowlist_policy}" ]]; then
  cmd+=("--allowlist-policy=${allowlist_policy}")
fi
if [[ -n "${common_support_policy}" ]]; then
  cmd+=("--common-support-policy=${common_support_policy}")
fi

if [[ -n "${label_out_path}" ]]; then
  cmd+=("--label-out=${label_out_path}")
fi
if [[ -n "${summary_out_path}" ]]; then
  cmd+=("--summary-out=${summary_out_path}")
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

echo "DONE run_tp12_side_daily_control out=${out_path}"
