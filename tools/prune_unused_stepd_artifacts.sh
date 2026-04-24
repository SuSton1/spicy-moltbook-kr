#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: tools/prune_unused_stepd_artifacts.sh [--apply] [--root PATH]

Deletes step-d candidate index / feature-pack artifacts only when the paired
step-e summary explicitly reports both of them as unused.

Default mode is dry-run.
EOF
}

APPLY=0
ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --root)
      ROOT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ROOT" ]]; then
  ROOT="$(pwd)"
fi

python3 - "$ROOT" "$APPLY" <<'PY'
import json
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
apply_mode = sys.argv[2] == "1"
runs_root = root / "artifacts" / "runs"

target_names = [
    "decision_candidates_feature_pack.jsonl",
    "decision_candidates_feature_pack_meta.json",
    "decision_candidates_index.jsonl",
    "decision_candidates_index_meta.json",
]

delete_candidates = []
summary_count = 0
for summary_path in runs_root.glob("**/step-e/step_e_summary.json"):
    summary_count += 1
    try:
      data = json.loads(summary_path.read_text())
    except Exception:
      continue
    feature_used = bool(((data.get("candidateFeaturePackSource") or {}).get("used")) is True)
    index_used = bool(((data.get("candidateIndexSource") or {}).get("used")) is True)
    if feature_used or index_used:
      continue
    run_dir = summary_path.parent.parent
    step_d_dir = run_dir / "step-d"
    for name in target_names:
      file_path = step_d_dir / name
      if file_path.exists():
        delete_candidates.append(file_path)

total_bytes = 0
for path in delete_candidates:
  try:
    total_bytes += path.stat().st_size
  except OSError:
    pass

print(f"runs_root={runs_root}")
print(f"step_e_summaries_scanned={summary_count}")
print(f"candidate_files_matched={len(delete_candidates)}")
print(f"candidate_bytes_matched={total_bytes}")
print(f"mode={'apply' if apply_mode else 'dry-run'}")

for path in delete_candidates:
  print(path)

if apply_mode:
  removed = 0
  removed_bytes = 0
  for path in delete_candidates:
    try:
      size = path.stat().st_size
    except OSError:
      size = 0
    try:
      path.unlink()
      removed += 1
      removed_bytes += size
    except FileNotFoundError:
      pass
  print(f"removed_files={removed}")
  print(f"removed_bytes={removed_bytes}")
PY
