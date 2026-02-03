#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${root}"

mkdir -p artifacts/ops
ts="$(date +%Y%m%d-%H%M%S)"
log="artifacts/ops/prod_signup_diagnose_${ts}.txt"

if [[ ! -f tools/prod-ssh.sh ]]; then
  echo "Missing tools/prod-ssh.sh" | tee -a "${log}"
  exit 1
fi

# shellcheck source=tools/prod-ssh.sh
source tools/prod-ssh.sh

{
  echo "timestamp=${ts}"
  echo "host=$(prod_ssh_host)"
  echo "cmd=$(prod_ssh_cmd)"
  echo "----"
} | tee -a "${log}"

output="$(
  prod_ssh_run 'set -euo pipefail
if sudo -n true 2>/dev/null; then
  sudo journalctl -u moltook-web --since "60 min ago" --no-pager | grep -F "[SIGNUP_FAIL]" | tail -n 200 || true
else
  echo "SUDO_REQUIRED=1"
fi
' 2>&1 | tee -a "${log}"
)"

if grep -q "SUDO_REQUIRED=1" <<<"${output}"; then
  {
    echo "SUDO_REQUIRED: cannot read journald logs automatically."
    echo "Manual steps:"
    echo "  ssh -p 2222 moltook@223.130.158.154"
    echo "  sudo journalctl -u moltook-web --since \"60 min ago\" --no-pager | grep -F \"[SIGNUP_FAIL]\" | tail -n 200"
  } | tee -a "${log}"
fi

diag_class="UNKNOWN"
if grep -q "code=SERVER_CONFIG_MISSING" <<<"${output}"; then
  diag_class="SERVER_CONFIG_MISSING"
elif grep -q "code=DB_MIGRATION_MISSING" <<<"${output}"; then
  diag_class="DB_MIGRATION_MISSING"
elif grep -q "relation .* does not exist" <<<"${output}"; then
  diag_class="DB_MIGRATION_MISSING"
elif grep -q "code=CONFLICT" <<<"${output}"; then
  diag_class="DB_CONSTRAINT"
elif grep -q "code=POW_INVALID" <<<"${output}"; then
  diag_class="POW_INVALID"
elif grep -q "code=COOKIES_REQUIRED" <<<"${output}"; then
  diag_class="DEVICE_COOKIE"
fi

echo "DIAG_CLASS=${diag_class}" | tee -a "${log}"
