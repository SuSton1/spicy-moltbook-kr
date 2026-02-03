#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${RELEASE_GATE_BASE_URL:-http://localhost:3000}"
TIMEOUT_SEC="${RELEASE_GATE_TIMEOUT_SEC:-120}"
INTERVAL_SEC="${RELEASE_GATE_INTERVAL_SEC:-2}"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ART_DIR="${ROOT}/artifacts/review"
mkdir -p "${ART_DIR}"

HEALTH_NO_DB="/api/health"
HEALTH_DB="/api/health/db"

fail_connect_endpoint="${RELEASE_GATE_FAIL_CONNECT_ENDPOINT:-}"
if [[ -z "${fail_connect_endpoint}" && -d "${ROOT}/src/app/api" ]]; then
  found_endpoint=$(find "${ROOT}/src/app/api" -name 'route.ts' -path '*fail*connect*' | head -n 1 || true)
  if [[ -n "${found_endpoint}" ]]; then
    rel="${found_endpoint#${ROOT}/src/app}"
    rel="${rel%/route.ts}"
    fail_connect_endpoint="${rel}"
  fi
fi

fetch_endpoint() {
  local url="$1"
  local tmp
  tmp=$(mktemp)
  local code
  code=$(curl -sS -m 5 -o "${tmp}" -w "%{http_code}" "${url}" || true)
  local body
  body=$(head -c 400 "${tmp}" | tr '\n' ' ' | tr '\r' ' ')
  rm -f "${tmp}"
  printf '%s\n%s\n' "${code}" "${body}"
}

db_endpoint_mode="unknown"

last_health_no_db_code=""
last_health_no_db_body=""
last_health_db_code=""
last_health_db_body=""
last_fail_connect_code=""
last_fail_connect_body=""
last_fail_connect_value=""

deadline=$((SECONDS + TIMEOUT_SEC))

while (( SECONDS < deadline )); do
  ok=1

  mapfile -t res < <(fetch_endpoint "${BASE_URL}${HEALTH_NO_DB}")
  last_health_no_db_code="${res[0]:-}"
  last_health_no_db_body="${res[1]:-}"
  if [[ "${last_health_no_db_code}" != "200" ]]; then
    ok=0
  fi

  if [[ "${db_endpoint_mode}" != "absent" ]]; then
    mapfile -t res < <(fetch_endpoint "${BASE_URL}${HEALTH_DB}")
    last_health_db_code="${res[0]:-}"
    last_health_db_body="${res[1]:-}"
    if [[ "${last_health_db_code}" == "404" || "${last_health_db_code}" == "405" ]]; then
      db_endpoint_mode="absent"
    else
      db_endpoint_mode="present"
      if [[ "${last_health_db_code}" != "200" ]]; then
        ok=0
      fi
    fi
  fi

  if [[ -n "${fail_connect_endpoint}" ]]; then
    mapfile -t res < <(fetch_endpoint "${BASE_URL}${fail_connect_endpoint}")
    last_fail_connect_code="${res[0]:-}"
    last_fail_connect_body="${res[1]:-}"
    if [[ "${last_fail_connect_code}" == "404" || "${last_fail_connect_code}" == "405" ]]; then
      fail_connect_endpoint=""
    elif [[ "${last_fail_connect_code}" == "200" ]]; then
      last_fail_connect_value=""
      if ! last_fail_connect_value=$(node -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));const val=data.FAIL_CONNECT ?? data.failConnect ?? data.fail_connect; if(typeof val!=="number") process.exit(2); if(val!==0) process.exit(1); console.log(String(val));' <<<"${last_fail_connect_body}" 2>/dev/null); then
        ok=0
      fi
    else
      ok=0
    fi
  fi

  if [[ "${ok}" == "1" ]]; then
    echo "RELEASE_GATE PASS"
    exit 0
  fi

  sleep "${INTERVAL_SEC}"
done

{
  echo "RELEASE_GATE FAIL"
  echo "base_url=${BASE_URL}"
  echo "health_no_db_code=${last_health_no_db_code}"
  echo "health_no_db_body=${last_health_no_db_body}"
  if [[ "${db_endpoint_mode}" == "present" ]]; then
    echo "health_db_code=${last_health_db_code}"
    echo "health_db_body=${last_health_db_body}"
  else
    echo "health_db=absent"
  fi
  if [[ -n "${fail_connect_endpoint}" ]]; then
    echo "fail_connect_endpoint=${fail_connect_endpoint}"
    echo "fail_connect_code=${last_fail_connect_code}"
    echo "fail_connect_body=${last_fail_connect_body}"
    if [[ -n "${last_fail_connect_value}" ]]; then
      echo "fail_connect_value=${last_fail_connect_value}"
    fi
  else
    echo "fail_connect=absent"
  fi
} | tee "${ART_DIR}/release_gate_fail_logs.txt"

exit 1
