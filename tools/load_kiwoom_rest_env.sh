#!/usr/bin/env bash
set -euo pipefail

default_env_file="${HOME}/.secrets/kiwoom_rest.env"
kiwoom_env_file="${KIWOOM_REST_ENV_FILE:-${default_env_file}}"

if [[ -n "${KIWOOM_APP_KEY:-}" && -n "${KIWOOM_SECRET_KEY:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

if [[ -f "${kiwoom_env_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${kiwoom_env_file}"
  set +a
fi

if [[ -z "${KIWOOM_APP_KEY:-}" || -z "${KIWOOM_SECRET_KEY:-}" ]]; then
  echo "missing KIWOOM_APP_KEY/KIWOOM_SECRET_KEY for Kiwoom REST contract. export them or provide ${kiwoom_env_file}" >&2
  exit 1
fi
