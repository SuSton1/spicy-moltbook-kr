#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'USAGE'
Usage: bash tools/launch_technique_positive_first_discovery_detached.sh --run-id=<run_id> [forwarded discovery args...]
Server-only detached launcher for technique positive-first discovery.
USAGE
}

[[ $# -gt 0 ]] || { usage; exit 1; }

cd "$ROOT_DIR"
ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "Run this launcher on the server repo root: expected=$EXPECTED_REAL actual=$ROOT_REAL"
fi

RUN_ID=""
FORWARDED_ARGS=()
for arg in "$@"; do
  FORWARDED_ARGS+=("$arg")
  case "$arg" in
    --run-id=*) RUN_ID="${arg#*=}" ;;
  esac
done

[[ -n "$RUN_ID" ]] || fatal "--run-id is required"

RUN_PARENT="$ROOT_DIR/artifacts/runs/$RUN_ID"
STEP_DIR="$RUN_PARENT/step-perfect-prototype-technique-pattern-discovery"
LAUNCH_LOG="$RUN_PARENT/server_technique_positive_first_discovery.log"
LAUNCH_PID="$RUN_PARENT/server_technique_positive_first_discovery.pid"
LAUNCH_STATUS="$RUN_PARENT/server_technique_positive_first_discovery_launch.json"
RUN_STATUS="$STEP_DIR/run_status.json"
PHASE_STATUS="$STEP_DIR/phase_status.json"

mkdir -p "$RUN_PARENT"
if [[ -f "$LAUNCH_PID" ]]; then
  existing_pid="$(cat "$LAUNCH_PID" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    fatal "detached discovery already running for run_id=$RUN_ID pid=$existing_pid"
  fi
fi

printf -v run_cmd '%q ' bash tools/run_technique_positive_first_discovery.sh "${FORWARDED_ARGS[@]}"
nohup bash -lc "cd $(printf '%q' "$ROOT_DIR") && ${run_cmd}" >"$LAUNCH_LOG" 2>&1 < /dev/null &
child_pid=$!
echo "$child_pid" > "$LAUNCH_PID"

if ! kill -0 "$child_pid" 2>/dev/null; then
  tail -n 80 "$LAUNCH_LOG" >&2 || true
  fatal "detached discovery failed to stay alive after launch"
fi

node --input-type=module - "$LAUNCH_STATUS" "$RUN_ID" "$child_pid" "$LAUNCH_LOG" "$LAUNCH_PID" "$RUN_STATUS" "$PHASE_STATUS" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"
const [launchStatusPath, runId, pidRaw, logPath, pidPath, runStatusPath, phaseStatusPath] = process.argv.slice(2)
await writeJson(launchStatusPath, {
  kind: "technique_positive_first_detached_launch_v1",
  generatedAt: new Date().toISOString(),
  runId,
  pid: Number.parseInt(pidRaw, 10),
  logPath,
  pidPath,
  runStatusPath,
  phaseStatusPath,
  state: "launched",
})
NODE

cat "$LAUNCH_STATUS"
