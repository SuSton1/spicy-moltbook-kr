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
Usage: bash tools/read_technique_episode_matched_control_purity_slice_status.sh --run-id=<run_id> [--tail-lines=N]
Server-only reader for detached technique episode matched-control purity slice status.
USAGE
}

RUN_ID=""
TAIL_LINES="40"
while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --tail-lines=*) TAIL_LINES="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
  esac
done

[[ -n "$RUN_ID" ]] || fatal "--run-id is required"
cd "$ROOT_DIR"
ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "Run this reader on the server repo root: expected=$EXPECTED_REAL actual=$ROOT_REAL"
fi

RUN_PARENT="$ROOT_DIR/artifacts/runs/$RUN_ID"
STEP_DIR="$RUN_PARENT/step-perfect-prototype-technique-episode-purity-slice"
LAUNCH_LOG="$RUN_PARENT/server_technique_episode_matched_control_purity_slice.log"
LAUNCH_PID="$RUN_PARENT/server_technique_episode_matched_control_purity_slice.pid"
LAUNCH_STATUS="$RUN_PARENT/server_technique_episode_matched_control_purity_slice_launch.json"
RUN_STATUS="$STEP_DIR/run_status.json"
PHASE_STATUS="$STEP_DIR/phase_status.json"

node --input-type=module - "$RUN_ID" "$LAUNCH_STATUS" "$LAUNCH_PID" "$RUN_STATUS" "$PHASE_STATUS" "$LAUNCH_LOG" <<'NODE'
import fs from "node:fs"
const [runId, launchStatusPath, launchPidPath, runStatusPath, phaseStatusPath, logPath] = process.argv.slice(2)
const readJsonIfExists = (p) => {
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, "utf8"))
}
let pid = null
let alive = false
if (fs.existsSync(launchPidPath)) {
  const raw = fs.readFileSync(launchPidPath, "utf8").trim()
  const parsed = Number.parseInt(raw, 10)
  if (Number.isFinite(parsed)) {
    pid = parsed
    try {
      process.kill(parsed, 0)
      alive = true
    } catch {
      alive = false
    }
  }
}
console.log(JSON.stringify({
  kind: "technique_episode_matched_control_purity_slice_detached_status_v1",
  generatedAt: new Date().toISOString(),
  runId,
  launch: readJsonIfExists(launchStatusPath),
  run: readJsonIfExists(runStatusPath),
  phase: readJsonIfExists(phaseStatusPath),
  process: { pid, alive },
  logPath,
}, null, 2))
NODE

if [[ -f "$LAUNCH_LOG" ]]; then
  echo "--- LOG TAIL (${TAIL_LINES}) ---"
  tail -n "$TAIL_LINES" "$LAUNCH_LOG"
fi
