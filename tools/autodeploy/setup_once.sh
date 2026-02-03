#!/usr/bin/env bash
set -euo pipefail

KEY_PATH_SRC="/mnt/c/Users/saida/Downloads/spicy-moltbook-key.pem"
KEY_PATH="${HOME}/.ssh/spicy-moltbook-key.pem"
REMOTE_USER_HOST="moltook@223.130.158.154"
REMOTE_REPO_PATH="/home/moltook/repos/spicy-moltbook-kr.git"
REMOTE_URL="ssh://moltook@223.130.158.154${REMOTE_REPO_PATH}"

if [[ -f "$KEY_PATH_SRC" ]]; then
  mkdir -p "${HOME}/.ssh"
  cp "$KEY_PATH_SRC" "$KEY_PATH"
  chmod 600 "$KEY_PATH"
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "SSH key not found at $KEY_PATH_SRC or $KEY_PATH" >&2
  exit 1
fi

chmod 600 "$KEY_PATH"

if git remote | grep -q '^prod$'; then
  git remote set-url prod "$REMOTE_URL"
else
  git remote add prod "$REMOTE_URL"
fi

git config core.sshCommand "ssh -i $KEY_PATH -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10"

ssh -i "$KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_USER_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail

missing=()
for cmd in git rsync curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing+=("$cmd")
  fi
done

if (( ${#missing[@]} > 0 )); then
  if command -v apt-get >/dev/null 2>&1; then
    sudo -n apt-get update -y
    sudo -n apt-get install -y git rsync curl
  elif command -v dnf >/dev/null 2>&1; then
    sudo -n dnf install -y git rsync curl
  elif command -v yum >/dev/null 2>&1; then
    sudo -n yum install -y git rsync curl
  elif command -v apk >/dev/null 2>&1; then
    sudo -n apk add --no-cache git rsync curl
  else
    echo "No supported package manager found" >&2
    exit 1
  fi
fi

mkdir -p /home/moltook/repos /home/moltook/build /home/moltook/apps /home/moltook/releases

if [[ ! -d /home/moltook/repos/spicy-moltbook-kr.git ]]; then
  git init --bare /home/moltook/repos/spicy-moltbook-kr.git
fi

mkdir -p /home/moltook/build/spicy-moltbook-kr
mkdir -p /home/moltook/apps/spicy-moltbook-kr

cat > /home/moltook/repos/spicy-moltbook-kr.git/hooks/post-receive <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/moltook/repos/spicy-moltbook-kr.git"
WORK_TREE="/home/moltook/build/spicy-moltbook-kr"
APP_DIR="/home/moltook/apps/spicy-moltbook-kr"
RELEASES_DIR="/home/moltook/releases"
LOG_FILE="${RELEASES_DIR}/autodeploy.log"
LOCK_FILE="${RELEASES_DIR}/autodeploy.lock"

export PATH="/opt/node-v22.22.0/bin:$PATH"

mkdir -p "$WORK_TREE" "$APP_DIR" "$RELEASES_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) deploy locked; exiting" >> "$LOG_FILE"
  exit 0
fi

exec >> "$LOG_FILE" 2>&1

log() {
  echo "$(date -Is) $*"
}

deploy=false
while read -r oldrev newrev refname; do
  log "ref update $refname $oldrev $newrev"
  if [[ "$refname" == "refs/heads/main" ]]; then
    deploy=true
  fi
done

if [[ "$deploy" != "true" ]]; then
  log "no main update; exiting"
  exit 0
fi

trap 'code=$?; if [[ $code -ne 0 ]]; then log "deploy failed (exit $code)"; else log "deploy success"; fi' EXIT

log "checkout main"
git --git-dir="$REPO_DIR" --work-tree="$WORK_TREE" checkout -f main
git --git-dir="$REPO_DIR" --work-tree="$WORK_TREE" clean -fdx

cd "$WORK_TREE"
log "npm ci"
npm ci

log "prisma generate"
npx prisma generate

log "next build"
npm run build

log "rsync to app"
rsync -a --delete --exclude='.env' --exclude='.env.*' "$WORK_TREE"/ "$APP_DIR"/

log "restart moltook-web"
sudo -n systemctl restart moltook-web
sudo -n systemctl status --no-pager --lines=3 moltook-web || true

log "healthcheck"
curl -fsS http://127.0.0.1:3000 >/dev/null
log "healthcheck ok"
HOOK

chmod +x /home/moltook/repos/spicy-moltbook-kr.git/hooks/post-receive

if ! sudo -n systemctl status moltook-web >/dev/null 2>&1; then
  echo "moltook ALL=(root) NOPASSWD: /bin/systemctl restart moltook-web, /bin/systemctl status moltook-web" | sudo -n tee /etc/sudoers.d/moltook-web >/dev/null
  sudo -n chmod 0440 /etc/sudoers.d/moltook-web
fi
REMOTE

printf 'Autodeploy setup complete.\n'
