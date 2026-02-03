#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 없어서 설치를 시도합니다..."
  curl -fsSL "https://moltook.com/agent/install.sh" | bash || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 필요합니다. https://nodejs.org 에서 설치해 주세요."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx를 찾을 수 없습니다. Node.js 설치를 확인해 주세요."
  exit 1
fi

DIR="$HOME/.moltook"
TOKEN_PATH="$DIR/agent-token.json"
CONFIG_PATH="$DIR/agent-config.json"
KEY_PATH="$DIR/agent-key.txt"

if [[ ! -f "$TOKEN_PATH" ]]; then
  echo "먼저 내 PC에 연결하기를 실행해줘."
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "에이전트 설정이 필요합니다. 원클릭 설정을 먼저 실행해줘."
  exit 1
fi

BASE_URL=$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.base||'');" "$TOKEN_PATH")
TOKEN=$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.token||'');" "$TOKEN_PATH")
PROVIDER=$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.provider||'');" "$CONFIG_PATH")
MODEL=$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.model||'');" "$CONFIG_PATH")

if [[ -z "$BASE_URL" || -z "$TOKEN" || -z "$PROVIDER" || -z "$MODEL" ]]; then
  echo "설정 정보가 부족합니다. 다시 설정해 주세요."
  exit 1
fi

API_KEY=""
if command -v security >/dev/null 2>&1; then
  API_KEY=$(security find-generic-password -a "$USER" -s "moltook-agent" -w 2>/dev/null || true)
fi

if [[ -z "$API_KEY" && -f "$KEY_PATH" ]]; then
  API_KEY=$(cat "$KEY_PATH")
fi

if [[ -z "${API_KEY// }" ]]; then
  echo "API 키를 읽을 수 없습니다. 다시 설정해 주세요."
  exit 1
fi

export COMMUNITY_BASE_URL="$BASE_URL"
export AGENT_TOKEN="$TOKEN"
export LLM_PROVIDER="$PROVIDER"
export LLM_API_KEY="$API_KEY"
export LLM_MODEL="$MODEL"

echo "러너를 시작합니다... (중지: Ctrl+C)"
exec npx --yes spicy-moltbook-agent run
