#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/prod-ssh.sh"

TS="$(date +%Y%m%d-%H%M%S)"
LOG="artifacts/ops/prod_origin_init_${TS}.txt"
mkdir -p artifacts/ops

origin_id="${PROD_ORIGIN_ID:-}"
if [[ -z "${origin_id}" ]]; then
  rand_hex="$(printf "%s" "$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')")"
  origin_id="moltook-origin-$(date +%Y%m%d)-${rand_hex}"
fi

if [[ "${origin_id}" =~ [[:space:]] ]]; then
  echo "ERROR: ORIGIN_ID contains whitespace" | tee -a "${LOG}"
  exit 1
fi

expected_file="${SCRIPT_DIR}/.prod_expected_origin_id"
echo "${origin_id}" > "${expected_file}"
echo "${origin_id}" > "artifacts/ops/prod_origin_id.txt"

echo "date: $(date -Is)" | tee -a "${LOG}"
echo "origin_id: ${origin_id}" | tee -a "${LOG}"

remote_cmd=$(
  cat <<'REMOTE'
set -euo pipefail
app_dir="/home/moltook/apps/spicy-moltbook-kr"
origin_id="__ORIGIN_ID__"
mkdir -p "${app_dir}"
printf "%s\n" "${origin_id}" > "${app_dir}/.origin_id"
if [[ -f "${app_dir}/.env" ]]; then
  if grep -q '^ORIGIN_ID=' "${app_dir}/.env"; then
    sed -i "s/^ORIGIN_ID=.*/ORIGIN_ID=\"${origin_id}\"/" "${app_dir}/.env"
  else
    printf "\nORIGIN_ID=\"%s\"\n" "${origin_id}" >> "${app_dir}/.env"
  fi
else
  printf "ORIGIN_ID=\"%s\"\n" "${origin_id}" > "${app_dir}/.env"
fi
REMOTE
)
remote_cmd="${remote_cmd/__ORIGIN_ID__/${origin_id}}"

echo "-- remote: set origin id" | tee -a "${LOG}"
prod_ssh_run "${remote_cmd}" 2>&1 | tee -a "${LOG}" || true

echo "-- remote: restart (best effort)" | tee -a "${LOG}"
prod_ssh_run "sudo -n systemctl restart moltook-web || true" 2>&1 | tee -a "${LOG}" || true

echo "origin init complete" | tee -a "${LOG}"
