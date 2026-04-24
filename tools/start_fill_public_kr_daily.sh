#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PYTHON_BIN="${PYTHON_BIN:-.venv-datafill/bin/python}"
if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python runtime not found: ${PYTHON_BIN}" >&2
  exit 1
fi

mkdir -p logs artifacts/backups

run_foreground=0
run_dry_run=0
pass_args=()
for arg in "$@"; do
  case "${arg}" in
    --foreground)
      run_foreground=1
      ;;
    --dry-run)
      run_foreground=1
      run_dry_run=1
      ;;
  esac
  if [[ "${arg}" != "--foreground" ]]; then
    pass_args+=("${arg}")
  fi
done

default_args=(
  "--config=config/lab.config.server.lite.json"
  "--rewind-days=1"
  "--refresh-symbol-master"
  "--max-workers=8"
  "--universe-mode=all_common"
  "--update-anchor"
)

cmd=(
  "${PYTHON_BIN}"
  "tools/fill_public_kr_daily.py"
  "${default_args[@]}"
  "${pass_args[@]}"
)

if (( run_dry_run == 1 )); then
  printf 'mode=foreground cmd='
  printf '%q ' "${cmd[@]}"
  printf '\n'
  exec "${cmd[@]}"
fi

ts="$(date +%Y%m%d_%H%M%S)"
backup_dir="artifacts/backups/data_fill_${ts}"
mkdir -p "${backup_dir}"

for rel in \
  data/candle_daily.jsonl \
  data/nontrading_symbol_daily.jsonl \
  data/universe_daily.jsonl \
  data/symbol_master.jsonl \
  config/lab.config.server.lite.json
do
  if [[ -f "${rel}" ]]; then
    cp -f "${rel}" "${backup_dir}/"
  fi
done

log="logs/fill_public_kr_daily_${ts}.log"
pid_file="logs/fill_public_kr_daily_${ts}.pid"

if (( run_foreground == 1 )); then
  printf '%s\n' "$$" > "${pid_file}"
  echo "root=${ROOT}"
  echo "backup_dir=${backup_dir}"
  echo "log=${log}"
  echo "pid_file=${pid_file}"
  echo "pid=$$"
  printf 'cmd='
  printf '%q ' "${cmd[@]}"
  printf '\n'
  exec "${cmd[@]}" > >(tee -a "${log}") 2>&1
fi

nohup "${cmd[@]}" > "${log}" 2>&1 < /dev/null &
pid="$!"
printf '%s\n' "${pid}" > "${pid_file}"

echo "root=${ROOT}"
echo "backup_dir=${backup_dir}"
echo "log=${log}"
echo "pid_file=${pid_file}"
echo "pid=${pid}"
printf 'cmd='
printf '%q ' "${cmd[@]}"
printf '\n'
echo "monitor=bash tools/monitor_fill_latest.sh ${ROOT}"
