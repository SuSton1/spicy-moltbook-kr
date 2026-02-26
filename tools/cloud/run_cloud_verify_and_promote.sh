#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'USAGE' >&2
run_cloud_verify_and_promote.sh

Cloud-first validation + server-side smoke gate.

Flow:
1) run cloud hyper burst with verify-once
2) persist promotion marker artifact
3) run lightweight server smoke checks

Usage:
  bash tools/cloud/run_cloud_verify_and_promote.sh [options]

Options:
  --asof=YYYY-MM-DD            rules asOfInput (default: 2026-02-13)
  --mode=dry|apply             cloud burst mode (default: dry)
  --sessions=N                 cloud burst sessions (default: 1)
  --max-attempts=N             max attempts per burst session (default: 30)
  --cloud-verify-profile=fast|full verify profile for cloud phase (default: fast)
  --snapshot-id=ID             immutable snapshot id (optional)
  --immutable-data=1|0         keep immutable data mode (default: 1)
  --auto-resource-max=1|0      auto maximize by detected CPU/RAM (default: 1)
  --server-smoke=policy|none   post-cloud smoke type (default: policy)
  --enforce-cloud-resource-floor=1|0 fail when host resource is below cloud floor (default: 1)
  --min-cloud-cpu=N            minimum CPU cores for cloud run (default: 8)
  --min-cloud-mem-mb=N         minimum memory MB for cloud run (default: 16384)
USAGE
}

