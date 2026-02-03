#!/usr/bin/env bash
set -euo pipefail

if [[ "${SKIP_PROD_GATE:-}" == "1" ]]; then
  echo "PROD_GATE SKIPPED (SKIP_PROD_GATE=1)"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_check() {
  local output
  output="$(${SCRIPT_DIR}/prod-check.sh 2>&1)" || {
    echo "${output}"
    return 1
  }
  echo "${output}"
  return 0
}

run_diagnose() {
  local output
  output="$(${SCRIPT_DIR}/prod-diagnose.sh 2>&1)" || {
    echo "${output}"
    return 1
  }
  echo "${output}"
  return 0
}

extract_diag_class() {
  echo "$1" | awk -F': ' '/DIAG_CLASS/{print $2; exit}'
}

extract_cf_ray() {
  echo "$1" | awk -F': ' '/cf-ray/{print $2; exit}'
}

extract_diag_log() {
  echo "$1" | awk -F': ' '/log_file/{print $2; exit}'
}

attempt=1
max_attempts=3
while [[ ${attempt} -le ${max_attempts} ]]; do
  check_out="$(run_check || true)"
  echo "${check_out}"
  if echo "${check_out}" | grep -q "PROD_CHECK PASS"; then
    exit 0
  fi

  echo "[gate] prod-check failed (attempt ${attempt}/${max_attempts}). Diagnosing..."
  diag_out="$(run_diagnose || true)"
  echo "${diag_out}"
  diag_class="$(extract_diag_class "${diag_out}")"
  diag_class="${diag_class:-UNKNOWN}"
  diag_log="$(extract_diag_log "${diag_out}")"

  case "${diag_class}" in
    LOCAL_DNS)
      echo "BLOCKED: LOCAL_DNS"
      echo "Manual steps (local DNS reset):"
      echo "  Windows: ipconfig /flushdns"
      echo "  Set DNS to 1.1.1.1 or 8.8.8.8"
      echo "  Disable browser Secure DNS temporarily"
      if [[ -n "${diag_log}" ]]; then
        echo "Evidence: ${diag_log}"
      fi
      exit 1
      ;;
    CF_WAF_1020)
      cf_ray="$(extract_cf_ray "${diag_out}")"
      echo "BLOCKED: CF_WAF_1020"
      echo "Manual steps (Cloudflare WAF):"
      echo "  1) Cloudflare Dashboard > Security > Events"
      echo "  2) Search Ray ID: ${cf_ray:-unknown}"
      echo "  3) Add allow rule for the blocking rule"
      if [[ -n "${diag_log}" ]]; then
        echo "Evidence: ${diag_log}"
      fi
      exit 1
      ;;
    CANONICAL_REDIRECT_BROKEN)
      echo "[gate] Canonical redirect check failed; rechecking after short wait."
      sleep 1
      ;;
    ORIGIN_ID_MISMATCH|ORIGIN_OR_APP_FAIL|CF_522|TLS_FAIL)
      echo "[gate] attempting origin init + recover for ${diag_class}"
      ${SCRIPT_DIR}/prod-init-origin-id.sh || true
      ${SCRIPT_DIR}/prod-recover.sh || true
      ;;
    PASS)
      exit 0
      ;;
    *)
      echo "[gate] unknown diagnosis (${diag_class}); attempting origin init + recover"
      ${SCRIPT_DIR}/prod-init-origin-id.sh || true
      ${SCRIPT_DIR}/prod-recover.sh || true
      ;;
  esac

  attempt=$((attempt + 1))
  sleep 1
 done

check_out="$(run_check || true)"
echo "${check_out}"

diag_out="$(run_diagnose || true)"
run_diag_class="$(extract_diag_class "${diag_out}")"
run_diag_class="${run_diag_class:-UNKNOWN}"

echo "BLOCKED: production connectivity failing (${run_diag_class})"
if [[ -n "${diag_out}" ]]; then
  diag_log="$(extract_diag_log "${diag_out}")"
  if [[ -n "${diag_log}" ]]; then
    echo "Evidence: ${diag_log}"
  fi
fi

echo "Manual steps:"
if [[ "${run_diag_class}" == "CANONICAL_REDIRECT_BROKEN" ]]; then
  cat <<'CFRULE'
  Cloudflare > Rules > Redirect Rules:
    - If host equals www.moltook.com
    - Then 301 redirect to https://moltook.com/$1
  Ensure www DNS record is proxied to the same zone.
CFRULE
fi
cat <<'MANUAL'
  ssh -p 2222 moltook@223.130.158.154
  sudo systemctl status moltook-web --no-pager
  sudo journalctl -u moltook-web --since "30 min ago" --no-pager | tail -n 200
  sudo systemctl restart moltook-web
  sudo systemctl restart nginx
MANUAL
exit 1
