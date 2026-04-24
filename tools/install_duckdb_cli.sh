#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-v1.4.4}"
ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

if [[ "$OS" != "linux" ]]; then
  echo "unsupported OS: $OS (expected linux)" >&2
  exit 1
fi

case "$ARCH" in
  x86_64) ARCH_TAG="amd64" ;;
  aarch64|arm64) ARCH_TAG="arm64" ;;
  *)
    echo "unsupported arch: $ARCH (expected x86_64 or arm64)" >&2
    exit 1
    ;;
esac

mkdir -p tools/bin
URL="https://github.com/duckdb/duckdb/releases/download/${VERSION}/duckdb_cli-${OS}-${ARCH_TAG}.gz"

echo "download: $URL"
curl -L --fail -o tools/bin/duckdb.gz "$URL"
gunzip -f tools/bin/duckdb.gz
chmod +x tools/bin/duckdb

echo "installed: $ROOT_DIR/tools/bin/duckdb"
tools/bin/duckdb --version
