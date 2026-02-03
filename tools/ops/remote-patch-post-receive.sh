#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOG_DIR="${ROOT}/artifacts/ops"
mkdir -p "${LOG_DIR}"
TS="$(date -Is | tr ':' '-')"
LOG_FILE="${LOG_DIR}/remote_patch_hook_${TS}.log"

exec > >(tee -a "${LOG_FILE}") 2>&1

echo "[ops] patching post-receive hook on prod"

SSH_CMD=("ssh" "-p" "2222" "moltook@223.130.158.154")
if [[ -x "${ROOT}/tools/ssh-prod.sh" ]]; then
  SSH_CMD=("${ROOT}/tools/ssh-prod.sh" "bash" "-s")
else
  SSH_CMD=("ssh" "-p" "2222" "moltook@223.130.158.154" "bash" "-s")
fi

"${SSH_CMD[@]}" <<'REMOTE'
set -euo pipefail

HOOK_DIR="/home/moltook/git/spicy-moltbook-kr.git/hooks"
HOOK="${HOOK_DIR}/post-receive"
TS="$(date -Iseconds | tr ':' '-')"

if [ -f "${HOOK}" ]; then
  cp "${HOOK}" "${HOOK_DIR}/post-receive.bak.${TS}"
fi

cat > "${HOOK}" <<'HOOK_EOF'
#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/node-v22.22.0/bin:$PATH"

GIT_DIR="/home/moltook/git/spicy-moltbook-kr.git"
WORK="/home/moltook/deploy/work/spicy-moltbook-kr"
STAGE="/home/moltook/apps/.spicy-moltbook-kr.next"
LIVE="/home/moltook/apps/spicy-moltbook-kr"
LOG_DIR="/home/moltook/releases"
LOG_FILE="${LOG_DIR}/autodeploy.log"
DEPLOY_TS="$(date +%Y%m%d-%H%M%S)"
MONITOR_LOG="/tmp/moltook_deploy_monitor_${DEPLOY_TS}.log"

mkdir -p "${LOG_DIR}" "$(dirname "${WORK}")" "$(dirname "${STAGE}")"

exec >> "${LOG_FILE}" 2>&1
echo "---- deploy $(date -Iseconds) ----"

ref=""
while read -r _old _new next_ref; do
  ref="${next_ref}"
done

if [ "${ref}" != "refs/heads/main" ]; then
  echo "skip ref ${ref}"
  exit 0
fi

LOCK_FILE="/home/moltook/deploy/deploy.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "deploy locked"
  exit 1
fi

rm -rf "${WORK}"
mkdir -p "${WORK}"
git --git-dir "${GIT_DIR}" --work-tree "${WORK}" checkout -f

if [ -x "${WORK}/tools/ops/remote-deploy-monitor.sh" ]; then
  MONITOR_TS="${DEPLOY_TS}" DURATION=180 INTERVAL=0.5 \
    nohup bash "${WORK}/tools/ops/remote-deploy-monitor.sh" \
    >/tmp/moltook_deploy_monitor_stdout_${DEPLOY_TS}.log 2>&1 &
fi

if [ -f "${LIVE}/.env" ]; then
  cp "${LIVE}/.env" "${WORK}/.env"
fi

cd "${WORK}"
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build

rm -rf "${STAGE}"
mkdir -p "${STAGE}"
rsync -a --delete --exclude ".env" "${WORK}/" "${STAGE}/"
if [ -f "${LIVE}/.env" ] && [ ! -f "${STAGE}/.env" ]; then
  cp "${LIVE}/.env" "${STAGE}/.env"
fi

if [ -d "${LIVE}" ]; then
  rm -rf "${LIVE}.prev"
  mv "${LIVE}" "${LIVE}.prev"
fi
mv "${STAGE}" "${LIVE}"

sudo systemctl restart moltook-web

healthy=0
for _ in $(seq 1 15); do
  if curl -fsS -m 5 http://127.0.0.1:3000/api/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "${healthy}" -eq 1 ]; then
  echo "health ok"
  rm -rf "${LIVE}.prev"
  if [ -f "${MONITOR_LOG}" ]; then
    mkdir -p "${LIVE}/artifacts/ops"
    cp "${MONITOR_LOG}" "${LIVE}/artifacts/ops/" || true
  fi
else
  echo "health failed"
  if [ -d "${LIVE}.prev" ]; then
    rm -rf "${LIVE}.failed" || true
    mv "${LIVE}" "${LIVE}.failed" || true
    mv "${LIVE}.prev" "${LIVE}"
    sudo systemctl restart moltook-web
  fi
  if [ -f "${MONITOR_LOG}" ]; then
    mkdir -p "${LIVE}/artifacts/ops"
    cp "${MONITOR_LOG}" "${LIVE}/artifacts/ops/" || true
  fi
  exit 1
fi
HOOK_EOF

chmod +x "${HOOK}"

echo "patched hook: ${HOOK}"
REMOTE

echo "[ops] log saved to ${LOG_FILE}"
