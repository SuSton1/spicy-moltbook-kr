#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${PROD_DOMAIN:-moltook.com}"
APEX_DOMAIN="${DOMAIN#www.}"
WWW_DOMAIN="www.${APEX_DOMAIN}"
DNS_MODE="${PROD_DNS_MODE:-cdn}"
EXPECT_IP="${PROD_EXPECT_IP:-223.130.158.154}"
EXPECT_ORIGIN_ID="${PROD_EXPECT_ORIGIN_ID:-}"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="artifacts/ops/prod_check_${TS}.txt"

mkdir -p artifacts/ops

log() {
  echo "$*" | tee -a "${LOG}"
}

fail() {
  local class="$1"
  local detail="${2:-}"
  log "FAIL_CLASS: ${class}"
  if [[ -n "${detail}" ]]; then
    log "DETAIL: ${detail}"
  fi
  log "PROD_CHECK FAIL: ${class}"
  exit 1
}

log "date: $(date -Is)"
log "domain: ${DOMAIN}"
log "apex_domain: ${APEX_DOMAIN}"
log "www_domain: ${WWW_DOMAIN}"
log "dns_mode: ${DNS_MODE}"
log "expect_ip: ${EXPECT_IP}"

resolved=""
for attempt in 1 2 3; do
  resolved="$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -n1 || true)"
  if [[ -n "${resolved}" ]]; then
    break
  fi
  sleep 1
 done

if [[ -z "${resolved}" ]]; then
  fail "DNS_LOOKUP_FAIL" "getent ahostsv4 returned empty"
fi

log "resolved_ip: ${resolved}"
if [[ "${DNS_MODE}" == "direct" ]]; then
  if [[ "${resolved}" != "${EXPECT_IP}" ]]; then
    fail "DNS_MISMATCH" "resolved=${resolved} expected=${EXPECT_IP}"
  fi
else
  if [[ "${resolved}" != "${EXPECT_IP}" ]]; then
    log "dns_warn: resolved=${resolved} expected=${EXPECT_IP} (cdn mode)"
  fi
fi

log "dns_check: ok"

tcp_ok=0
for attempt in 1 2 3; do
  if command -v nc >/dev/null 2>&1; then
    if nc -z -w 5 "${DOMAIN}" 443 >/dev/null 2>&1; then
      tcp_ok=1
      break
    fi
  else
    if command -v timeout >/dev/null 2>&1; then
      if timeout 5 bash -c "cat < /dev/null > /dev/tcp/${DOMAIN}/443" >/dev/null 2>&1; then
        tcp_ok=1
        break
      fi
    else
      if bash -c "cat < /dev/null > /dev/tcp/${DOMAIN}/443" >/dev/null 2>&1; then
        tcp_ok=1
        break
      fi
    fi
  fi
  sleep 1
 done

if [[ "${tcp_ok}" -ne 1 ]]; then
  fail "TCP_443_BLOCKED" "tcp connection failed"
fi

log "tcp_443: ok"

if [[ -z "${EXPECT_ORIGIN_ID}" ]]; then
  EXPECT_ORIGIN_ID="$("${SCRIPT_DIR}/prod-origin-id.sh" 2>/dev/null || true)"
  if [[ -z "${EXPECT_ORIGIN_ID}" ]]; then
    fail "ORIGIN_ID_FETCH_FAIL" "unable to determine expected origin id"
  fi
fi

log "expect_origin_id: ${EXPECT_ORIGIN_ID}"

health_code=""
health_err=""
health_body=""
health_ok=0
origin_header=""
origin_body=""
health_url="https://${DOMAIN}/api/health?ts=${TS}"
for attempt in 1 2 3; do
  tmp_body="$(mktemp)"
  tmp_err="$(mktemp)"
  tmp_headers="$(mktemp)"
  health_code="$(curl -sS --connect-timeout 5 -m 15 -D "${tmp_headers}" -o "${tmp_body}" -w "%{http_code}" "${health_url}" 2>"${tmp_err}" || true)"
  health_err="$(cat "${tmp_err}" || true)"
  health_body="$(head -c 300 "${tmp_body}" | tr '\n' ' ' || true)"
  origin_header="$(awk -F': ' 'tolower($1)=="x-moltook-origin-id"{print $2}' "${tmp_headers}" | tr -d '\r' | tail -n1 || true)"
  origin_body="$(echo "${health_body}" | sed -n 's/.*"originId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  rm -f "${tmp_body}" "${tmp_err}" "${tmp_headers}"
  if [[ "${health_code}" == "200" ]]; then
    health_ok=1
    break
  fi
  sleep 1
 done

