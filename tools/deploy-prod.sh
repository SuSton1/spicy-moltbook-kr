#!/usr/bin/env bash
set -euo pipefail

dry_run=0
no_wait=0
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi
if [[ "${1:-}" == "--no-wait" ]]; then
  no_wait=1
  shift
fi

msg="${*:-deploy: update}"

root="$(git rev-parse --show-toplevel)"
cd "${root}"

mkdir -p artifacts/review

# Discover success marker from existing autodeploy logs/scripts.
success_marker=""
if [[ -f tools/autodeploy-watch.sh ]]; then
  success_marker="$(grep -oE 'deploy complete|healthcheck ok' tools/autodeploy-watch.sh | head -n 1 || true)"
fi
if [[ -z "${success_marker}" ]]; then
  echo "ERROR: deploy success marker not found in tools/autodeploy-watch.sh"
  exit 1
fi

# Safety: .env must be ignored if present
if [[ -f .env ]] && ! git check-ignore -q .env; then
  echo "ERROR: .env is not ignored. Add it to .gitignore before deploying."
  exit 1
fi

# Ensure autodeploy watcher is running
if command -v systemctl >/dev/null 2>&1; then
  if [[ "${dry_run}" == "1" ]]; then
    echo "[DRY RUN] Skipping autodeploy service check"
  else
    if ! systemctl --user is-active --quiet moltook-autodeploy; then
      echo "ERROR: moltook-autodeploy.service is not active."
      echo "Start it: systemctl --user start moltook-autodeploy"
      exit 1
    fi
  fi
fi

if [[ "${dry_run}" == "1" ]]; then
  echo "[DRY RUN] Would run: npm run finalize"
  echo "[DRY RUN] Would stage changes and trigger .deploy/READY"
  exit 0
fi

echo "[deploy] running finalize..."
if ! npm run finalize; then
  echo "ERROR: finalize failed; aborting deploy trigger."
  exit 1
fi

git add -A

if git diff --cached --quiet; then
  echo "No staged changes. Abort."
  exit 1
fi

mkdir -p .deploy
echo "${msg}" > .deploy/message.txt
since="$(date -Is)"

if [[ "${dry_run}" == "1" ]]; then
  echo "[DRY RUN] Would trigger deploy: ${msg}"
  exit 0
fi

date > .deploy/READY
echo "[deploy] triggered: ${msg}"
echo "[deploy] waiting for deploy completion marker: ${success_marker}"

if [[ "${DEPLOY_NO_WAIT:-0}" == "1" ]]; then
  no_wait=1
fi

wait_seconds="${DEPLOY_WAIT_MAX_SECONDS:-900}"
if ! [[ "${wait_seconds}" =~ ^[0-9]+$ ]]; then
  wait_seconds=900
fi

if [[ "${no_wait}" == "1" ]]; then
  echo "[deploy] no-wait enabled; skipping completion wait."
  exit 0
fi

deadline=$((SECONDS+wait_seconds))
while true; do
  out="$(journalctl --user -u moltook-autodeploy --since "${since}" -n 200 --no-pager 2>/dev/null || true)"
  if echo "${out}" | grep -q "${success_marker}"; then
    echo "[deploy] deploy complete detected (${success_marker})"
    break
  fi
  if echo "${out}" | grep -Eqi "deploy failed|FAILED|ERROR"; then
    echo "[deploy] deploy failed detected"
    echo "${out}"
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    ts="$(date +%Y%m%d-%H%M%S)"
    timeout_log="artifacts/review/deploy_prod_timeout_${ts}.log"
    {
      echo "[deploy] timeout waiting for ${success_marker}"
      echo "${out}"
    } | tee "${timeout_log}"
    echo "[deploy] timeout log: ${timeout_log}"
    exit 1
  fi
  sleep 2
done

echo "[deploy] running post-deploy connectivity probe..."
probe_output="$(
  DURATION="${DEPLOY_PROBE_DURATION:-120}" \
  INTERVAL="${DEPLOY_PROBE_INTERVAL:-0.5}" \
  bash tools/ops/probe-live-connectivity.sh 2>&1 || true
)"
echo "${probe_output}"
probe_csv="$(echo "${probe_output}" | awk '/wrote /{print $2; exit}')"
if [[ -n "${probe_csv}" && -f "${probe_csv}" ]]; then
  if grep -q "FAIL_CONNECT" "${probe_csv}"; then
    echo "[deploy] probe detected FAIL_CONNECT: ${probe_csv}"
    echo "[deploy] running prod:diagnose for evidence..."
    bash tools/prod-diagnose.sh || true
  else
    echo "[deploy] probe ok: ${probe_csv}"
  fi
else
  echo "[deploy] probe finished (no csv path detected)"
fi

echo "[deploy] running remote seed..."
bash tools/remote-seed.sh
echo "[deploy] remote seed complete."
