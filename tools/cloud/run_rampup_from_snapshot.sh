#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF' >&2
run_rampup_from_snapshot.sh

Runs verify + cloud hyper burst from a prepared snapshot environment.
Intended for Codex Cloud container after setup_from_snapshot.sh.

Usage:
  bash tools/cloud/run_rampup_from_snapshot.sh [options]

Options:
  --asof=YYYY-MM-DD     target as-of date (default: env DEFAULT_RAMP_ASOF_DATE_KEY or 2026-02-13)
  --mode=dry|apply      loop mode (default: dry)
  --sessions=N          number of burst sessions (default: 1)
  --max-attempts=N      max attempts per session (default: 30)
  --skip-verify         skip npm run verify
EOF
}

ASOF="${DEFAULT_RAMP_ASOF_DATE_KEY:-2026-02-13}"
MODE="dry"
SESSIONS=1
MAX_ATTEMPTS=30
SKIP_VERIFY=0

for arg in "$@"; do
  case "$arg" in
    --asof=*)
      ASOF="${arg#--asof=}"
      ;;
    --mode=*)
      MODE="${arg#--mode=}"
      ;;
    --sessions=*)
      SESSIONS="${arg#--sessions=}"
      ;;
    --max-attempts=*)
      MAX_ATTEMPTS="${arg#--max-attempts=}"
      ;;
    --skip-verify)
      SKIP_VERIFY=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-rampup] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry" && "$MODE" != "apply" ]]; then
  echo "[cloud-rampup] invalid mode: $MODE (dry|apply)" >&2
  exit 2
fi

export NO_KIS=1
export BACKFILL_DISABLE_KIS=1
export BACKFILL_NO_KIS=1
export BACKFILL_KIS_ENABLED=0
export CLOUD_EXECUTION_MODE=codex_cloud

if [[ "$SKIP_VERIFY" -ne 1 ]]; then
  echo "[cloud-rampup] npm run verify"
  npm run verify
fi

echo "[cloud-rampup] run cloud hyper burst sessions=$SESSIONS mode=$MODE asof=$ASOF maxAttempts=$MAX_ATTEMPTS"
bash tools/cloud/run_cloud_hyper_burst.sh \
  --sessions="$SESSIONS" \
  --mode="$MODE" \
  --asof="$ASOF" \
  --max-attempts="$MAX_ATTEMPTS" \
  --verify-once=0 \
  --restore-after=1

echo "[cloud-rampup] done"
