#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export STEPB_PLUS_LITE_WRAPPER_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_lane_local.json"
export STEPB_PLUS_LITE_WRAPPER_LINE_ID="stepb_dplus1_plus_lite_lane_local"
export STEPB_PLUS_LITE_WRAPPER_CONTEXT_SURFACE="v5_contextual_plus_lite_lane_local_pool8"
export STEPB_PLUS_LITE_WRAPPER_RUN_ID_PREFIX="perfect_proto_stepb_dplus1_plus_lite_lane_local"

for arg in "$@"; do
  case "$arg" in
    --discovery-universe-id=*)
      [[ "${arg#*=}" == "same_day_plus_recent_upto_1d" ]] || {
        echo "[fatal] lane-local shadow wrapper requires --discovery-universe-id=same_day_plus_recent_upto_1d" >&2
        exit 4
      }
      ;;
    --recent-impulse-lookback-days=*)
      [[ "${arg#*=}" == "1" ]] || {
        echo "[fatal] lane-local shadow wrapper requires --recent-impulse-lookback-days=1" >&2
        exit 4
      }
      ;;
    --enable-family-scoped-mining=*)
      [[ "${arg#*=}" == "true" ]] || {
        echo "[fatal] lane-local shadow wrapper requires --enable-family-scoped-mining=true" >&2
        exit 4
      }
      ;;
  esac
done

exec bash "$ROOT_DIR/tools/server_run_stepb_dplus1_plus_lite.sh" \
  --discovery-universe-id=same_day_plus_recent_upto_1d \
  --recent-impulse-lookback-days=1 \
  --enable-family-scoped-mining=true \
  "$@"
