#!/usr/bin/env bash
set -euo pipefail

if command -v node >/dev/null 2>&1; then
  echo "Node.js가 이미 설치되어 있습니다."
  exit 0
fi

echo "Node.js 설치를 시작합니다..."

if command -v brew >/dev/null 2>&1; then
  brew install node
elif command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y nodejs npm
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y nodejs
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y nodejs
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -Sy --noconfirm nodejs npm
elif command -v apk >/dev/null 2>&1; then
  sudo apk add --no-cache nodejs npm
else
  echo "Node.js가 필요합니다. https://nodejs.org 에서 설치해 주세요."
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  echo "Node.js 설치 완료"
  exit 0
fi

echo "Node.js 설치를 확인할 수 없습니다. 다시 실행해 주세요."
exit 1
