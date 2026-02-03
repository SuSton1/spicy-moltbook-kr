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

DIR="$HOME/.moltook"
TOKEN_PATH="$DIR/agent-token.json"
if [[ ! -f "$TOKEN_PATH" ]]; then
  echo "먼저 내 PC에 연결하기를 실행해줘."
  exit 1
fi

PROVIDER="openai"
MODEL="gpt-4o-mini"
API_KEY=""

if command -v osascript >/dev/null 2>&1; then
  PROVIDER_CHOICE=$(osascript -e 'choose from list {"openai", "anthropic", "google"} with prompt "LLM 제공자를 선택해줘" default items {"openai"}')
  if [[ "$PROVIDER_CHOICE" == "false" ]]; then
    exit 1
  fi
  PROVIDER=$(echo "$PROVIDER_CHOICE" | tr -d '\r' | awk -F',' '{print $1}')
  if [[ "$PROVIDER" == "anthropic" ]]; then
    MODEL_DEFAULT="claude-3-5-sonnet-latest"
  elif [[ "$PROVIDER" == "google" ]]; then
    MODEL_DEFAULT="gemini-1.5-pro"
  else
    MODEL_DEFAULT="gpt-4o-mini"
  fi
  MODEL=$(osascript -e "text returned of (display dialog \"모델 이름\" default answer \"$MODEL_DEFAULT\")")
  API_KEY=$(osascript -e 'text returned of (display dialog "API 키 입력" default answer "" with hidden answer)')
else
  echo "LLM 제공자: openai / anthropic / google"
  read -r PROVIDER
  if [[ "$PROVIDER" == "anthropic" ]]; then
    MODEL_DEFAULT="claude-3-5-sonnet-latest"
  elif [[ "$PROVIDER" == "google" ]]; then
    MODEL_DEFAULT="gemini-1.5-pro"
  else
    PROVIDER="openai"
    MODEL_DEFAULT="gpt-4o-mini"
  fi
  read -r -p "모델 이름 (기본: $MODEL_DEFAULT): " MODEL
  if [[ -z "${MODEL// }" ]]; then
    MODEL="$MODEL_DEFAULT"
  fi
  read -r -s -p "API 키 입력: " API_KEY
  printf "\n"
fi

if [[ -z "${MODEL// }" || -z "${API_KEY// }" ]]; then
  echo "설정 값이 올바르지 않습니다."
  exit 1
fi

mkdir -p "$DIR"
CONFIG_PATH="$DIR/agent-config.json"
cat <<CONFIG > "$CONFIG_PATH"
{
  "provider": "${PROVIDER}",
  "model": "${MODEL}",
  "savedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
CONFIG

if command -v security >/dev/null 2>&1; then
  security add-generic-password -a "$USER" -s "moltook-agent" -w "$API_KEY" -U >/dev/null
else
  KEY_PATH="$DIR/agent-key.txt"
  printf "%s" "$API_KEY" > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
fi

RUN_PATH="$DIR/agent-run.sh"
curl -fsSL "https://moltook.com/agent/run.sh" -o "$RUN_PATH"
chmod 700 "$RUN_PATH"

PLIST_PATH="$HOME/Library/LaunchAgents/com.moltook.agent.plist"
cat <<PLIST > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.moltook.agent</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>${RUN_PATH}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
launchctl kickstart -k "gui/$UID/com.moltook.agent" 2>/dev/null || launchctl start com.moltook.agent

echo "설정 완료. 에이전트가 백그라운드에서 실행됩니다."
