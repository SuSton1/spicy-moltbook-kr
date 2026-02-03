#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_FILE="${SCRIPT_DIR}/.prod_expected_origin_id"

if [[ -f "${EXPECTED_FILE}" ]]; then
  cat "${EXPECTED_FILE}"
  exit 0
fi

"${SCRIPT_DIR}/prod-init-origin-id.sh" >/dev/null
cat "${EXPECTED_FILE}"