if [[ "${health_ok}" -ne 1 ]]; then
  if [[ -n "${health_err}" ]]; then
    fail "HEALTH_HTTP_FAIL" "code=${health_code} err=${health_err} body=${health_body}"
  fi
  fail "HEALTH_HTTP_FAIL" "code=${health_code} body=${health_body}"
fi

if [[ -n "${origin_header}" && -n "${origin_body}" && "${origin_header}" != "${origin_body}" ]]; then
  fail "ORIGIN_MISMATCH" "header=${origin_header} body=${origin_body}"
fi

origin_id="${origin_header:-${origin_body}}"
if [[ -z "${origin_id}" ]]; then
  fail "ORIGIN_MISSING" "origin id missing from health response"
fi

if [[ "${origin_id}" != "${EXPECT_ORIGIN_ID}" ]]; then
  fail "ORIGIN_MISMATCH" "got=${origin_id} expected=${EXPECT_ORIGIN_ID}"
fi

log "health: ${health_code}"
log "origin_id: ${origin_id}"

home_code=""
home_err=""
home_ok=0
for attempt in 1 2 3; do
  tmp_err="$(mktemp)"
  home_code="$(curl -sS --connect-timeout 5 -m 15 -I -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>"${tmp_err}" || true)"
  home_err="$(cat "${tmp_err}" || true)"
  rm -f "${tmp_err}"
  if [[ "${home_code}" =~ ^2|^3 ]]; then
    home_ok=1
    break
  fi
  sleep 1
 done

if [[ "${home_ok}" -ne 1 ]]; then
  fail "HOME_HTTP_FAIL" "code=${home_code} err=${home_err}"
fi

log "home_head: ${home_code}"

www_code=""
www_location=""
www_ok=0
for attempt in 1 2 3; do
  tmp_headers="$(mktemp)"
  www_code="$(curl -sS --connect-timeout 5 -m 15 -I -D "${tmp_headers}" -o /dev/null -w "%{http_code}" "https://${WWW_DOMAIN}/" 2>/dev/null || true)"
  www_location="$(awk -F': ' 'tolower($1)=="location"{print $2}' "${tmp_headers}" | tr -d '\r' | tail -n1 || true)"
  rm -f "${tmp_headers}"
  if [[ "${www_code}" == "301" ]] && [[ "${www_location}" == https://${APEX_DOMAIN}/* ]]; then
    www_ok=1
    break
  fi
  sleep 1
done

if [[ "${www_ok}" -ne 1 ]]; then
  fail "CANONICAL_REDIRECT_BROKEN" "www_code=${www_code} location=${www_location}"
fi

log "www_redirect: ${www_code}"

http_code=""
http_location=""
http_ok=0
for attempt in 1 2 3; do
  tmp_headers="$(mktemp)"
  http_code="$(curl -sS --connect-timeout 5 -m 15 -I -D "${tmp_headers}" -o /dev/null -w "%{http_code}" "http://${APEX_DOMAIN}/" 2>/dev/null || true)"
  http_location="$(awk -F': ' 'tolower($1)=="location"{print $2}' "${tmp_headers}" | tr -d '\r' | tail -n1 || true)"
  rm -f "${tmp_headers}"
  if [[ "${http_code}" == "301" ]] && [[ "${http_location}" == https://${APEX_DOMAIN}/* ]]; then
    http_ok=1
    break
  fi
  sleep 1
done

if [[ "${http_ok}" -ne 1 ]]; then
  fail "CANONICAL_REDIRECT_BROKEN" "http_code=${http_code} location=${http_location}"
fi

log "http_redirect: ${http_code}"

robots_code=""
robots_err=""
robots_ok=0
for attempt in 1 2 3; do
  tmp_err="$(mktemp)"
  robots_code="$(curl -sS --connect-timeout 5 -m 15 -o /dev/null -w "%{http_code}" "https://${DOMAIN}/robots.txt" 2>"${tmp_err}" || true)"
  robots_err="$(cat "${tmp_err}" || true)"
  rm -f "${tmp_err}"
  if [[ "${robots_code}" == "200" || "${robots_code}" == "404" ]]; then
    robots_ok=1
    break
  fi
  sleep 1
 done

if [[ "${robots_ok}" -ne 1 ]]; then
  log "robots_warn: code=${robots_code} err=${robots_err}"
else
  log "robots: ${robots_code}"
fi

log "PROD_CHECK PASS"
