#!/usr/bin/env bash
set -euo pipefail

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # Ensure npm/node are available in systemd user service environment.
  . "${NVM_DIR}/nvm.sh"
  nvm use --silent default >/dev/null 2>&1 || true
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="${REPO_ROOT}/.deploy"
READY_FILE="${DEPLOY_DIR}/READY"
MSG_FILE="${DEPLOY_DIR}/message.txt"
ARTIFACTS_DIR="${REPO_ROOT}/artifacts"
FAIL_LOG="${ARTIFACTS_DIR}/autodeploy_fail.log"
WATCH_LOG="${ARTIFACTS_DIR}/autodeploy_watch.log"
HEALTH_URL="https://moltook.com/api/health/db"
HEALTH_TIMEOUT_SECONDS=180
HEALTH_INTERVAL_SECONDS=2
PROBE_AFTER_DEPLOY="${PROBE_AFTER_DEPLOY:-1}"
PROBE_DURATION_SECONDS="${PROBE_DURATION_SECONDS:-120}"
PROBE_INTERVAL_SECONDS="${PROBE_INTERVAL_SECONDS:-0.5}"

mkdir -p "$DEPLOY_DIR" "$ARTIFACTS_DIR"

timestamp() {
  date -Iseconds
}

log() {
  echo "$(timestamp) $*" | tee -a "$WATCH_LOG"
}

read_message() {
  local message="chore: auto deploy"
  if [[ -f "$MSG_FILE" ]]; then
    message="$(head -n 1 "$MSG_FILE" | tr -d '\r')"
    if [[ -z "${message// }" ]]; then
      message="chore: auto deploy"
    fi
  fi
  echo "$message"
}

health_check() {
  local start
  start=$(date +%s)
  while true; do
    local now
    now=$(date +%s)
    if (( now - start >= HEALTH_TIMEOUT_SECONDS )); then
      log "healthcheck timeout"
      return 1
    fi

    local body
    body="$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)"
    if echo "$body" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
      log "healthcheck ok"
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done
}

post_deploy_probe() {
  if [[ "${PROBE_AFTER_DEPLOY}" != "1" ]]; then
    log "deploy probe skipped (PROBE_AFTER_DEPLOY=${PROBE_AFTER_DEPLOY})"
    return 0
  fi
  if [[ ! -x "${REPO_ROOT}/tools/ops/probe-live-connectivity.sh" ]]; then
    log "deploy probe skipped: tools/ops/probe-live-connectivity.sh missing"
    return 0
  fi

  log "deploy probe start (duration=${PROBE_DURATION_SECONDS}s)"
  local output
  output="$(
    DURATION="${PROBE_DURATION_SECONDS}" \
    INTERVAL="${PROBE_INTERVAL_SECONDS}" \
    bash "${REPO_ROOT}/tools/ops/probe-live-connectivity.sh" 2>&1 || true
  )"
  log "${output}"
  local csv
  csv="$(echo "${output}" | awk '/wrote /{print $2; exit}')"
  if [[ -n "${csv}" && -f "${REPO_ROOT}/${csv}" ]]; then
    if grep -q "FAIL_CONNECT" "${REPO_ROOT}/${csv}"; then
      log "deploy probe FAIL_CONNECT detected: ${csv}"
      if [[ -x "${REPO_ROOT}/tools/prod-diagnose.sh" ]]; then
        log "deploy probe: running prod-diagnose"
        bash "${REPO_ROOT}/tools/prod-diagnose.sh" || true
      fi
      return 1
    fi
    log "deploy probe ok: ${csv}"
  else
    log "deploy probe complete (no csv path detected)"
  fi
  return 0
}

run_deploy() {
  local message
  message="$(read_message)"
  log "deploy start: $message"

  if ! (cd "$REPO_ROOT" && npm run finalize); then
    echo "$(timestamp) finalize failed" >> "$FAIL_LOG"
    log "finalize failed; not pushing"
    return 1
  fi

  cd "$REPO_ROOT"
  git add -A
  git commit --allow-empty -m "$message"
  SKIP_FINALIZE_HOOK=1 git push prod HEAD:main

  if health_check; then
    log "deploy complete"
    rm -f "$READY_FILE"
    if ! post_deploy_probe; then
      log "deploy probe detected connectivity failure (see artifacts/ops)"
    fi
  else
    log "deploy finished but healthcheck failed"
  fi
}

watch_inotify() {
  log "watching for $READY_FILE (inotify)"
  while inotifywait -q -e close_write,create,move "$DEPLOY_DIR"; do
    if [[ -f "$READY_FILE" ]]; then
      run_deploy
    fi
  done
}

watch_poll() {
  log "watching for $READY_FILE (polling)"
  local last_mtime=""
  while true; do
    if [[ -f "$READY_FILE" ]]; then
      local mtime
      mtime="$(stat -c %Y "$READY_FILE" 2>/dev/null || true)"
      if [[ -n "$mtime" && "$mtime" != "$last_mtime" ]]; then
        last_mtime="$mtime"
        run_deploy
      fi
    fi
    sleep 1
  done
}

if command -v inotifywait >/dev/null 2>&1; then
  watch_inotify
else
  watch_poll
fi
