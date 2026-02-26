#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE' >&2
run_codex_multi_env_parallel.sh

Launches cloud burst tasks across multiple Codex environments in parallel.
This script is an orchestration wrapper only; heavy compute runs inside Codex Cloud.

Usage:
  bash tools/cloud/run_codex_multi_env_parallel.sh [options]

Options:
  --envs=CSV                  env ids list
                              (default: spicy-moltbook-kr,SuSton1/spicy-moltbook-kr-b,SuSton1/spicy-moltbook-kr-c,SuSton1/spicy-moltbook-kr-d,SuSton1/spicy-moltbook-kr-e,SuSton1/spicy-moltbook-kr-f)
  --mode=dry|apply            burst mode (default: dry)
  --asof=YYYY-MM-DD           rules as-of (default: 2026-02-13)
  --sessions=N                sessions per environment (default: 1)
  --max-attempts=N            max attempts in each burst (default: 30)
  --verify-once=0|1           run verify inside each env burst (default: 0)
  --verify-profile=fast|full  verify profile for each env burst (default: fast)
  --immutable-data=0|1        immutable snapshot mode (default: 1)
  --auto-resource-max=0|1     auto resource maximize inside each env (default: 1)
  --enforce-cloud-resource-floor=0|1 enforce floor inside each env burst (default: 0)
  --min-cloud-cpu=N           floor cpu when enforce enabled (default: 2)
  --min-cloud-mem-mb=N        floor mem MB when enforce enabled (default: 4096)
  --snapshot-id=ID            pinned snapshot id (optional)
  --watch=0|1                 poll task status until terminal (default: 1)
  --poll-sec=N                watch interval seconds (default: 20)
USAGE
}

ENVS_DEFAULT="spicy-moltbook-kr,SuSton1/spicy-moltbook-kr-b,SuSton1/spicy-moltbook-kr-c,SuSton1/spicy-moltbook-kr-d,SuSton1/spicy-moltbook-kr-e,SuSton1/spicy-moltbook-kr-f"
ENVS_CSV="$ENVS_DEFAULT"
MODE="dry"
ASOF="${DEFAULT_RAMP_ASOF_DATE_KEY:-2026-02-13}"
SESSIONS=1
MAX_ATTEMPTS=30
VERIFY_ONCE=0
VERIFY_PROFILE="fast"
IMMUTABLE_DATA=1
AUTO_RESOURCE_MAX=1
ENFORCE_CLOUD_RESOURCE_FLOOR=0
MIN_CLOUD_CPU=2
MIN_CLOUD_MEM_MB=4096
SNAPSHOT_ID=""
WATCH=1
POLL_SEC=20

for arg in "$@"; do
  case "$arg" in
    --envs=*) ENVS_CSV="${arg#--envs=}" ;;
    --mode=*) MODE="${arg#--mode=}" ;;
    --asof=*) ASOF="${arg#--asof=}" ;;
    --sessions=*) SESSIONS="${arg#--sessions=}" ;;
    --max-attempts=*) MAX_ATTEMPTS="${arg#--max-attempts=}" ;;
    --verify-once=*) VERIFY_ONCE="${arg#--verify-once=}" ;;
    --verify-profile=*) VERIFY_PROFILE="${arg#--verify-profile=}" ;;
    --immutable-data=*) IMMUTABLE_DATA="${arg#--immutable-data=}" ;;
    --auto-resource-max=*) AUTO_RESOURCE_MAX="${arg#--auto-resource-max=}" ;;
    --enforce-cloud-resource-floor=*) ENFORCE_CLOUD_RESOURCE_FLOOR="${arg#--enforce-cloud-resource-floor=}" ;;
    --min-cloud-cpu=*) MIN_CLOUD_CPU="${arg#--min-cloud-cpu=}" ;;
    --min-cloud-mem-mb=*) MIN_CLOUD_MEM_MB="${arg#--min-cloud-mem-mb=}" ;;
    --snapshot-id=*) SNAPSHOT_ID="${arg#--snapshot-id=}" ;;
    --watch=*) WATCH="${arg#--watch=}" ;;
    --poll-sec=*) POLL_SEC="${arg#--poll-sec=}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-multi] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry" && "$MODE" != "apply" ]]; then
  echo "[cloud-multi] mode must be dry|apply" >&2
  exit 2
fi
if [[ "$VERIFY_ONCE" != "0" && "$VERIFY_ONCE" != "1" ]]; then
  echo "[cloud-multi] verify-once must be 0|1" >&2
  exit 2
fi
if [[ "$VERIFY_PROFILE" != "fast" && "$VERIFY_PROFILE" != "full" ]]; then
  echo "[cloud-multi] verify-profile must be fast|full" >&2
  exit 2
fi
if [[ "$IMMUTABLE_DATA" != "0" && "$IMMUTABLE_DATA" != "1" ]]; then
  echo "[cloud-multi] immutable-data must be 0|1" >&2
  exit 2
