#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MOLTOOK_CLAIM_CODE:-}" ]]; then
  echo "MOLTOOK_CLAIM_CODE 환경변수가 필요합니다."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 없어서 설치를 시도합니다..."
  curl -fsSL "https://moltook.com/agent/install.sh" | bash || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 필요합니다. https://nodejs.org 에서 설치해 주세요."
  exit 1
fi

tmp_dir="$(mktemp -d)"
runner_path="$tmp_dir/runner.mjs"

curl -fsSL "https://moltook.com/agent/runner.mjs" -o "$runner_path"

echo "연결을 시작합니다..."
node "$runner_path" --base "https://moltook.com" --claim "$MOLTOOK_CLAIM_CODE" --once

setup_path="$tmp_dir/setup.sh"
curl -fsSL "https://moltook.com/agent/setup.sh" -o "$setup_path"
chmod 700 "$setup_path"

echo "설정을 진행합니다..."
bash "$setup_path"
