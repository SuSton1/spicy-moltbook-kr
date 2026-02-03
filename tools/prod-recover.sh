#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/prod-ssh.sh"

TS="$(date +%Y%m%d-%H%M%S)"
LOG="artifacts/ops/prod_recover_${TS}.txt"
mkdir -p artifacts/ops

log() {
  echo "$*" | tee -a "${LOG}"
}

run_remote() {
  local cmd="$1"
  log "--- remote: ${cmd}"
  if ! prod_ssh_run "${cmd}" 2>&1 | tee -a "${LOG}"; then
    log "remote_command_failed"
    return 1
  fi
}

log "date: $(date -Is)"
log "starting prod recover"

run_remote "hostname; date; uptime" || true
run_remote "df -h" || true
run_remote "free -m || free -h" || true

sudo_ok=1
if ! prod_ssh_run "sudo -n true" >/dev/null 2>&1; then
  sudo_ok=0
  log "sudo: not available without password"
fi

if [[ "${sudo_ok}" -eq 1 ]]; then
  run_remote "sudo -n systemctl status moltook-web --no-pager || true" || true
  run_remote "sudo -n journalctl -u moltook-web --since '30 min ago' --no-pager | tail -n 200 || true" || true
  run_remote "sudo -n ss -ltnp | egrep ':80|:443' || true" || true
else
  run_remote "ss -ltnp | egrep ':80|:443' || true" || true
fi

run_remote "systemctl list-units --type=service --state=running --no-pager | egrep -i 'nginx|caddy|apache|traefik|haproxy' || true" || true

if [[ "${sudo_ok}" -eq 1 ]]; then
  run_remote "sudo -n systemctl restart moltook-web || true" || true
  run_remote "proxy_unit=\$(systemctl list-units --type=service --state=running --no-pager | awk '/(nginx|caddy|apache|traefik|haproxy)/{print \$1; exit}'); if [ -n \"\$proxy_unit\" ]; then sudo -n systemctl restart \"\$proxy_unit\" || true; fi" || true
else
  log "sudo not available; skipping service restarts"
fi

run_remote "cd /home/moltook/apps/spicy-moltbook-kr && docker compose ps || true" || true
run_remote "cd /home/moltook/apps/spicy-moltbook-kr && docker compose up -d || true" || true
run_remote "cd /home/moltook/apps/spicy-moltbook-kr && docker compose exec -T db pg_isready || true" || true

if [[ "${sudo_ok}" -ne 1 ]]; then
  log "manual_recover_steps:"
  log "  ssh -p 2222 moltook@223.130.158.154"
  log "  sudo systemctl status moltook-web --no-pager"
  log "  sudo journalctl -u moltook-web --since '30 min ago' --no-pager | tail -n 200"
  log "  sudo systemctl restart moltook-web"
  log "  sudo systemctl restart nginx"
fi

log "prod recover complete"