fi
if [[ "$AUTO_RESOURCE_MAX" != "0" && "$AUTO_RESOURCE_MAX" != "1" ]]; then
  echo "[cloud-multi] auto-resource-max must be 0|1" >&2
  exit 2
fi
if [[ "$ENFORCE_CLOUD_RESOURCE_FLOOR" != "0" && "$ENFORCE_CLOUD_RESOURCE_FLOOR" != "1" ]]; then
  echo "[cloud-multi] enforce-cloud-resource-floor must be 0|1" >&2
  exit 2
fi
if ! [[ "$MIN_CLOUD_CPU" =~ ^[0-9]+$ ]] || (( MIN_CLOUD_CPU < 1 || MIN_CLOUD_CPU > 1024 )); then
  echo "[cloud-multi] min-cloud-cpu must be 1..1024" >&2
  exit 2
fi
if ! [[ "$MIN_CLOUD_MEM_MB" =~ ^[0-9]+$ ]] || (( MIN_CLOUD_MEM_MB < 1024 || MIN_CLOUD_MEM_MB > 1048576 )); then
  echo "[cloud-multi] min-cloud-mem-mb must be 1024..1048576" >&2
  exit 2
fi
if [[ "$WATCH" != "0" && "$WATCH" != "1" ]]; then
  echo "[cloud-multi] watch must be 0|1" >&2
  exit 2
fi
if ! [[ "$POLL_SEC" =~ ^[0-9]+$ ]] || (( POLL_SEC < 3 || POLL_SEC > 300 )); then
  echo "[cloud-multi] poll-sec must be 3..300" >&2
  exit 2
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[cloud-multi] codex CLI not found in PATH" >&2
  exit 1
fi

mapfile -t ENVS < <(echo "$ENVS_CSV" | tr ',' '\n' | sed '/^\s*$/d')
if (( ${#ENVS[@]} == 0 )); then
  echo "[cloud-multi] no environments provided" >&2
  exit 1
fi

mkdir -p artifacts/cloud_profiles
TS="$(date +%Y%m%d_%H%M%S)"
TASK_FILE="artifacts/cloud_profiles/multi_env_tasks_${TS}.tsv"
STATUS_FILE="artifacts/cloud_profiles/multi_env_status_${TS}.log"
touch "$TASK_FILE" "$STATUS_FILE"

echo -e "env\ttask_id\ttask_url" > "$TASK_FILE"
echo "[cloud-multi] launch started ts=$TS envCount=${#ENVS[@]}" | tee -a "$STATUS_FILE"

for env in "${ENVS[@]}"; do
  cmd="bash tools/cloud/run_cloud_hyper_burst.sh --sessions=${SESSIONS} --mode=${MODE} --asof=${ASOF} --max-attempts=${MAX_ATTEMPTS} --verify-once=${VERIFY_ONCE} --verify-profile=${VERIFY_PROFILE} --immutable-data=${IMMUTABLE_DATA} --auto-resource-max=${AUTO_RESOURCE_MAX} --enforce-cloud-resource-floor=${ENFORCE_CLOUD_RESOURCE_FLOOR} --min-cloud-cpu=${MIN_CLOUD_CPU} --min-cloud-mem-mb=${MIN_CLOUD_MEM_MB} --restore-after=1 --apply-profile=1"
  if [[ -n "$SNAPSHOT_ID" ]]; then
    cmd+=" --snapshot-id=${SNAPSHOT_ID}"
  fi
  task_url="$(codex cloud exec --env "$env" "$cmd" | tail -n 1)"
  task_id="${task_url##*/}"
  echo -e "${env}\t${task_id}\t${task_url}" >> "$TASK_FILE"
  echo "[cloud-multi] launched env=${env} task=${task_id}" | tee -a "$STATUS_FILE"
done

echo "[cloud-multi] tasks file: $TASK_FILE" | tee -a "$STATUS_FILE"

if [[ "$WATCH" == "0" ]]; then
  exit 0
fi

all_done=0
while (( all_done == 0 )); do
  all_done=1
  while IFS=$'\t' read -r env task_id task_url; do
    [[ "$env" == "env" ]] && continue
    out="$(codex cloud status "$task_id" 2>&1 || true)"
    first_line="$(echo "$out" | head -n 1)"
    echo "[cloud-multi][${env}] ${first_line}" | tee -a "$STATUS_FILE"
    if ! echo "$first_line" | grep -Eq '\[(READY|COMPLETED|ERROR|FAILED)\]'; then
      all_done=0
    fi
  done < "$TASK_FILE"
  if (( all_done == 0 )); then
    sleep "$POLL_SEC"
  fi
done

echo "[cloud-multi] all tasks reached terminal state" | tee -a "$STATUS_FILE"
echo "[cloud-multi] status log: $STATUS_FILE" | tee -a "$STATUS_FILE"
