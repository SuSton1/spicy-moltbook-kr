#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

trap 'echo "==> verify failed" >&2' ERR

VERIFY_PROFILE="${VERIFY_PROFILE:-full}"
for arg in "$@"; do
  case "$arg" in
    --fast)
      VERIFY_PROFILE="fast"
      ;;
    --full)
      VERIFY_PROFILE="full"
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/verify.sh [--fast|--full]

Profiles:
  --fast  : policy/spec/evidence checks only (quick loop)
  --full  : full gate (lint/typecheck/test/build)
USAGE
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "$VERIFY_PROFILE" != "fast" && "$VERIFY_PROFILE" != "full" ]]; then
  echo "VERIFY_PROFILE must be fast|full (current: $VERIFY_PROFILE)" >&2
  exit 2
fi

if [ ! -f package.json ]; then
  echo "package.json not found in $ROOT_DIR" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run checks" >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if ! [[ "$node_major" =~ ^[0-9]+$ ]]; then
  node_major=0
fi
if (( node_major < 20 )); then
  if [ "${VERIFY_REQUIRE_NODE20:-0}" = "1" ]; then
    echo "verify requires Node.js >= 20 (current: $(node -v 2>/dev/null || echo unknown))." >&2
    echo "hint: on server run 'export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\"; nvm use 20'" >&2
    exit 1
  fi
  echo "==> warn: node major $node_major detected (<20); continuing with reduced verify (build may be skipped)" >&2
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
  local started_at
  started_at="$(date +%s)"
  npm run "$name"
  local ended_at
  ended_at="$(date +%s)"
  echo "==> done: npm run $name (${name}) elapsed=$((ended_at - started_at))s"
}

run_script_with_timeout() {
  local name="$1"
  local timeout_sec="$2"
  echo "==> npm run $name (timeout=${timeout_sec}s)"
  local started_at
  started_at="$(date +%s)"
  if command -v timeout >/dev/null 2>&1; then
    timeout "${timeout_sec}" npm run "$name"
  else
    npm run "$name"
  fi
  local ended_at
  ended_at="$(date +%s)"
  echo "==> done: npm run $name (${name}) elapsed=$((ended_at - started_at))s"
}

if [[ "$VERIFY_PROFILE" == "fast" ]] && has_script "format:check:quick"; then
  run_script "format:check:quick"
elif has_script "format:check"; then
  run_script "format:check"
else
  echo "==> skip: npm run format:check (not defined)"
fi

if has_script "sync:policy-docs"; then
  run_script "sync:policy-docs"
else
  echo "==> skip: npm run sync:policy-docs (not defined)"
fi

if has_script "check:agent-sync"; then
  run_script "check:agent-sync"
else
  echo "==> skip: npm run check:agent-sync (not defined)"
fi

if has_script "check:policy-sync"; then
  run_script "check:policy-sync"
else
  echo "==> skip: npm run check:policy-sync (not defined)"
fi

if has_script "check:spec-coverage"; then
  run_script "check:spec-coverage"
else
  echo "==> skip: npm run check:spec-coverage (not defined)"
fi

if has_script "generate:req-evidence"; then
  run_script "generate:req-evidence"
else
  echo "==> skip: npm run generate:req-evidence (not defined)"
fi

if has_script "check:req-evidence"; then
  run_script "check:req-evidence"
else
  echo "==> skip: npm run check:req-evidence (not defined)"
fi

if [[ "$VERIFY_PROFILE" == "fast" ]]; then
  echo "==> verify complete (profile=fast)"
  exit 0
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
  verify_test_timeout_sec="${VERIFY_TEST_TIMEOUT_SEC:-1800}"
  if [ "${verify_test_timeout_sec}" -gt 0 ] 2>/dev/null; then
    run_script_with_timeout test "${verify_test_timeout_sec}"
  else
    run_script test
  fi
else
  if [ "${ALLOW_NO_TESTS:-}" = "1" ]; then
    echo "==> skip: npm run test (not defined)"
  else
    echo "==> ERROR: npm run test not defined"
    exit 2
  fi
fi

if has_script build; then
  node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  min_build_node_major="${VERIFY_BUILD_MIN_NODE_MAJOR:-20}"
  enforce_build="${VERIFY_ENFORCE_BUILD:-0}"
  if ! [[ "$node_major" =~ ^[0-9]+$ ]]; then
    node_major=0
  fi
  if ! [[ "$min_build_node_major" =~ ^[0-9]+$ ]]; then
    min_build_node_major=20
  fi
  if [ "$node_major" -lt "$min_build_node_major" ] && [ "$enforce_build" != "1" ]; then
    echo "==> skip: npm run build (node major $node_major < required $min_build_node_major; set VERIFY_ENFORCE_BUILD=1 to force)"
  else
    if [ "$node_major" -lt "$min_build_node_major" ]; then
      echo "==> node major $node_major < required $min_build_node_major, but VERIFY_ENFORCE_BUILD=1 so running build"
    fi
    run_script build
  fi
else
  echo "==> skip: npm run build (not defined)"
fi

echo "==> verify complete (profile=full)"
