#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${PROD_DOMAIN:-moltook.com}"
APEX_DOMAIN="${DOMAIN#www.}"
WWW_DOMAIN="www.${APEX_DOMAIN}"
EXPECT_ORIGIN_ID="${PROD_EXPECT_ORIGIN_ID:-}"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="artifacts/ops/prod_diagnose_${TS}.txt"

mkdir -p artifacts/ops

log() {
  echo "$*" | tee -a "${LOG}"
}

if [[ -z "${EXPECT_ORIGIN_ID}" ]]; then
  EXPECT_ORIGIN_ID="$(${SCRIPT_DIR}/prod-origin-id.sh 2>/dev/null || true)"
fi

log "date: $(date -Is)"
log "log_file: ${LOG}"
log "domain: ${DOMAIN}"
log "apex_domain: ${APEX_DOMAIN}"
log "www_domain: ${WWW_DOMAIN}"
log "expect_origin_id: ${EXPECT_ORIGIN_ID}"

log "-- dns: getent"
getent hosts "${DOMAIN}" 2>&1 | tee -a "${LOG}" || true

if command -v dig >/dev/null 2>&1; then
  log "-- dns: dig 1.1.1.1"
  dig +short A "${DOMAIN}" @1.1.1.1 2>&1 | tee -a "${LOG}" || true
  log "-- dns: dig 8.8.8.8"
  dig +short A "${DOMAIN}" @8.8.8.8 2>&1 | tee -a "${LOG}" || true
fi

health_url="https://${DOMAIN}/api/health?ts=${TS}"
log "-- curl: health"
health_headers="$(mktemp)"
health_body_file="$(mktemp)"
health_err_file="$(mktemp)"
health_code="$(curl -sS --connect-timeout 5 -m 15 -D "${health_headers}" -o "${health_body_file}" -w "%{http_code}" "${health_url}" 2>"${health_err_file}" || true)"
health_err="$(cat "${health_err_file}" || true)"
health_body="$(cat "${health_body_file}" || true)"
head -n 40 "${health_headers}" | tee -a "${LOG}" || true
printf "health_code: %s\n" "${health_code}" | tee -a "${LOG}"
if [[ -n "${health_err}" ]]; then
  printf "health_err: %s\n" "${health_err}" | tee -a "${LOG}"
fi
printf "health_body: %s\n" "$(echo "${health_body}" | head -c 500 | tr '\n' ' ')" | tee -a "${LOG}"

origin_header="$(awk -F': ' 'tolower($1)=="x-moltook-origin-id"{print $2}' "${health_headers}" | tr -d '\r' | tail -n1 || true)"
origin_body="$(echo "${health_body}" | sed -n 's/.*"originId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
cf_ray="$(awk -F': ' 'tolower($1)=="cf-ray"{print $2}' "${health_headers}" | tr -d '\r' | tail -n1 || true)"
if [[ -n "${cf_ray}" ]]; then
  log "cf-ray: ${cf_ray}"
fi

log "-- curl: home"
home_headers="$(mktemp)"
home_err_file="$(mktemp)"
home_code="$(curl -sS --connect-timeout 5 -m 15 -I -D "${home_headers}" -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>"${home_err_file}" || true)"
home_err="$(cat "${home_err_file}" || true)"
head -n 20 "${home_headers}" | tee -a "${LOG}" || true
printf "home_code: %s\n" "${home_code}" | tee -a "${LOG}"
if [[ -n "${home_err}" ]]; then
  printf "home_err: %s\n" "${home_err}" | tee -a "${LOG}"
fi

log "-- curl: www"
www_headers="$(mktemp)"
www_code="$(curl -sS --connect-timeout 5 -m 15 -I -D "${www_headers}" -o /dev/null -w "%{http_code}" "https://${WWW_DOMAIN}/" 2>/dev/null || true)"
www_location="$(awk -F': ' 'tolower($1)=="location"{print $2}' "${www_headers}" | tr -d '\r' | tail -n1 || true)"
printf "www_code: %s\n" "${www_code}" | tee -a "${LOG}"
printf "www_location: %s\n" "${www_location}" | tee -a "${LOG}"

log "-- curl: http"
http_headers="$(mktemp)"
http_code="$(curl -sS --connect-timeout 5 -m 15 -I -D "${http_headers}" -o /dev/null -w "%{http_code}" "http://${APEX_DOMAIN}/" 2>/dev/null || true)"
http_location="$(awk -F': ' 'tolower($1)=="location"{print $2}' "${http_headers}" | tr -d '\r' | tail -n1 || true)"
printf "http_code: %s\n" "${http_code}" | tee -a "${LOG}"
printf "http_location: %s\n" "${http_location}" | tee -a "${LOG}"

rm -f "${health_headers}" "${health_body_file}" "${health_err_file}" "${home_headers}" "${home_err_file}" "${www_headers}" "${http_headers}"

lower_body="$(echo "${health_body}" | tr '[:upper:]' '[:lower:]')"

if ! getent hosts "${DOMAIN}" >/dev/null 2>&1; then
  log "DIAG_CLASS: LOCAL_DNS"
  exit 1
fi

if [[ "${health_err}" =~ SSL|TLS|handshake|certificate ]]; then
  log "DIAG_CLASS: TLS_FAIL"
  exit 1
fi

if [[ "${lower_body}" == *"error 1020"* || ("${lower_body}" == *"access denied"* && "${lower_body}" == *"cloudflare"*) ]]; then
  log "DIAG_CLASS: CF_WAF_1020"
  exit 1
fi

if [[ "${lower_body}" == *"error 522"* ]]; then
  log "DIAG_CLASS: CF_522"
  exit 1
fi

if [[ "${www_code}" != "301" || "${www_location}" != https://${APEX_DOMAIN}/* ]]; then
  log "DIAG_CLASS: CANONICAL_REDIRECT_BROKEN"
  exit 1
fi

if [[ "${http_code}" != "301" || "${http_location}" != https://${APEX_DOMAIN}/* ]]; then
  log "DIAG_CLASS: CANONICAL_REDIRECT_BROKEN"
  exit 1
fi

if [[ "${health_code}" != "200" ]]; then
  log "DIAG_CLASS: ORIGIN_OR_APP_FAIL"
  exit 1
fi

origin_id="${origin_header:-${origin_body}}"
if [[ -z "${origin_id}" ]]; then
  log "DIAG_CLASS: ORIGIN_OR_APP_FAIL"
  exit 1
fi

if [[ -n "${EXPECT_ORIGIN_ID}" && "${origin_id}" != "${EXPECT_ORIGIN_ID}" ]]; then
  log "DIAG_CLASS: ORIGIN_ID_MISMATCH"
  exit 1
fi

log "DIAG_CLASS: PASS"
