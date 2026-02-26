#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF' >&2
upload_snapshot_bundle.sh

Uploads snapshot archive to object storage using a pre-signed PUT URL.

Usage:
  bash tools/cloud/upload_snapshot_bundle.sh --file=PATH --put-url=URL [--content-type=...]

Options:
  --file=PATH         archive path (.tar.zst or .tar.gz)
  --put-url=URL       pre-signed PUT URL
  --content-type=...  default: application/octet-stream
EOF
}

ARCHIVE_FILE=""
PUT_URL=""
CONTENT_TYPE="application/octet-stream"

for arg in "$@"; do
  case "$arg" in
    --file=*)
      ARCHIVE_FILE="${arg#--file=}"
      ;;
    --put-url=*)
      PUT_URL="${arg#--put-url=}"
      ;;
    --content-type=*)
      CONTENT_TYPE="${arg#--content-type=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-upload] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$ARCHIVE_FILE" || -z "$PUT_URL" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$ARCHIVE_FILE" ]]; then
  echo "[cloud-upload] archive not found: $ARCHIVE_FILE" >&2
  exit 1
fi

echo "[cloud-upload] uploading file=$(basename "$ARCHIVE_FILE")"
curl --fail --show-error --silent \
  -X PUT \
  -H "Content-Type: $CONTENT_TYPE" \
  --upload-file "$ARCHIVE_FILE" \
  "$PUT_URL"

echo "[cloud-upload] upload complete"

