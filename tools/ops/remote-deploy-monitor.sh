#!/usr/bin/env bash
set -euo pipefail

duration="${DURATION:-180}"
interval="${INTERVAL:-0.5}"
ts="${MONITOR_TS:-$(date +%Y%m%d-%H%M%S)}"
out="/tmp/moltook_deploy_monitor_${ts}.log"

start=$(date +%s)
end=$((start + duration))

printf "timestamp,port80,port443,port3000,service,health3000,health80\n" > "${out}"

probe_port() {
  local port="$1"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":${port}$"; then
    printf "up"
  else
    printf "down"
  fi
}

probe_service() {
  local status="unknown"
  if command -v systemctl >/dev/null 2>&1; then
    status="$(systemctl is-active moltook-web 2>/dev/null || true)"
    if [ -z "${status}" ] || [ "${status}" = "unknown" ]; then
      status="$(sudo -n systemctl is-active moltook-web 2>/dev/null || true)"
    fi
  fi
  printf "%s" "${status:-unknown}"
}

probe_http() {
  local url="$1"
  local output
  output="$(curl -m 1 -sS -o /dev/null -w "%{http_code}" "${url}" 2>&1)" || true
  if echo "${output}" | grep -qE '^[0-9]{3}$'; then
    printf "%s" "${output}"
  else
    printf "ERR:%s" "$(echo "${output}" | tr '\n' ' ' | cut -c1-80)"
  fi
}

while [ "$(date +%s)" -lt "${end}" ]; do
  now="$(date -Is)"
  p80="$(probe_port 80)"
  p443="$(probe_port 443)"
  p3000="$(probe_port 3000)"
  svc="$(probe_service)"
  h3000="$(probe_http http://127.0.0.1:3000/api/health)"
  h80="$(probe_http http://127.0.0.1/)"
  printf "%s,%s,%s,%s,%s,%s,%s\n" "${now}" "${p80}" "${p443}" "${p3000}" "${svc}" "${h3000}" "${h80}" >> "${out}"
  sleep "${interval}"
done

echo "${out}"
