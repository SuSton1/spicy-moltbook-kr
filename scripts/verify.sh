#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

trap 'echo "==> verify failed" >&2' ERR

if [ ! -f package.json ]; then
  echo "package.json not found in $ROOT_DIR" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run checks" >&2
  exit 1
fi

needs_install=0
if [ ! -d node_modules ]; then
  needs_install=1
else
  if ! npm ls --silent >/dev/null 2>&1; then
    needs_install=1
  fi
fi

if [ -f package-lock.json ]; then
  LOCK_HASH_FILE="node_modules/.verify-package-lock.sha256"

  lock_hash() {
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum package-lock.json | awk '{print $1}'
      return
    fi
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 package-lock.json | awk '{print $1}'
      return
    fi
    node - <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const hash = crypto.createHash("sha256");
hash.update(fs.readFileSync("package-lock.json"));
process.stdout.write(hash.digest("hex"));
NODE
  }

  current_lock_hash="$(lock_hash)"
  if [ -f "$LOCK_HASH_FILE" ]; then
    saved_lock_hash="$(cat "$LOCK_HASH_FILE" | tr -d '\r\n' || true)"
    if [ "$saved_lock_hash" != "$current_lock_hash" ]; then
      needs_install=1
    fi
  else
    if [ "$needs_install" -eq 0 ]; then
      echo "$current_lock_hash" >"$LOCK_HASH_FILE"
    else
      needs_install=1
    fi
  fi
fi

if [ "$needs_install" -eq 1 ]; then
  echo "==> installing dependencies"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  if [ -f package-lock.json ]; then
    if [ -n "${LOCK_HASH_FILE:-}" ] && [ -n "${current_lock_hash:-}" ]; then
      echo "$current_lock_hash" >"$LOCK_HASH_FILE"
    fi
  fi
fi

has_script() {
  local name="$1"
  local value
  value="$(npm pkg get "scripts.$name" 2>/dev/null || echo null)"
  value="$(echo "$value" | tr -d '\r\n')"
  [ "$value" != "null" ]
}

run_script() {
  local name="$1"
  echo "==> npm run $name"
  npm run "$name"
}

if has_script "format:check"; then
  run_script "format:check"
else
  echo "==> skip: npm run format:check (not defined)"
fi

if has_script lint; then
  run_script lint
else
  echo "==> skip: npm run lint (not defined)"
fi

if has_script typecheck; then
  run_script typecheck
else
  echo "==> skip: npm run typecheck (not defined)"
fi

if has_script test; then
  run_script test
else
  if [ "${ALLOW_NO_TESTS:-}" = "1" ]; then
    echo "==> skip: npm run test (not defined)"
  else
    echo "==> ERROR: npm run test not defined"
    exit 2
  fi
fi

if has_script build; then
  run_script build
else
  echo "==> skip: npm run build (not defined)"
fi

echo "==> verify complete"
