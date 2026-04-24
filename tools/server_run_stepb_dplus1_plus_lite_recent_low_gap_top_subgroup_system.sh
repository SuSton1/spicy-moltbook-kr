#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HAS_ENABLE_SUBGROUP_STABILITY="false"
HAS_ENABLE_SUBGROUP_DIVERSITY="false"
HAS_SUBGROUP_MAX_MANIFESTS="false"
HAS_SUBGROUP_MIN_SELECTION_FREQUENCY="false"
HAS_SUBGROUP_MIN_FOLD_PRESENCE_COUNT="false"
HAS_SUBGROUP_MIN_WINDOW_PRESENCE_COUNT="false"
HAS_SUBGROUP_MAX_TOKEN_JACCARD="false"
HAS_SUBGROUP_MAX_AXIS_OVERLAP="false"
HAS_ENABLE_EXACT_COMPLETION_SOLVER="false"
HAS_EXACT_COMPLETION_MODE="false"
HAS_EXACT_COMPLETION_MAX_CANDIDATES="false"
HAS_EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS="false"

for arg in "$@"; do
  case "$arg" in
    --enable-subgroup-stability=*) HAS_ENABLE_SUBGROUP_STABILITY="true" ;;
    --enable-subgroup-diversity=*) HAS_ENABLE_SUBGROUP_DIVERSITY="true" ;;
    --subgroup-max-manifests=*) HAS_SUBGROUP_MAX_MANIFESTS="true" ;;
    --subgroup-min-selection-frequency=*) HAS_SUBGROUP_MIN_SELECTION_FREQUENCY="true" ;;
    --subgroup-min-fold-presence-count=*) HAS_SUBGROUP_MIN_FOLD_PRESENCE_COUNT="true" ;;
    --subgroup-min-window-presence-count=*) HAS_SUBGROUP_MIN_WINDOW_PRESENCE_COUNT="true" ;;
    --subgroup-max-token-jaccard=*) HAS_SUBGROUP_MAX_TOKEN_JACCARD="true" ;;
    --subgroup-max-axis-overlap=*) HAS_SUBGROUP_MAX_AXIS_OVERLAP="true" ;;
    --enable-exact-completion-solver=*) HAS_ENABLE_EXACT_COMPLETION_SOLVER="true" ;;
    --exact-completion-mode=*) HAS_EXACT_COMPLETION_MODE="true" ;;
    --exact-completion-max-candidates=*) HAS_EXACT_COMPLETION_MAX_CANDIDATES="true" ;;
    --exact-completion-max-additional-tokens=*) HAS_EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS="true" ;;
  esac
done

ARGS=()
if [[ "$HAS_ENABLE_SUBGROUP_STABILITY" != "true" ]]; then
  ARGS+=(--enable-subgroup-stability=true)
fi
if [[ "$HAS_ENABLE_SUBGROUP_DIVERSITY" != "true" ]]; then
  ARGS+=(--enable-subgroup-diversity=true)
fi
if [[ "$HAS_SUBGROUP_MAX_MANIFESTS" != "true" ]]; then
  ARGS+=(--subgroup-max-manifests=8)
fi
if [[ "$HAS_SUBGROUP_MIN_SELECTION_FREQUENCY" != "true" ]]; then
  ARGS+=(--subgroup-min-selection-frequency=0.5)
fi
if [[ "$HAS_SUBGROUP_MIN_FOLD_PRESENCE_COUNT" != "true" ]]; then
  ARGS+=(--subgroup-min-fold-presence-count=3)
fi
if [[ "$HAS_SUBGROUP_MIN_WINDOW_PRESENCE_COUNT" != "true" ]]; then
  ARGS+=(--subgroup-min-window-presence-count=2)
fi
if [[ "$HAS_SUBGROUP_MAX_TOKEN_JACCARD" != "true" ]]; then
  ARGS+=(--subgroup-max-token-jaccard=0.8)
fi
if [[ "$HAS_SUBGROUP_MAX_AXIS_OVERLAP" != "true" ]]; then
  ARGS+=(--subgroup-max-axis-overlap=2)
fi
if [[ "$HAS_ENABLE_EXACT_COMPLETION_SOLVER" != "true" ]]; then
  ARGS+=(--enable-exact-completion-solver=true)
fi
if [[ "$HAS_EXACT_COMPLETION_MODE" != "true" ]]; then
  ARGS+=(--exact-completion-mode=counterexample_core_frontier)
fi
if [[ "$HAS_EXACT_COMPLETION_MAX_CANDIDATES" != "true" ]]; then
  ARGS+=(--exact-completion-max-candidates=24)
fi
if [[ "$HAS_EXACT_COMPLETION_MAX_ADDITIONAL_TOKENS" != "true" ]]; then
  ARGS+=(--exact-completion-max-additional-tokens=3)
fi
ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_low_gap_top_generalized.sh" "${ARGS[@]}"
