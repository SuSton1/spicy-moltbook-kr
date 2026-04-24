#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tools/package_review_bundle.sh [source_root] [out_dir]

Example:
  tools/package_review_bundle.sh /home/moltook/apps/stockdesk-lab-lite /home/moltook/apps/stockdesk-lab-lite/artifacts/review_bundle_32
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SRC_ROOT="${1:-$(pwd)}"
OUT_DIR="${2:-$SRC_ROOT/artifacts/review_bundle_$(date +%Y%m%d_%H%M%S)}"

if [[ ! -d "$SRC_ROOT" ]]; then
  echo "[fatal] source root not found: $SRC_ROOT" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

copy_file_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -f "$src" "$dst"
  fi
}

copy_dir_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -d "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    rm -rf "$dst"
    cp -a "$src" "$dst"
  fi
}

# Core targets used in combined 32-review bundles.
copy_file_if_exists "$SRC_ROOT/reports/combined_report_32.json" "$OUT_DIR/reports/combined_report_32.json"
copy_file_if_exists "$SRC_ROOT/reports/combined_runs_32.json" "$OUT_DIR/reports/combined_runs_32.json"
copy_file_if_exists "$SRC_ROOT/reports/verify.log" "$OUT_DIR/reports/verify.log"
copy_dir_if_exists "$SRC_ROOT/runs/trend_base8" "$OUT_DIR/runs/trend_base8"
copy_dir_if_exists "$SRC_ROOT/runs/trend_plus24" "$OUT_DIR/runs/trend_plus24"
copy_dir_if_exists "$SRC_ROOT/runs/raw_runs" "$OUT_DIR/runs/raw_runs"
copy_dir_if_exists "$SRC_ROOT/code/repo_snapshot" "$OUT_DIR/code/repo_snapshot"

# Enforce inclusion of Step-C artifacts when available.
for run_family in trend_base8 trend_plus24 raw_runs; do
  for run_dir in "$SRC_ROOT/runs/$run_family"/*; do
    [[ -d "$run_dir" ]] || continue
    run_name="$(basename "$run_dir")"
    copy_file_if_exists "$run_dir/step-c/step_c_summary.json" \
      "$OUT_DIR/runs/$run_family/$run_name/step-c/step_c_summary.json"
    copy_file_if_exists "$run_dir/step-c/pattern_library.json" \
      "$OUT_DIR/runs/$run_family/$run_name/step-c/pattern_library.json"
    copy_file_if_exists "$run_dir/step-c/pattern_library_runtime.json" \
      "$OUT_DIR/runs/$run_family/$run_name/step-c/pattern_library_runtime.json"
  done
done

echo "[ok] review bundle packaged: $OUT_DIR"
