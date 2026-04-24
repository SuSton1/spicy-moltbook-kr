#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONTROL_SUMMARY_PATH=""
GATED_SUMMARY_PATH=""
OUT_DIR=""
COMPARISON_LABEL="primary"

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --control-summary-path=*) CONTROL_SUMMARY_PATH="${1#*=}"; shift ;;
    --gated-summary-path=*) GATED_SUMMARY_PATH="${1#*=}"; shift ;;
    --out-dir=*) OUT_DIR="${1#*=}"; shift ;;
    --comparison-label=*) COMPARISON_LABEL="${1#*=}"; shift ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

[[ -n "$CONTROL_SUMMARY_PATH" ]] || { echo "--control-summary-path is required" >&2; exit 1; }
[[ -n "$GATED_SUMMARY_PATH" ]] || { echo "--gated-summary-path is required" >&2; exit 1; }
[[ -n "$OUT_DIR" ]] || { echo "--out-dir is required" >&2; exit 1; }

mkdir -p "$OUT_DIR"

node tools/build_tp12_year2hit_gate_summary.mjs \
  "--control-summary-path=${CONTROL_SUMMARY_PATH}" \
  "--gated-summary-path=${GATED_SUMMARY_PATH}" \
  "--comparison-label=${COMPARISON_LABEL}" \
  "--out=${OUT_DIR}/year2hit_gate_summary.json"

echo "[done] tp12 year2hit overlay pipeline summary=${OUT_DIR}/year2hit_gate_summary.json"
