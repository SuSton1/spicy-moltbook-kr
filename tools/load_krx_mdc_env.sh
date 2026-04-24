#!/usr/bin/env bash
set -euo pipefail

default_env_file="${HOME}/.secrets/krx_mdc.env"
krx_env_file="${KRX_MDC_ENV_FILE:-${default_env_file}}"

if [[ -n "${KRX_ID:-}" && -n "${KRX_PW:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

if [[ -f "${krx_env_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${krx_env_file}"
  set +a
fi

if [[ -z "${KRX_ID:-}" || -z "${KRX_PW:-}" ]]; then
  echo "missing KRX_ID/KRX_PW for KRX historical contract. export them or provide ${krx_env_file}" >&2
  exit 1
fi
