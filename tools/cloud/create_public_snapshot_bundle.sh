#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF' >&2
create_public_snapshot_bundle.sh

Creates a Codex Cloud-ready snapshot bundle on the server:
1) runs tools/backup_snapshot.sh (full|light)
2) collects latest run metadata
3) writes bundle manifest
4) archives to .tar.zst (or .tar.gz fallback)

Usage:
  bash tools/cloud/create_public_snapshot_bundle.sh [options]

Options:
  --tag=STRING                snapshot tag suffix (default: codex_cloud)
  --mode=full|light           backup mode passed to backup_snapshot.sh (default: full)
  --keep=N                    backup retention count (default: 6)
  --include-latest-runs=1|0   include latest autosearch artifact copies (default: 1)
  --out-dir=PATH              output directory (default: artifacts/cloud_snapshots)
EOF
}

TAG="codex_cloud"
MODE="full"
KEEP="6"
INCLUDE_LATEST_RUNS="1"
OUT_DIR="artifacts/cloud_snapshots"

for arg in "$@"; do
  case "$arg" in
    --tag=*)
      TAG="${arg#--tag=}"
      ;;
    --mode=*)
      MODE="$(echo "${arg#--mode=}" | tr '[:upper:]' '[:lower:]')"
      ;;
    --keep=*)
      KEEP="${arg#--keep=}"
      ;;
    --include-latest-runs=*)
      INCLUDE_LATEST_RUNS="${arg#--include-latest-runs=}"
      ;;
    --out-dir=*)
      OUT_DIR="${arg#--out-dir=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[cloud-snapshot] unknown arg: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "full" && "$MODE" != "light" ]]; then
  echo "[cloud-snapshot] invalid --mode=$MODE (use full|light)" >&2
  exit 2
fi

export NO_KIS=1
export BACKFILL_DISABLE_KIS=1
export BACKFILL_NO_KIS=1
export BACKFILL_KIS_ENABLED=0

timestamp="$(date +%Y%m%d_%H%M%S)"
safe_tag="$(
  echo "$TAG" \
    | tr -cs 'A-Za-z0-9._+-' '_' \
    | sed 's/^_*//;s/_*$//'
)"
if [[ -z "$safe_tag" ]]; then
  safe_tag="codex_cloud"
fi

mkdir -p "$OUT_DIR"
bundle_dir="$OUT_DIR/${timestamp}_${safe_tag}"
mkdir -p "$bundle_dir"

echo "[cloud-snapshot] creating base backup (mode=$MODE keep=$KEEP)"
bash tools/backup_snapshot.sh --tag="${safe_tag}" --mode="$MODE" --keep="$KEEP"

snapshot_link="backups/snapshots/latest"
if [[ ! -L "$snapshot_link" && ! -d "$snapshot_link" ]]; then
  echo "[cloud-snapshot] backup snapshot link missing: $snapshot_link" >&2
  exit 1
fi
snapshot_dir="$(readlink -f "$snapshot_link")"
if [[ -z "$snapshot_dir" || ! -d "$snapshot_dir" ]]; then
  echo "[cloud-snapshot] failed to resolve snapshot dir from $snapshot_link" >&2
  exit 1
fi

cp -f "$snapshot_dir/meta.json" "$bundle_dir/backup_meta.json"
cp -f "$snapshot_dir/files.tgz" "$bundle_dir/files.tgz"
if [[ -f "$snapshot_dir/db.sql.gz" ]]; then
  cp -f "$snapshot_dir/db.sql.gz" "$bundle_dir/db.sql.gz"
fi

latest_autosearch_dir=""
latest_sharded_dir=""
if [[ "$INCLUDE_LATEST_RUNS" == "1" ]]; then
  latest_autosearch_dir="$(
    find artifacts/autosearch -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
      | sort | tail -n1
  )"
  latest_sharded_dir="$(
    find artifacts/autosearch_sharded -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
      | sort | tail -n1
  )"

  if [[ -n "$latest_autosearch_dir" && -d "$latest_autosearch_dir" ]]; then
    mkdir -p "$bundle_dir/artifacts/autosearch"
    cp -a "$latest_autosearch_dir" "$bundle_dir/artifacts/autosearch/"
  fi
  if [[ -n "$latest_sharded_dir" && -d "$latest_sharded_dir" ]]; then
    mkdir -p "$bundle_dir/artifacts/autosearch_sharded"
    cp -a "$latest_sharded_dir" "$bundle_dir/artifacts/autosearch_sharded/"
  fi
fi

manifest_path="$bundle_dir/cloud_snapshot_manifest.json"
cat > "$manifest_path" <<EOF
{
  "generatedAt": "$(date -Is)",
  "tag": "$safe_tag",
  "mode": "$MODE",
  "noKis": true,
  "rootDir": "$ROOT_DIR",
  "backupSnapshotDir": "$snapshot_dir",
  "includes": {
    "filesTgz": true,
    "dbSqlGz": $([[ -f "$bundle_dir/db.sql.gz" ]] && echo true || echo false),
    "latestAutosearchArtifact": $([[ -n "$latest_autosearch_dir" ]] && echo true || echo false),
    "latestShardedArtifact": $([[ -n "$latest_sharded_dir" ]] && echo true || echo false)
  },
  "latestArtifactPaths": {
    "autosearch": ${latest_autosearch_dir:+\"$latest_autosearch_dir\"},
    "sharded": ${latest_sharded_dir:+\"$latest_sharded_dir\"}
  },
  "recommendedCloudSetupScript": "tools/cloud/setup_from_snapshot.sh",
  "recommendedCloudRunScript": "tools/cloud/run_rampup_from_snapshot.sh"
}
EOF

archive_base="$OUT_DIR/${timestamp}_${safe_tag}"
if command -v zstd >/dev/null 2>&1; then
  archive_path="${archive_base}.tar.zst"
  tar -C "$bundle_dir" -cf - . | zstd -T0 -19 -o "$archive_path" >/dev/null
else
  archive_path="${archive_base}.tar.gz"
  tar -C "$bundle_dir" -czf "$archive_path" .
fi

sha256=""
if command -v sha256sum >/dev/null 2>&1; then
  sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
fi

echo "[cloud-snapshot] bundle_dir=$bundle_dir"
echo "[cloud-snapshot] archive_path=$archive_path"
if [[ -n "$sha256" ]]; then
  echo "[cloud-snapshot] archive_sha256=$sha256"
fi

