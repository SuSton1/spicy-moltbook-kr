#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE' >&2
run_cloud_hyper_continuous.sh

Continuously executes cloud hyper burst sessions with immutable snapshot lock.
This is intended for Codex Cloud containers or remote servers.

Usage:
  bash tools/cloud/run_cloud_hyper_continuous.sh [options]

Options:
  --mode=dry|apply          auto-upgrade mode (default: dry)
  --asof=YYYY-MM-DD         rules as-of date (default: 2026-02-13)
  --max-attempts=N          max attempts per burst session (default: 30)
  --verify-once=1|0         run verify once before first cycle (default: 1)
  --verify-profile=fast|full verify profile used by burst runner (default: fast)
  --sleep-sec=N             sleep between successful cycles (default: 60)
  --max-cycles=N            stop after N cycles; 0 means infinite (default: 0)
  --snapshot-id=ID          pinned snapshot id (required for immutable-data=1 if state missing)
  --immutable-data=1|0      freeze data state across cycles (default: 1)
  --auto-resource-max=1|0   auto-maximize cloud tuning from CPU/RAM each cycle (default: 1)
  --restore-after-stop=1|0  restore tuning backup when loop exits (default: 1)
USAGE
}

if [[ "$ROOT_DIR" == /home/saida/* && "${STOCKDESK_ALLOW_LOCAL_HEAVY:-0}" != "1" ]]; then
  echo "[cloud-continuous] Refusing local heavy run. Use server/Codex Cloud container." >&2
  exit 1
fi

MODE="dry"
ASOF="${DEFAULT_RAMP_ASOF_DATE_KEY:-2026-02-13}"
MAX_ATTEMPTS=30
VERIFY_ONCE=1
VERIFY_PROFILE="fast"
SLEEP_SEC=60
MAX_CYCLES=0
SNAPSHOT_ID="${CLOUD_SNAPSHOT_ID:-}"
IMMUTABLE_DATA="${CLOUD_IMMUTABLE_DATA:-1}"
AUTO_RESOURCE_MAX="${CLOUD_AUTO_RESOURCE_MAX:-1}"
RESTORE_AFTER_STOP=1
MAX_BACKOFF_SEC=600

for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#--mode=}" ;;
    --asof=*) ASOF="${arg#--asof=}" ;;
    --max-attempts=*) MAX_ATTEMPTS="${arg#--max-attempts=}" ;;
    --verify-once=*) VERIFY_ONCE="${arg#--verify-once=}" ;;
    --verify-profile=*) VERIFY_PROFILE="${arg#--verify-profile=}" ;;
    --sleep-sec=*) SLEEP_SEC="${arg#--sleep-sec=}" ;;
    --max-cycles=*) MAX_CYCLES="${arg#--max-cycles=}" ;;
    --snapshot-id=*) SNAPSHOT_ID="${arg#--snapshot-id=}" ;;
    --immutable-data=*) IMMUTABLE_DATA="${arg#--immutable-data=}" ;;
    --auto-resource-max=*) AUTO_RESOURCE_MAX="${arg#--auto-resource-max=}" ;;
    --restore-after-stop=*) RESTORE_AFTER_STOP="${arg#--restore-after-stop=}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-continuous] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry" && "$MODE" != "apply" ]]; then
  echo "[cloud-continuous] mode must be dry|apply" >&2
  exit 2
fi
if ! [[ "$MAX_ATTEMPTS" =~ ^[0-9]+$ ]] || (( MAX_ATTEMPTS < 1 || MAX_ATTEMPTS > 1000 )); then
  echo "[cloud-continuous] max-attempts must be 1..1000" >&2
  exit 2
fi
if ! [[ "$SLEEP_SEC" =~ ^[0-9]+$ ]] || (( SLEEP_SEC < 1 || SLEEP_SEC > 3600 )); then
  echo "[cloud-continuous] sleep-sec must be 1..3600" >&2
  exit 2
fi
if ! [[ "$MAX_CYCLES" =~ ^[0-9]+$ ]]; then
  echo "[cloud-continuous] max-cycles must be >=0" >&2
  exit 2
fi
if [[ "$VERIFY_ONCE" != "0" && "$VERIFY_ONCE" != "1" ]]; then
  echo "[cloud-continuous] verify-once must be 0|1" >&2
  exit 2
fi
if [[ "$VERIFY_PROFILE" != "fast" && "$VERIFY_PROFILE" != "full" ]]; then
  echo "[cloud-continuous] verify-profile must be fast|full" >&2
  exit 2
fi
if [[ "$IMMUTABLE_DATA" != "0" && "$IMMUTABLE_DATA" != "1" ]]; then
  echo "[cloud-continuous] immutable-data must be 0|1" >&2
  exit 2
fi
if [[ "$AUTO_RESOURCE_MAX" != "0" && "$AUTO_RESOURCE_MAX" != "1" ]]; then
  echo "[cloud-continuous] auto-resource-max must be 0|1" >&2
  exit 2
fi
if [[ "$RESTORE_AFTER_STOP" != "0" && "$RESTORE_AFTER_STOP" != "1" ]]; then
  echo "[cloud-continuous] restore-after-stop must be 0|1" >&2
  exit 2
fi

export NO_KIS=1
export BACKFILL_DISABLE_KIS=1
export BACKFILL_NO_KIS=1
export BACKFILL_KIS_ENABLED=0
export CLOUD_EXECUTION_MODE="codex_cloud"

state_dir="artifacts/cloud_profiles"
mkdir -p "$state_dir"
lock_file="$state_dir/cloud_hyper_continuous.lock"
state_file="$state_dir/cloud_hyper_continuous_state.json"
ts="$(date +%Y%m%d_%H%M%S)"
log_file="$state_dir/cloud_hyper_continuous_${ts}.log"

if [[ -f "$lock_file" ]]; then
  lock_pid="$(awk 'NR==1 {print $1}' "$lock_file" 2>/dev/null || true)"
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "[cloud-continuous] another continuous loop is active (pid=$lock_pid)" >&2
    exit 1
  fi
fi

echo "$$ $(date -Is)" > "$lock_file"

cleanup() {
  rm -f "$lock_file" || true
  if [[ "$RESTORE_AFTER_STOP" == "1" ]]; then
    echo "[cloud-continuous] restoring tuning profile backup" | tee -a "$log_file"
    node tools/cloud/apply_cloud_hyper_profile.mjs --mode=restore >>"$log_file" 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

cycle=0
fail_streak=0
apply_profile=1

while :; do
  cycle=$((cycle + 1))
  if (( MAX_CYCLES > 0 && cycle > MAX_CYCLES )); then
    echo "[cloud-continuous] reached max-cycles=$MAX_CYCLES" | tee -a "$log_file"
    break
  fi

  verify_flag=0
  if (( cycle == 1 )) && [[ "$VERIFY_ONCE" == "1" ]]; then
    verify_flag=1
  fi

  echo "[cloud-continuous] cycle=$cycle begin mode=$MODE asof=$ASOF maxAttempts=$MAX_ATTEMPTS immutable=$IMMUTABLE_DATA autoResource=$AUTO_RESOURCE_MAX" | tee -a "$log_file"
  cmd=(
    bash tools/cloud/run_cloud_hyper_burst.sh
    --sessions=1
    --mode="$MODE"
    --asof="$ASOF"
    --max-attempts="$MAX_ATTEMPTS"
    --verify-once="$verify_flag"
    --verify-profile="$VERIFY_PROFILE"
    --restore-after=0
    --apply-profile="$apply_profile"
    --immutable-data="$IMMUTABLE_DATA"
    --auto-resource-max="$AUTO_RESOURCE_MAX"
  )
  if [[ -n "$SNAPSHOT_ID" ]]; then
    cmd+=("--snapshot-id=$SNAPSHOT_ID")
  fi

  set +e
  "${cmd[@]}" >>"$log_file" 2>&1
  exit_code=$?
  set -e

  now_iso="$(date -Is)"
  cat > "$state_file" <<STATE
{
  "updatedAt": "$now_iso",
  "cycle": $cycle,
  "lastExitCode": $exit_code,
  "mode": "$MODE",
  "asOf": "$ASOF",
  "maxAttempts": $MAX_ATTEMPTS,
  "immutableData": $IMMUTABLE_DATA,
  "snapshotId": "${SNAPSHOT_ID}",
  "failStreak": $fail_streak,
  "logFile": "$log_file"
}
STATE

  if (( exit_code == 0 )); then
    fail_streak=0
    apply_profile=0
    echo "[cloud-continuous] cycle=$cycle success" | tee -a "$log_file"
    sleep "$SLEEP_SEC"
    continue
  fi

  fail_streak=$((fail_streak + 1))
  backoff=$(( SLEEP_SEC * (2 ** (fail_streak - 1)) ))
  if (( backoff > MAX_BACKOFF_SEC )); then
    backoff=$MAX_BACKOFF_SEC
  fi
  echo "[cloud-continuous] cycle=$cycle failed exit=$exit_code failStreak=$fail_streak backoff=${backoff}s" | tee -a "$log_file"
  sleep "$backoff"
done

echo "[cloud-continuous] stopped log=$log_file state=$state_file"
