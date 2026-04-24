#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=${1:-/home/moltook/apps/stockdesk-lab-lite}
cd "$ROOT_DIR"

mkdir -p artifacts/autopilot/logs artifacts/autopilot/pids

if pgrep -af '^/home/moltook/apps/stockdesk-lab-lite/tools/stepd_locked_loop.sh|^bash /home/moltook/apps/stockdesk-lab-lite/tools/stepd_locked_loop.sh' >/dev/null; then
  echo "stepd_locked_loop already running"
  pgrep -af '^/home/moltook/apps/stockdesk-lab-lite/tools/stepd_locked_loop.sh|^bash /home/moltook/apps/stockdesk-lab-lite/tools/stepd_locked_loop.sh' || true
  exit 0
fi

TS=$(date +%Y%m%d_%H%M%S)
LOG="artifacts/autopilot/logs/stepd_locked_loop_${TS}.log"
PIDFILE="artifacts/autopilot/pids/stepd_locked_loop.pid"

nohup env \
  STEPD_TOPK="${STEPD_TOPK:-40}" \
  STEPD_COARSE_TOPN="${STEPD_COARSE_TOPN:-160}" \
  STEPD_COARSE_TOPCLUSTERS="${STEPD_COARSE_TOPCLUSTERS:-10}" \
  STEPD_WORKERS="${STEPD_WORKERS:-2}" \
  STEPD_CHUNK="${STEPD_CHUNK:-384}" \
  STEPD_REUSE_RUNTIME_CACHE="${STEPD_REUSE_RUNTIME_CACHE:-true}" \
  STEPD_LEARNING_RATE="${STEPD_LEARNING_RATE:-}" \
  STEPD_REINFORCE_BETA="${STEPD_REINFORCE_BETA:-}" \
  STEPD_WEIGHT_FLOOR="${STEPD_WEIGHT_FLOOR:-}" \
  STEPD_MIN_FINAL_SCORE="${STEPD_MIN_FINAL_SCORE:-}" \
  STEPD_TARGET_PICKED="${STEPD_TARGET_PICKED:-}" \
  STEPD_MIN_EXPECTED_NET_RET3D="${STEPD_MIN_EXPECTED_NET_RET3D:-}" \
  STEPD_GENERALIZATION_ENABLED="${STEPD_GENERALIZATION_ENABLED:-true}" \
  STEPD_GENERALIZATION_MODE="${STEPD_GENERALIZATION_MODE:-chronological}" \
  STEPD_UPDATE_RATIO="${STEPD_UPDATE_RATIO:-0.7}" \
  STEPD_EVAL_MIN_DAYS="${STEPD_EVAL_MIN_DAYS:-20}" \
  STEPD_USE_EVAL_FOR_PROMOTION="${STEPD_USE_EVAL_FOR_PROMOTION:-true}" \
  STEPD_PAIRWISE_ENABLED="${STEPD_PAIRWISE_ENABLED:-true}" \
  STEPD_PAIRWISE_POSITIVE_TOPN="${STEPD_PAIRWISE_POSITIVE_TOPN:-3}" \
  STEPD_PAIRWISE_NEGATIVE_TOPN="${STEPD_PAIRWISE_NEGATIVE_TOPN:-5}" \
  STEPD_PAIRWISE_WEIGHT="${STEPD_PAIRWISE_WEIGHT:-1.0}" \
  STEPD_HARD_NEGATIVE_WEIGHT="${STEPD_HARD_NEGATIVE_WEIGHT:-1.5}" \
  STEPD_ADAPTIVE_MINFINAL_ENABLED="${STEPD_ADAPTIVE_MINFINAL_ENABLED:-true}" \
  STEPD_TARGET_MIN_PICKED="${STEPD_TARGET_MIN_PICKED:-60}" \
  STEPD_TARGET_MAX_PICKED="${STEPD_TARGET_MAX_PICKED:-80}" \
  STEPD_ADAPTIVE_STEP="${STEPD_ADAPTIVE_STEP:-0.003}" \
  STEPD_ADAPTIVE_HYSTERESIS="${STEPD_ADAPTIVE_HYSTERESIS:-2}" \
  STEPD_ADAPTIVE_WARMUP_DAYS="${STEPD_ADAPTIVE_WARMUP_DAYS:-8}" \
  STEPD_MAX_PICKED_PROMOTION="${STEPD_MAX_PICKED_PROMOTION:-80}" \
  STEPD_MAX_TWOPICK_PROMOTION="${STEPD_MAX_TWOPICK_PROMOTION:-0}" \
  STEPD_PRUNE_HEAVY="${STEPD_PRUNE_HEAVY:-true}" \
  STEPD_CLEANUP_RUN="${STEPD_CLEANUP_RUN:-true}" \
  STEPD_LOOP_SLEEP_SEC="${STEPD_LOOP_SLEEP_SEC:-2}" \
  PROMOTE_MIN_PICKED="${PROMOTE_MIN_PICKED:-60}" \
  PROMOTE_MAX_TWO_PICK_DAYS="${PROMOTE_MAX_TWO_PICK_DAYS:-0}" \
  PROMOTE_MIN_HIT_DELTA="${PROMOTE_MIN_HIT_DELTA:-0}" \
  PROMOTE_MIN_LCB_DELTA="${PROMOTE_MIN_LCB_DELTA:-0}" \
  PROMOTE_MAX_SCORE_MS="${PROMOTE_MAX_SCORE_MS:-120000}" \
  KEEP_RUN_DIRS="${KEEP_RUN_DIRS:-40}" \
  BASELINE_LINK="${BASELINE_LINK:-artifacts/autopilot/baselines/current_locked}" \
  /home/moltook/apps/stockdesk-lab-lite/tools/stepd_locked_loop.sh "$ROOT_DIR" \
  > "$LOG" 2>&1 &

PID=$!
echo "$PID" > "$PIDFILE"

echo "started PID=$PID"
echo "log=$LOG"
echo "pidfile=$PIDFILE"
