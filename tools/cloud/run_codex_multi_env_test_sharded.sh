#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE' >&2
run_codex_multi_env_test_sharded.sh

Runs Vitest shards across multiple Codex cloud environments in parallel.
Heavy execution happens inside cloud envs only.

Usage:
  bash tools/cloud/run_codex_multi_env_test_sharded.sh [options]

Options:
  --envs=CSV                  env ids list
                              (default: spicy-moltbook-kr,SuSton1/spicy-moltbook-kr-b,SuSton1/spicy-moltbook-kr-c,SuSton1/spicy-moltbook-kr-d,SuSton1/spicy-moltbook-kr-e,SuSton1/spicy-moltbook-kr-f)
  --watch=0|1                 poll task status until terminal (default: 1)
  --poll-sec=N                polling interval seconds (default: 20)
USAGE
}

ENVS_DEFAULT="spicy-moltbook-kr,SuSton1/spicy-moltbook-kr-b,SuSton1/spicy-moltbook-kr-c,SuSton1/spicy-moltbook-kr-d,SuSton1/spicy-moltbook-kr-e,SuSton1/spicy-moltbook-kr-f"
ENVS_CSV="$ENVS_DEFAULT"
WATCH=1
POLL_SEC=20

for arg in "$@"; do
  case "$arg" in
    --envs=*) ENVS_CSV="${arg#--envs=}" ;;
    --watch=*) WATCH="${arg#--watch=}" ;;
    --poll-sec=*) POLL_SEC="${arg#--poll-sec=}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-test-sharded] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$WATCH" != "0" && "$WATCH" != "1" ]]; then
  echo "[cloud-test-sharded] watch must be 0|1" >&2
  exit 2
fi
if ! [[ "$POLL_SEC" =~ ^[0-9]+$ ]] || (( POLL_SEC < 3 || POLL_SEC > 300 )); then
  echo "[cloud-test-sharded] poll-sec must be 3..300" >&2
  exit 2
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "[cloud-test-sharded] codex CLI not found" >&2
  exit 1
fi

mapfile -t ENVS < <(echo "$ENVS_CSV" | tr ',' '\n' | sed '/^\s*$/d')
if (( ${#ENVS[@]} == 0 )); then
  echo "[cloud-test-sharded] no environments provided" >&2
  exit 1
fi

mkdir -p artifacts/cloud_profiles
TS="$(date +%Y%m%d_%H%M%S)"
TASK_FILE="artifacts/cloud_profiles/multi_env_test_shards_${TS}.tsv"
STATUS_FILE="artifacts/cloud_profiles/multi_env_test_shards_${TS}.log"
touch "$TASK_FILE" "$STATUS_FILE"
echo -e "env\tshard\ttask_id\ttask_url" > "$TASK_FILE"

TOTAL="${#ENVS[@]}"
echo "[cloud-test-sharded] start envCount=${TOTAL}" | tee -a "$STATUS_FILE"

for i in "${!ENVS[@]}"; do
  idx=$((i + 1))
  env="${ENVS[$i]}"
  shard="${idx}/${TOTAL}"
  cmd="npm run test -- --shard=${shard}"
  task_url="$(codex cloud exec --env "$env" "$cmd" | tail -n 1)"
  task_id="${task_url##*/}"
  echo -e "${env}\t${shard}\t${task_id}\t${task_url}" >> "$TASK_FILE"
  echo "[cloud-test-sharded] launched env=${env} shard=${shard} task=${task_id}" | tee -a "$STATUS_FILE"
done

echo "[cloud-test-sharded] tasks file: $TASK_FILE" | tee -a "$STATUS_FILE"

if [[ "$WATCH" == "0" ]]; then
  exit 0
fi

all_done=0
while (( all_done == 0 )); do
  all_done=1
  while IFS=$'\t' read -r env shard task_id task_url; do
    [[ "$env" == "env" ]] && continue
    out="$(codex cloud status "$task_id" 2>&1 || true)"
    first_line="$(echo "$out" | head -n 1)"
    echo "[cloud-test-sharded][${env}][${shard}] ${first_line}" | tee -a "$STATUS_FILE"
    if ! echo "$first_line" | grep -Eq '\[(READY|COMPLETED|ERROR|FAILED)\]'; then
      all_done=0
    fi
  done < "$TASK_FILE"
  if (( all_done == 0 )); then
    sleep "$POLL_SEC"
  fi
done

echo "[cloud-test-sharded] all shards reached terminal state" | tee -a "$STATUS_FILE"
