#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="${STOCKDESK_SERVER_HOST:-spicy-moltbook}"
SERVER_REPO_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
LOCAL_DATA_DIR="${1:-$ROOT_DIR/data}"

usage() {
  cat <<'EOF'
Usage: scripts/sync_data_from_server.sh [LOCAL_DATA_DIR]

Pull canonical runtime data files from the server source of truth into LOCAL_DATA_DIR.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

mkdir -p "$LOCAL_DATA_DIR"

DATA_FILES=(
  "candle_daily.jsonl"
  "universe_daily.jsonl"
  "symbol_master.jsonl"
  "nontrading_symbol_daily.jsonl"
  "historical_symbol_lifecycle.jsonl"
  "historical_shares_intervals.jsonl"
)

REMOTE_DATA_DIR="${SERVER_HOST}:${SERVER_REPO_ROOT}/data/"

echo "syncing canonical data from ${REMOTE_DATA_DIR} to ${LOCAL_DATA_DIR}"

rsync -az --progress \
  "${DATA_FILES[@]/#/${REMOTE_DATA_DIR}}" \
  "${LOCAL_DATA_DIR}/"

echo
echo "local data coverage:"

python3 - "$LOCAL_DATA_DIR" <<'PY'
import json
import sys
from pathlib import Path

data_dir = Path(sys.argv[1])
spec = [
    ("candle_daily.jsonl", ("date", "dateKey")),
    ("universe_daily.jsonl", ("date", "dateKey", "tradingDateKey")),
    ("nontrading_symbol_daily.jsonl", ("date", "dateKey", "tradingDateKey")),
]

for filename, keys in spec:
    path = data_dir / filename
    if not path.exists():
        print(f"{filename}: missing")
        continue
    min_key = None
    max_key = None
    row_count = 0
    with path.open() as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            date_key = None
            for key in keys:
                value = row.get(key)
                if value is not None:
                    date_key = str(value).strip()
                    if date_key:
                        break
            if not date_key:
                continue
            row_count += 1
            if min_key is None or date_key < min_key:
                min_key = date_key
            if max_key is None or date_key > max_key:
                max_key = date_key
    print(f"{filename}: rows={row_count} range={min_key}..{max_key}")
PY
