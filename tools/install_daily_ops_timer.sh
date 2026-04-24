#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_NAME="stockdesk-lab-lite-daily-ops.service"
TIMER_NAME="stockdesk-lab-lite-daily-ops.timer"
LEGACY_TIMER_NAME="stockdesk-lab-lite-public-fill.timer"

if ! command -v loginctl >/dev/null 2>&1; then
  echo "missing loginctl; cannot validate user-systemd linger state" >&2
  exit 1
fi

linger_state="$(loginctl show-user "${USER}" -p Linger --value 2>/dev/null || true)"
if [[ "${linger_state}" != "yes" ]]; then
  cat >&2 <<EOF
fatal: stockdesk-lab-lite daily ops timer requires systemd linger for user ${USER}.
current_linger=${linger_state:-unknown}

The timer runs after market close and must survive SSH logout. Enable linger first, then reinstall:
  sudo loginctl enable-linger ${USER}
  bash tools/install_daily_ops_timer.sh
EOF
  exit 1
fi

mkdir -p "${SYSTEMD_USER_DIR}"

install -m 0644 "${ROOT}/tools/systemd/${SERVICE_NAME}" "${SYSTEMD_USER_DIR}/${SERVICE_NAME}"
install -m 0644 "${ROOT}/tools/systemd/${TIMER_NAME}" "${SYSTEMD_USER_DIR}/${TIMER_NAME}"

systemctl --user daemon-reload

if systemctl --user list-unit-files "${LEGACY_TIMER_NAME}" --no-legend 2>/dev/null | grep -q "${LEGACY_TIMER_NAME}"; then
  systemctl --user disable --now "${LEGACY_TIMER_NAME}" >/dev/null 2>&1 || true
fi

systemctl --user enable --now "${TIMER_NAME}"

echo "installed_service=${SYSTEMD_USER_DIR}/${SERVICE_NAME}"
echo "installed_timer=${SYSTEMD_USER_DIR}/${TIMER_NAME}"
echo "disabled_legacy_timer=${LEGACY_TIMER_NAME}"
systemctl --user status "${TIMER_NAME}" --no-pager --lines=20
