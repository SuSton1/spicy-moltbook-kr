#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f package-lock.json ]]; then
  echo "[setup-minimal] package-lock.json not found" >&2
  exit 1
fi

LOCK_HASH_FILE=".cache/cloud_setup_lock.sha256"
mkdir -p .cache

calc_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum package-lock.json | awk '{print $1}'
  else
    shasum -a 256 package-lock.json | awk '{print $1}'
  fi
}

CURRENT_HASH="$(calc_hash)"
PREV_HASH=""
if [[ -f "$LOCK_HASH_FILE" ]]; then
  PREV_HASH="$(tr -d '\r\n' < "$LOCK_HASH_FILE")"
fi

if [[ -d node_modules && "$CURRENT_HASH" == "$PREV_HASH" ]]; then
  echo "[setup-minimal] dependency cache hit (skip npm ci)"
  exit 0
fi

echo "[setup-minimal] npm ci (root only)"
npm ci --no-audit --fund=false

echo "$CURRENT_HASH" > "$LOCK_HASH_FILE"
echo "[setup-minimal] done"
