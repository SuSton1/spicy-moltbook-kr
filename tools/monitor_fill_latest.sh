#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"
LOG_DIR="${ROOT}/logs"

if [[ ! -d "${LOG_DIR}" ]]; then
  echo "logs dir not found: ${LOG_DIR}" >&2
  exit 1
fi

latest_pid="$(find "${LOG_DIR}" -maxdepth 1 -type f -name 'fill_public_kr_daily_*.pid' | sort | tail -n 1)"
latest_log="$(find "${LOG_DIR}" -maxdepth 1 -type f -name 'fill_public_kr_daily_*.log' | sort | tail -n 1)"

if [[ -z "${latest_pid}" && -z "${latest_log}" ]]; then
  echo "no fill log/pid found under ${LOG_DIR}" >&2
  exit 1
fi

echo "root=${ROOT}"
echo "log=${latest_log:-N/A}"
echo "pid_file=${latest_pid:-N/A}"

if [[ -n "${latest_pid}" ]]; then
  pid="$(cat "${latest_pid}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    echo "status=running pid=${pid}"
  else
    echo "status=stopped pid=${pid:-unknown}"
  fi
fi

if [[ -n "${latest_log}" ]]; then
  echo "--- last progress ---"
  grep -E '^(START|PROGRESS|DONE|SUMMARY|WARN|ABORT|FATAL)' "${latest_log}" | tail -n 20 || true
  echo "--- tail ---"
  tail -n 20 "${latest_log}" || true
fi
