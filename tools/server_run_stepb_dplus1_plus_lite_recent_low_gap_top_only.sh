#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HAS_RECENT_ONLY_FAMILY_IDS="false"
HAS_SUPPORT_CASES_FILE="false"
HAS_SUPPORT_CASE_MAX_ROOT_SEEDS="false"
HAS_SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS="false"
HAS_SUPPORT_CASE_MIN_ROOT_OVERLAP="false"
HAS_SUPPORT_CASE_MIN_PREFIX_OVERLAP="false"
HAS_SUPPORT_CASE_PREFIX_DEPTH_LIMIT="false"
HAS_SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP="false"
HAS_SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP="false"
HAS_SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT="false"
HAS_SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED="false"
HAS_MAX_SEED_TOKENS="false"

for arg in "$@"; do
  case "$arg" in
    --recent-only-family-ids=*)
      HAS_RECENT_ONLY_FAMILY_IDS="true"
      [[ "${arg#*=}" == "low_gap_top_continuation" ]] || {
        echo "[fatal] low-gap-top targeted wrapper requires --recent-only-family-ids=low_gap_top_continuation" >&2
        exit 4
      }
      ;;
    --support-cases-file=*)
      HAS_SUPPORT_CASES_FILE="true"
      ;;
    --support-case-max-root-seeds=*)
      HAS_SUPPORT_CASE_MAX_ROOT_SEEDS="true"
      ;;
    --support-case-max-effective-root-seeds=*)
      HAS_SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS="true"
      ;;
    --support-case-min-root-overlap=*)
      HAS_SUPPORT_CASE_MIN_ROOT_OVERLAP="true"
      ;;
    --support-case-min-prefix-overlap=*)
      HAS_SUPPORT_CASE_MIN_PREFIX_OVERLAP="true"
      ;;
    --support-case-prefix-depth-limit=*)
      HAS_SUPPORT_CASE_PREFIX_DEPTH_LIMIT="true"
      ;;
    --support-case-min-donor-root-overlap=*)
      HAS_SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP="true"
      ;;
    --support-case-min-donor-prefix-overlap=*)
      HAS_SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP="true"
      ;;
    --support-case-donor-prefix-depth-limit=*)
      HAS_SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT="true"
      ;;
    --support-case-fail-if-root-scope-uncompressed=*)
      HAS_SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED="true"
      ;;
    --max-seed-tokens=*)
      HAS_MAX_SEED_TOKENS="true"
      ;;
  esac
done

if [[ "$HAS_SUPPORT_CASES_FILE" != "true" ]]; then
  echo "[fatal] low-gap-top targeted wrapper requires --support-cases-file=<support_cases.json>" >&2
  exit 4
fi

ARGS=()
if [[ "$HAS_RECENT_ONLY_FAMILY_IDS" != "true" ]]; then
  ARGS+=(--recent-only-family-ids=low_gap_top_continuation)
fi
if [[ "$HAS_SUPPORT_CASE_MAX_ROOT_SEEDS" != "true" ]]; then
  ARGS+=(--support-case-max-root-seeds=128)
fi
if [[ "$HAS_SUPPORT_CASE_MAX_EFFECTIVE_ROOT_SEEDS" != "true" ]]; then
  ARGS+=(--support-case-max-effective-root-seeds=32)
fi
if [[ "$HAS_SUPPORT_CASE_MIN_ROOT_OVERLAP" != "true" ]]; then
  ARGS+=(--support-case-min-root-overlap=1)
fi
if [[ "$HAS_SUPPORT_CASE_MIN_PREFIX_OVERLAP" != "true" ]]; then
  ARGS+=(--support-case-min-prefix-overlap=2)
fi
if [[ "$HAS_SUPPORT_CASE_PREFIX_DEPTH_LIMIT" != "true" ]]; then
  ARGS+=(--support-case-prefix-depth-limit=3)
fi
if [[ "$HAS_SUPPORT_CASE_MIN_DONOR_ROOT_OVERLAP" != "true" ]]; then
  ARGS+=(--support-case-min-donor-root-overlap=1)
fi
if [[ "$HAS_SUPPORT_CASE_MIN_DONOR_PREFIX_OVERLAP" != "true" ]]; then
  ARGS+=(--support-case-min-donor-prefix-overlap=1)
fi
if [[ "$HAS_SUPPORT_CASE_DONOR_PREFIX_DEPTH_LIMIT" != "true" ]]; then
  ARGS+=(--support-case-donor-prefix-depth-limit=3)
fi
if [[ "$HAS_SUPPORT_CASE_FAIL_IF_ROOT_SCOPE_UNCOMPRESSED" != "true" ]]; then
  ARGS+=(--support-case-fail-if-root-scope-uncompressed=true)
fi
if [[ "$HAS_MAX_SEED_TOKENS" != "true" ]]; then
  ARGS+=(--max-seed-tokens=1024)
fi
ARGS+=("$@")

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite_recent_low_only.sh" "${ARGS[@]}"
