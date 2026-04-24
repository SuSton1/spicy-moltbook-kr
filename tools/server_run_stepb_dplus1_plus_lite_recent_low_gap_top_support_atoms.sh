#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_LOW_GAP_TOP_SUPPORT_ATOMS_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v27.json}"

HAS_SUPPORT_CASES_FILE="false"
HAS_ENABLE_INTERVAL_ATOMS="false"
HAS_ENABLE_MACRO_ATOMS="false"
HAS_ENABLE_SUPPORT_ANCHOR_ATOMS="false"

for arg in "$@"; do
  case "$arg" in
    --support-cases-file=*) HAS_SUPPORT_CASES_FILE="true" ;;
    --enable-interval-atoms=*) HAS_ENABLE_INTERVAL_ATOMS="true" ;;
    --enable-macro-atoms=*) HAS_ENABLE_MACRO_ATOMS="true" ;;
    --enable-support-anchor-atoms=*) HAS_ENABLE_SUPPORT_ANCHOR_ATOMS="true" ;;
  esac
done

ARGS=()
if [[ "$HAS_SUPPORT_CASES_FILE" != "true" ]]; then
  ARGS+=(--support-cases-file="$DEFAULT_SUPPORT_CASES_FILE")
fi
if [[ "$HAS_ENABLE_INTERVAL_ATOMS" != "true" ]]; then
  ARGS+=(--enable-interval-atoms=true)
fi
if [[ "$HAS_ENABLE_MACRO_ATOMS" != "true" ]]; then
  ARGS+=(--enable-macro-atoms=true)
fi
if [[ "$HAS_ENABLE_SUPPORT_ANCHOR_ATOMS" != "true" ]]; then
  ARGS+=(--enable-support-anchor-atoms=true)
fi
ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_joint_solver.sh" "${ARGS[@]}"
