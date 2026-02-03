#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="${REPO_ROOT}/artifacts"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/moltook-autodeploy.service"

mkdir -p "$ARTIFACTS_DIR"

if command -v apt-get >/dev/null 2>&1; then
  if ! command -v inotifywait >/dev/null 2>&1; then
    if sudo -n true >/dev/null 2>&1; then
      sudo -n apt-get update -y || true
      sudo -n apt-get install -y inotify-tools || true
    else
      echo "[autodeploy] sudo not available; skipping inotify-tools install"
    fi
  fi
fi

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$SERVICE_DIR"
  cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Moltook autodeploy watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env bash ${REPO_ROOT}/tools/autodeploy-watch.sh
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
SERVICE

  systemctl --user daemon-reload
  systemctl --user enable --now moltook-autodeploy.service
  systemctl --user status --no-pager --lines=3 moltook-autodeploy.service || true
else
  echo "[autodeploy] systemd --user not available. Run:"
  echo "nohup bash tools/autodeploy-watch.sh > artifacts/autodeploy_watch.out 2>&1 &"
fi
