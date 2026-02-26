#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF' >&2
setup_from_snapshot.sh

Codex Cloud setup helper:
1) install deps (npm ci)
2) download snapshot archive
3) extract snapshot payload
4) restore files.tgz into repo
5) optional DB restore from db.sql.gz (requires DB env + mysql client)

Usage:
  SNAPSHOT_URL=... bash tools/cloud/setup_from_snapshot.sh [options]

Options:
  --snapshot-url=URL     snapshot URL (or set SNAPSHOT_URL env)
  --snapshot-sha256=HEX  optional archive checksum validation
  --work-dir=PATH        extraction directory (default: .cloud_snapshot)
  --skip-db-restore      skip db.sql.gz restore even if present
EOF
}

SNAPSHOT_URL="${SNAPSHOT_URL:-}"
SNAPSHOT_SHA256="${SNAPSHOT_SHA256:-}"
WORK_DIR=".cloud_snapshot"
SKIP_DB_RESTORE=0

for arg in "$@"; do
  case "$arg" in
    --snapshot-url=*)
      SNAPSHOT_URL="${arg#--snapshot-url=}"
      ;;
    --snapshot-sha256=*)
      SNAPSHOT_SHA256="${arg#--snapshot-sha256=}"
      ;;
    --work-dir=*)
      WORK_DIR="${arg#--work-dir=}"
      ;;
    --skip-db-restore)
      SKIP_DB_RESTORE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-setup] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$SNAPSHOT_URL" ]]; then
  echo "[cloud-setup] SNAPSHOT_URL is required" >&2
  exit 2
fi

export NO_KIS=1
export BACKFILL_DISABLE_KIS=1
export BACKFILL_NO_KIS=1
export BACKFILL_KIS_ENABLED=0

echo "[cloud-setup] npm ci"
npm ci

mkdir -p "$WORK_DIR"
archive_path="$WORK_DIR/snapshot_bundle"

if [[ "$SNAPSHOT_URL" == *.tar.zst* ]]; then
  archive_path="${archive_path}.tar.zst"
elif [[ "$SNAPSHOT_URL" == *.tar.gz* || "$SNAPSHOT_URL" == *.tgz* ]]; then
  archive_path="${archive_path}.tar.gz"
else
  archive_path="${archive_path}.tar.zst"
fi

echo "[cloud-setup] download snapshot"
curl --fail --show-error --silent --location "$SNAPSHOT_URL" -o "$archive_path"

if [[ -n "$SNAPSHOT_SHA256" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    got="$(sha256sum "$archive_path" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    got="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
  else
    got=""
  fi
  if [[ -z "$got" || "$got" != "$SNAPSHOT_SHA256" ]]; then
    echo "[cloud-setup] snapshot sha256 mismatch expected=$SNAPSHOT_SHA256 got=${got:-unknown}" >&2
    exit 1
  fi
fi

extract_dir="$WORK_DIR/extracted"
rm -rf "$extract_dir"
mkdir -p "$extract_dir"

echo "[cloud-setup] extract bundle"
if [[ "$archive_path" == *.tar.zst ]]; then
  if ! command -v zstd >/dev/null 2>&1; then
    echo "[cloud-setup] zstd is required to extract .tar.zst bundle" >&2
    exit 1
  fi
  zstd -dc "$archive_path" | tar -xf - -C "$extract_dir"
else
  tar -xzf "$archive_path" -C "$extract_dir"
fi

if [[ ! -f "$extract_dir/files.tgz" ]]; then
  echo "[cloud-setup] files.tgz missing in snapshot bundle" >&2
  exit 1
fi

echo "[cloud-setup] restore files payload"
tar -xzf "$extract_dir/files.tgz" -C "$ROOT_DIR"

db_dump="$extract_dir/db.sql.gz"
if [[ "$SKIP_DB_RESTORE" -eq 1 || ! -f "$db_dump" ]]; then
  echo "[cloud-setup] skip db restore"
  exit 0
fi

if ! command -v mysql >/dev/null 2>&1; then
  echo "[cloud-setup] mysql client missing; cannot restore db.sql.gz" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[cloud-setup] DATABASE_URL missing; cannot restore db.sql.gz" >&2
  exit 1
fi

db_host="${DB_HOST:-}"
db_port="${DB_PORT:-3306}"
db_user="${DB_USER:-}"
db_name="${DB_NAME:-}"
db_password="${DB_PASSWORD:-}"

if [[ -z "$db_host" || -z "$db_user" || -z "$db_name" ]]; then
  echo "[cloud-setup] DB_HOST/DB_USER/DB_NAME required for db restore" >&2
  exit 1
fi

echo "[cloud-setup] restore db.sql.gz"
MYSQL_PWD="$db_password" \
  gunzip -c "$db_dump" \
  | mysql -h "$db_host" -P "$db_port" -u "$db_user" "$db_name"

echo "[cloud-setup] setup complete"

