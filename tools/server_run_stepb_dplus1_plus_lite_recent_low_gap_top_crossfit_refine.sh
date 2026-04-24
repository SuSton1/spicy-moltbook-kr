#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HAS_ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT="false"
HAS_CROSSFIT_HOLDOUT_WINDOWS="false"
HAS_CROSSFIT_MIN_WINDOW_SUPPORT="false"
HAS_CROSSFIT_HARD_NEGATIVE_WEIGHT="false"

for arg in "$@"; do
  case "$arg" in
    --enable-crossfit-hard-negative-refinement=*) HAS_ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT="true" ;;
    --crossfit-holdout-windows=*) HAS_CROSSFIT_HOLDOUT_WINDOWS="true" ;;
    --crossfit-min-window-support=*) HAS_CROSSFIT_MIN_WINDOW_SUPPORT="true" ;;
    --crossfit-hard-negative-weight=*) HAS_CROSSFIT_HARD_NEGATIVE_WEIGHT="true" ;;
  esac
done

ARGS=()
if [[ "$HAS_ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT" != "true" ]]; then
  ARGS+=(--enable-crossfit-hard-negative-refinement=true)
fi
if [[ "$HAS_CROSSFIT_HOLDOUT_WINDOWS" != "true" ]]; then
  ARGS+=(--crossfit-holdout-windows=6)
fi
if [[ "$HAS_CROSSFIT_MIN_WINDOW_SUPPORT" != "true" ]]; then
  ARGS+=(--crossfit-min-window-support=2)
fi
if [[ "$HAS_CROSSFIT_HARD_NEGATIVE_WEIGHT" != "true" ]]; then
  ARGS+=(--crossfit-hard-negative-weight=4)
fi
ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_subgroup_system.sh" "${ARGS[@]}"
