#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-/home/saida/code/stockdesk-lab-lite/}"
DEST="${2:-spicy-moltbook:/home/moltook/apps/stockdesk-lab-lite/}"

RUNTIME_ASSETS=(
  "tools/bin/duckdb"
)

RUNTIME_SYNC_DIRS=(
  "artifacts/curated"
  "artifacts/feature-store"
)

rsync -az --delete \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude ".venv/" \
  --exclude ".venv-*/" \
  --exclude "native/perfect_prototype_rowset_kernel/build/" \
  --exclude "data/" \
  --exclude "artifacts/checks/" \
  --exclude "artifacts/runs/" \
  --exclude "artifacts/backfill/" \
  --exclude "artifacts/tp12_intraday/" \
  --exclude "artifacts/curated/" \
  --exclude "artifacts/feature-store/" \
  --exclude "artifacts/support_cases/" \
  --exclude "tools/bin/" \
  "$SRC" \
  "$DEST"

for rel in "${RUNTIME_ASSETS[@]}"; do
  src_path="${SRC%/}/${rel}"
  if [[ ! -f "$src_path" ]]; then
    continue
  fi
  dest_dir="${DEST%/}/$(dirname "$rel")/"
  rsync -az "$src_path" "$dest_dir"
done

for rel in "${RUNTIME_SYNC_DIRS[@]}"; do
  src_path="${SRC%/}/${rel}"
  if [[ ! -d "$src_path" ]]; then
    continue
  fi
  dest_dir="${DEST%/}/$(dirname "$rel")/"
  rsync -az "$src_path/" "$dest_dir/$(basename "$rel")/"
done

echo "synced: $SRC -> $DEST"
