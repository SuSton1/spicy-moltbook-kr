#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

contract_path="meta/tp12_execution_learning_fixed_support_contract.json"
pipeline_summary_path=""
selection_manifest_path=""
out_dir=""
candle_path="data/candle_daily.jsonl"
recent_replay_decision_count=""
expected_pair_signature_sha256=""
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      contract_path="${1#*=}"
      shift
      ;;
    --pipeline-summary-path=*)
      pipeline_summary_path="${1#*=}"
      shift
      ;;
    --selection-manifest-path=*)
      selection_manifest_path="${1#*=}"
      shift
      ;;
    --out-dir=*)
      out_dir="${1#*=}"
      shift
      ;;
    --candle-path=*)
      candle_path="${1#*=}"
      shift
      ;;
    --recent-replay-decision-count=*)
      recent_replay_decision_count="${1#*=}"
      shift
      ;;
    --expected-pair-signature-sha256=*)
      expected_pair_signature_sha256="${1#*=}"
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

if [[ -z "${pipeline_summary_path}" || -z "${selection_manifest_path}" || -z "${out_dir}" ]]; then
  echo "usage: bash tools/run_tp12_execution_learning_fixed_support.sh --pipeline-summary-path=PATH --selection-manifest-path=PATH --out-dir=PATH [--contract-path=PATH --candle-path=PATH --recent-replay-decision-count=N --expected-pair-signature-sha256=SHA256]" >&2
  exit 1
fi
[[ -f "${contract_path}" ]] || { echo "[fatal] contract path missing: ${contract_path}" >&2; exit 4; }

if [[ -z "${recent_replay_decision_count}" ]]; then
  recent_replay_decision_count="$(
    node --input-type=module - "${contract_path}" <<'NODE'
import fs from "node:fs"

const contract = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
process.stdout.write(String(Number(contract?.defaultRecentReplayDecisionCount ?? 30) || 30))
NODE
  )"
fi

node tools/build_tp12_side_daily_execution_learning_bundle.mjs \
  "--pipeline-summary-path=${pipeline_summary_path}" \
  "--selection-manifest-path=${selection_manifest_path}" \
  "--out-dir=${out_dir}" \
  "--candle-path=${candle_path}" \
  "--recent-replay-decision-count=${recent_replay_decision_count}"

report_args=(
  "--contract-path=${contract_path}"
  "--bundle-summary-path=${out_dir}/execution_learning_summary.json"
  "--label-path=${out_dir}/execution_label_rows.jsonl"
  "--out=${out_dir}/fixed_support_report.json"
)
if [[ -n "${expected_pair_signature_sha256}" ]]; then
  report_args+=("--expected-pair-signature-sha256=${expected_pair_signature_sha256}")
fi
node tools/build_tp12_execution_learning_fixed_support_report.mjs "${report_args[@]}"

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_execution_learning_fixed_support out_dir=${out_dir}"