if [[ "$ROOT_DIR" == /home/saida/* && "${STOCKDESK_ALLOW_LOCAL_HEAVY:-0}" != "1" ]]; then
  echo "[cloud-promote] Refusing local heavy run. Use server/Codex Cloud container." >&2
  exit 1
fi

ASOF="${DEFAULT_RAMP_ASOF_DATE_KEY:-2026-02-13}"
MODE="dry"
SESSIONS=1
MAX_ATTEMPTS=30
VERIFY_PROFILE="fast"
SNAPSHOT_ID="${CLOUD_SNAPSHOT_ID:-}"
IMMUTABLE_DATA="${CLOUD_IMMUTABLE_DATA:-1}"
AUTO_RESOURCE_MAX="${CLOUD_AUTO_RESOURCE_MAX:-1}"
SERVER_SMOKE="policy"
ENFORCE_CLOUD_RESOURCE_FLOOR="${CLOUD_ENFORCE_RESOURCE_FLOOR:-1}"
MIN_CLOUD_CPU="${CLOUD_MIN_CPU:-8}"
MIN_CLOUD_MEM_MB="${CLOUD_MIN_MEM_MB:-16384}"

for arg in "$@"; do
  case "$arg" in
    --asof=*) ASOF="${arg#--asof=}" ;;
    --mode=*) MODE="${arg#--mode=}" ;;
    --sessions=*) SESSIONS="${arg#--sessions=}" ;;
    --max-attempts=*) MAX_ATTEMPTS="${arg#--max-attempts=}" ;;
    --cloud-verify-profile=*) VERIFY_PROFILE="${arg#--cloud-verify-profile=}" ;;
    --snapshot-id=*) SNAPSHOT_ID="${arg#--snapshot-id=}" ;;
    --immutable-data=*) IMMUTABLE_DATA="${arg#--immutable-data=}" ;;
    --auto-resource-max=*) AUTO_RESOURCE_MAX="${arg#--auto-resource-max=}" ;;
    --server-smoke=*) SERVER_SMOKE="${arg#--server-smoke=}" ;;
    --enforce-cloud-resource-floor=*)
      ENFORCE_CLOUD_RESOURCE_FLOOR="${arg#--enforce-cloud-resource-floor=}"
      ;;
    --min-cloud-cpu=*) MIN_CLOUD_CPU="${arg#--min-cloud-cpu=}" ;;
    --min-cloud-mem-mb=*) MIN_CLOUD_MEM_MB="${arg#--min-cloud-mem-mb=}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-promote] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry" && "$MODE" != "apply" ]]; then
  echo "[cloud-promote] mode must be dry|apply" >&2
  exit 2
fi
if [[ "$VERIFY_PROFILE" != "fast" && "$VERIFY_PROFILE" != "full" ]]; then
  echo "[cloud-promote] cloud-verify-profile must be fast|full" >&2
  exit 2
fi
if [[ "$IMMUTABLE_DATA" != "0" && "$IMMUTABLE_DATA" != "1" ]]; then
  echo "[cloud-promote] immutable-data must be 0|1" >&2
  exit 2
fi
if [[ "$AUTO_RESOURCE_MAX" != "0" && "$AUTO_RESOURCE_MAX" != "1" ]]; then
  echo "[cloud-promote] auto-resource-max must be 0|1" >&2
  exit 2
fi
if [[ "$SERVER_SMOKE" != "policy" && "$SERVER_SMOKE" != "none" ]]; then
  echo "[cloud-promote] server-smoke must be policy|none" >&2
  exit 2
fi
if [[ "$ENFORCE_CLOUD_RESOURCE_FLOOR" != "0" && "$ENFORCE_CLOUD_RESOURCE_FLOOR" != "1" ]]; then
  echo "[cloud-promote] enforce-cloud-resource-floor must be 0|1" >&2
  exit 2
fi
if ! [[ "$MIN_CLOUD_CPU" =~ ^[0-9]+$ ]] || (( MIN_CLOUD_CPU < 1 || MIN_CLOUD_CPU > 1024 )); then
  echo "[cloud-promote] min-cloud-cpu must be 1..1024" >&2
  exit 2
fi
if ! [[ "$MIN_CLOUD_MEM_MB" =~ ^[0-9]+$ ]] || (( MIN_CLOUD_MEM_MB < 1024 || MIN_CLOUD_MEM_MB > 1048576 )); then
  echo "[cloud-promote] min-cloud-mem-mb must be 1024..1048576" >&2
  exit 2
fi

export NO_KIS=1
export BACKFILL_DISABLE_KIS=1
export BACKFILL_NO_KIS=1
export BACKFILL_KIS_ENABLED=0
export CLOUD_EXECUTION_MODE="codex_cloud"

echo "[cloud-promote] phase=cloud-verify-and-burst mode=$MODE asof=$ASOF sessions=$SESSIONS maxAttempts=$MAX_ATTEMPTS immutable=$IMMUTABLE_DATA autoResource=$AUTO_RESOURCE_MAX"
cmd=(
  bash tools/cloud/run_cloud_hyper_burst.sh
  --sessions="$SESSIONS"
  --mode="$MODE"
  --asof="$ASOF"
  --max-attempts="$MAX_ATTEMPTS"
  --verify-once=1
  --verify-profile="$VERIFY_PROFILE"
  --restore-after=1
  --apply-profile=1
  --immutable-data="$IMMUTABLE_DATA"
  --auto-resource-max="$AUTO_RESOURCE_MAX"
  --enforce-cloud-resource-floor="$ENFORCE_CLOUD_RESOURCE_FLOOR"
  --min-cloud-cpu="$MIN_CLOUD_CPU"
  --min-cloud-mem-mb="$MIN_CLOUD_MEM_MB"
)
if [[ -n "$SNAPSHOT_ID" ]]; then
  cmd+=("--snapshot-id=$SNAPSHOT_ID")
fi
"${cmd[@]}"

mkdir -p artifacts/cloud_profiles
git_hash="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > artifacts/cloud_profiles/last_cloud_promotion.json <<EOF
{
  "promotedAt": "$(date -Is)",
  "gitHash": "${git_hash}",
  "mode": "${MODE}",
  "asOf": "${ASOF}",
  "sessions": ${SESSIONS},
  "maxAttempts": ${MAX_ATTEMPTS},
  "immutableData": ${IMMUTABLE_DATA},
  "autoResourceMax": ${AUTO_RESOURCE_MAX},
  "snapshotId": "${SNAPSHOT_ID}"
}
EOF
echo "[cloud-promote] phase=promotion-marker saved=artifacts/cloud_profiles/last_cloud_promotion.json"

if [[ "$SERVER_SMOKE" == "policy" ]]; then
  echo "[cloud-promote] phase=server-smoke type=policy"
  npm run check:agent-sync
  npm run check:policy-sync
  npm run check:spec-coverage
  npm run generate:req-evidence
  npm run check:req-evidence
else
  echo "[cloud-promote] phase=server-smoke skipped"
fi

echo "[cloud-promote] done"
