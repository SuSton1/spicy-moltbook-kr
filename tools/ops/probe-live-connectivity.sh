#!/usr/bin/env bash
set -euo pipefail

duration="${DURATION:-240}"
interval="${INTERVAL:-0.5}"
ts="$(date +%Y%m%d-%H%M%S)"
out_csv="artifacts/ops/live_probe_${ts}.csv"

mkdir -p artifacts/ops
printf "timestamp,endpoint,category,detail\n" > "${out_csv}"

start=$(date +%s)
end=$((start + duration))

endpoints=(
  "https://moltook.com/api/health"
  "https://moltook.com/"
)

classify_result() {
  local msg="$1"
  local category="FAIL_CONNECT"
  if echo "${msg}" | grep -qiE "SSL|TLS|handshake|CERT|certificate"; then
    category="FAIL_TLS"
  elif echo "${msg}" | grep -qiE "Could not resolve host|Failed to connect|Connection refused|Operation timed out|timed out|Connection timed out"; then
    category="FAIL_CONNECT"
  fi
  printf "%s" "${category}"
}

while [ "$(date +%s)" -lt "${end}" ]; do
  for url in "${endpoints[@]}"; do
    now="$(date -Is)"
    output="$(curl -I -m 3 -sS -o /dev/null -w "%{http_code}" "${url}" 2>&1)"
    status=$?
    if [ "${status}" -eq 0 ]; then
      category="OK_HTTP"
      detail="${output}"
    else
      category="$(classify_result "${output}")"
      detail="$(echo "${output}" | tr '\n' ' ' | cut -c1-160)"
    fi
    printf "%s,%s,%s,%s\n" "${now}" "${url}" "${category}" "${detail}" >> "${out_csv}"
  done
  sleep "${interval}"
done

echo "wrote ${out_csv}"
