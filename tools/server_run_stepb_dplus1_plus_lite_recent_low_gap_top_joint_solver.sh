#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SUPPORT_CASES_FILE="${PERFECT_PROTO_LOW_GAP_TOP_JOINT_SUPPORT_CASES_FILE:-/home/moltook/apps/stockdesk-lab-lite/artifacts/support_cases/haesung_076610_20260318_low_gap_top_v12.json}"

HAS_RECENT_ONLY_FAMILY_IDS="false"
HAS_SUPPORT_CASES_FILE="false"
HAS_ENABLE_SUBGROUP_PREPASS="false"
HAS_ENABLE_SUBGROUP_STABILITY="false"
HAS_ENABLE_SUBGROUP_DIVERSITY="false"
HAS_ENABLE_EXACT_COMPLETION_SOLVER="false"
HAS_ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT="false"
HAS_ENABLE_JOINT_FEASIBILITY_SOLVER="false"
HAS_EXACT_COMPLETION_MODE="false"
HAS_JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS="false"
HAS_JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS="false"
HAS_JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT="false"
HAS_JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS="false"

for arg in "$@"; do
  case "$arg" in
    --recent-only-family-ids=*)
      HAS_RECENT_ONLY_FAMILY_IDS="true"
      [[ "${arg#*=}" == "low_gap_top_continuation" ]] || {
        echo "[fatal] joint low-gap-top wrapper requires --recent-only-family-ids=low_gap_top_continuation" >&2
        exit 4
      }
      ;;
    --support-cases-file=*) HAS_SUPPORT_CASES_FILE="true" ;;
    --enable-subgroup-prepass=*) HAS_ENABLE_SUBGROUP_PREPASS="true" ;;
    --enable-subgroup-stability=*) HAS_ENABLE_SUBGROUP_STABILITY="true" ;;
    --enable-subgroup-diversity=*) HAS_ENABLE_SUBGROUP_DIVERSITY="true" ;;
    --enable-exact-completion-solver=*) HAS_ENABLE_EXACT_COMPLETION_SOLVER="true" ;;
    --enable-crossfit-hard-negative-refinement=*) HAS_ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT="true" ;;
    --enable-joint-feasibility-solver=*) HAS_ENABLE_JOINT_FEASIBILITY_SOLVER="true" ;;
    --exact-completion-mode=*) HAS_EXACT_COMPLETION_MODE="true" ;;
    --joint-feasibility-min-crossfit-positive-windows=*) HAS_JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS="true" ;;
    --joint-feasibility-max-crossfit-negative-windows=*) HAS_JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS="true" ;;
    --joint-feasibility-require-historical-support=*) HAS_JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT="true" ;;
    --joint-feasibility-historical-support-case-ids=*) HAS_JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS="true" ;;
  esac
done

ARGS=(
  --recent-only-family-ids=low_gap_top_continuation
  --enable-subgroup-prepass=true
  --enable-subgroup-stability=true
  --enable-subgroup-diversity=true
  --enable-exact-completion-solver=true
  --enable-crossfit-hard-negative-refinement=true
  --enable-joint-feasibility-solver=true
  --exact-completion-mode=joint_feasibility
  --subgroup-min-matched-dates=10
  --subgroup-min-matched-months=6
  --subgroup-min-matched-folds=4
  --subgroup-max-root-seeds=64
  --subgroup-max-manifests=8
  --subgroup-min-selection-frequency=0.5
  --subgroup-min-fold-presence-count=3
  --subgroup-min-window-presence-count=2
  --subgroup-max-token-jaccard=0.8
  --subgroup-max-axis-overlap=2
  --subgroup-max-date-cover-jaccard=0.9
  --subgroup-early-date-retention-ratio=0.6
  --subgroup-early-month-retention-ratio=0.75
  --subgroup-early-fold-retention-ratio=0.75
  --exact-completion-max-candidates=24
  --exact-completion-max-additional-tokens=3
  --crossfit-holdout-windows=6
  --crossfit-min-window-support=2
  --crossfit-hard-negative-weight=4
  --joint-feasibility-min-crossfit-positive-windows=2
  --joint-feasibility-max-crossfit-negative-windows=0
  --joint-feasibility-require-historical-support=true
  --joint-feasibility-historical-support-case-ids=076610:2026-03-18
)

if [[ "$HAS_RECENT_ONLY_FAMILY_IDS" == "true" ]]; then
  ARGS=("${ARGS[@]:1}")
fi
if [[ "$HAS_SUPPORT_CASES_FILE" != "true" ]]; then
  ARGS+=(--support-cases-file="$DEFAULT_SUPPORT_CASES_FILE")
fi
if [[ "$HAS_ENABLE_SUBGROUP_PREPASS" == "true" ]]; then ARGS=("${ARGS[@]/--enable-subgroup-prepass=true}"); fi
if [[ "$HAS_ENABLE_SUBGROUP_STABILITY" == "true" ]]; then ARGS=("${ARGS[@]/--enable-subgroup-stability=true}"); fi
if [[ "$HAS_ENABLE_SUBGROUP_DIVERSITY" == "true" ]]; then ARGS=("${ARGS[@]/--enable-subgroup-diversity=true}"); fi
if [[ "$HAS_ENABLE_EXACT_COMPLETION_SOLVER" == "true" ]]; then ARGS=("${ARGS[@]/--enable-exact-completion-solver=true}"); fi
if [[ "$HAS_ENABLE_CROSSFIT_HARD_NEGATIVE_REFINEMENT" == "true" ]]; then ARGS=("${ARGS[@]/--enable-crossfit-hard-negative-refinement=true}"); fi
if [[ "$HAS_ENABLE_JOINT_FEASIBILITY_SOLVER" == "true" ]]; then ARGS=("${ARGS[@]/--enable-joint-feasibility-solver=true}"); fi
if [[ "$HAS_EXACT_COMPLETION_MODE" == "true" ]]; then ARGS=("${ARGS[@]/--exact-completion-mode=joint_feasibility}"); fi
if [[ "$HAS_JOINT_FEASIBILITY_MIN_CROSSFIT_POSITIVE_WINDOWS" == "true" ]]; then ARGS=("${ARGS[@]/--joint-feasibility-min-crossfit-positive-windows=2}"); fi
if [[ "$HAS_JOINT_FEASIBILITY_MAX_CROSSFIT_NEGATIVE_WINDOWS" == "true" ]]; then ARGS=("${ARGS[@]/--joint-feasibility-max-crossfit-negative-windows=0}"); fi
if [[ "$HAS_JOINT_FEASIBILITY_REQUIRE_HISTORICAL_SUPPORT" == "true" ]]; then ARGS=("${ARGS[@]/--joint-feasibility-require-historical-support=true}"); fi
if [[ "$HAS_JOINT_FEASIBILITY_HISTORICAL_SUPPORT_CASE_IDS" == "true" ]]; then ARGS=("${ARGS[@]/--joint-feasibility-historical-support-case-ids=076610:2026-03-18}"); fi

FILTERED_ARGS=()
for arg in "${ARGS[@]}"; do
  [[ -n "$arg" ]] && FILTERED_ARGS+=("$arg")
done
FILTERED_ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_mid_low.sh" "${FILTERED_ARGS[@]}"
