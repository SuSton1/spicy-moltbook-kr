#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite_recent_mid_low.json"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_LINE_ID="stepb_dplus1_plus_lite_recent_mid_low"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_CONTEXT_SURFACE="v6_contextual_plus_lite_recent_only_lane_local_pool8"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_RUN_ID_PREFIX="perfect_proto_stepb_plus_lite_recent_mid_low_curated_live_after_close"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_DISCOVERY_KIND="recent_impulse"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_DISCOVERY_UNIVERSE_ID="recent_impulse_upto_1d"
export STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_RECENT_IMPULSE_LOOKBACK_DAYS="1"

for arg in "$@"; do
  case "$arg" in
    --discovery-universe-id=*)
      [[ "${arg#*=}" == "recent_impulse_upto_1d" ]] || {
        echo "[fatal] recent MID/LOW after-close wrapper requires --discovery-universe-id=recent_impulse_upto_1d" >&2
        exit 4
      }
      ;;
    --recent-impulse-lookback-days=*)
      [[ "${arg#*=}" == "1" ]] || {
        echo "[fatal] recent MID/LOW after-close wrapper requires --recent-impulse-lookback-days=1" >&2
        exit 4
      }
      ;;
  esac
done

exec bash "$ROOT_DIR/tools/server_stepb_plus_lite_curated_after_close.sh" \
  --discovery-universe-id=recent_impulse_upto_1d \
  --recent-impulse-lookback-days=1 \
  "$@"
