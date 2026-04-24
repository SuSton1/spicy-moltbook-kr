#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

contract_path="meta/tp12_no_stop_rolling_research_contract.json"
manifest_path=""
out_path=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      contract_path="${1#*=}"
      shift
      ;;
    --manifest-path=*)
      manifest_path="${1#*=}"
      shift
      ;;
    --out=*)
      out_path="${1#*=}"
      shift
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${manifest_path}" || -z "${out_path}" ]]; then
  echo "usage: bash tools/run_tp12_no_stop_rolling_summary.sh --manifest-path=PATH --out=PATH [--contract-path=PATH]" >&2
  exit 1
fi

node tools/build_tp12_no_stop_rolling_summary.mjs \
  "--contract-path=${contract_path}" \
  "--manifest-path=${manifest_path}" \
  "--out=${out_path}"

echo "DONE run_tp12_no_stop_rolling_summary out=${out_path}"
