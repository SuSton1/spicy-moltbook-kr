#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.prejump.json"
DEFAULT_RUN_PREFIX="perfect_proto_prejump_indexed_$(date +%Y%m%d_%H%M%S)"
DEFAULT_FEATURE_STORE_DIR="$ROOT_DIR/artifacts/feature-store/prejump_v5"
LOCK_DIR="$ROOT_DIR/artifacts/locks"
LOCK_PATH="$LOCK_DIR/perfect_proto_prejump_indexed_mining.lock"

CONFIG_PATH="$DEFAULT_CONFIG"
START_DATE=""
END_DATE=""
RUN_PREFIX="$DEFAULT_RUN_PREFIX"
EMIT_JSONL="false"
PACK_OUT_DIR=""
INDEX_OUT_DIR=""
MINE_OUT_DIR=""
FEATURE_STORE_DIR="${PREJUMP_FEATURE_STORE_DIR:-$DEFAULT_FEATURE_STORE_DIR}"
PACK_SOURCE_MODE="${PREJUMP_PACK_SOURCE_MODE:-feature_store}"
BUILD_FEATURE_STORE="${PREJUMP_BUILD_FEATURE_STORE:-false}"
MIN_AVAILABLE_MEM_GB="${PREJUMP_MIN_AVAILABLE_MEM_GB:-5}"
MIN_AVAILABLE_MEM_BASE_GB="${PREJUMP_MIN_AVAILABLE_MEM_BASE_GB:-2}"
MIN_AVAILABLE_MEM_PER_WORKER_GB="${PREJUMP_MIN_AVAILABLE_MEM_PER_WORKER_GB:-2}"
MIN_ROOT_AVAIL_GB="${PREJUMP_MIN_ROOT_AVAIL_GB:-20}"
NODE_HEAP_MB="${PREJUMP_NODE_HEAP_MB:-4096}"
DUCKDB_MEMORY_LIMIT_GB="${PERFECT_PROTO_DUCKDB_MEMORY_LIMIT_GB:-3}"
DUCKDB_THREADS="${PERFECT_PROTO_DUCKDB_THREADS:-2}"
MINER_WORKERS="${PREJUMP_MINER_WORKERS:-2}"
EMIT_TOKEN_POSTINGS_PARQUET="${PREJUMP_EMIT_TOKEN_POSTINGS_PARQUET:-false}"
INDEX_MERGE_MODE="${PREJUMP_INDEX_MERGE_MODE:-global_stream}"
INDEX_MERGED_DICTIONARY_STREAM_MODE="${PREJUMP_INDEX_MERGED_DICTIONARY_STREAM_MODE:-delimited}"
INDEX_DISTINCT_TOKEN_SCAN_REQUIRED="${PREJUMP_INDEX_DISTINCT_TOKEN_SCAN_REQUIRED:-true}"
INDEX_NATIVE_POSTINGS_MERGE_REQUIRED="${PREJUMP_INDEX_NATIVE_POSTINGS_MERGE_REQUIRED:-true}"
INDEX_SCHEMA_PREFLIGHT_REQUIRED="${PREJUMP_INDEX_SCHEMA_PREFLIGHT_REQUIRED:-true}"
INDEX_MERGE_READ_CONCURRENCY="${PREJUMP_INDEX_MERGE_READ_CONCURRENCY:-8}"
INDEX_OUTPUT_SINK_MODE="${PREJUMP_INDEX_OUTPUT_SINK_MODE:-delimited}"
INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED="${PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED:-true}"
TOKENIZER_SURFACE_NAME="${PREJUMP_TOKENIZER_SURFACE_NAME:-v5_prejump_contextual}"
TOKENIZER_BIN_COUNT="${PREJUMP_TOKENIZER_BIN_COUNT:-5}"
TOKENIZER_INCLUDE_SYMBOL_TOKEN="${PREJUMP_TOKENIZER_INCLUDE_SYMBOL_TOKEN:-false}"
TOKENIZER_INCLUDE_MISSING_TOKENS="${PREJUMP_TOKENIZER_INCLUDE_MISSING_TOKENS:-false}"
TOKENIZER_INCLUDE_CATEGORICAL_TOKENS="${PREJUMP_TOKENIZER_INCLUDE_CATEGORICAL_TOKENS:-true}"
PRIMARY_SINK_MODE="${PREJUMP_PRIMARY_SINK_MODE:-structured}"
FEATURE_STORE_SINK_MODE="${PREJUMP_FEATURE_STORE_SINK_MODE:-structured}"
PARTIAL_RULE_SINK_MODE="${PREJUMP_PARTIAL_RULE_SINK_MODE:-structured}"
QUERY_STREAM_MODE="${PREJUMP_QUERY_STREAM_MODE:-delimited}"
STRUCTURED_QUERY_STREAM_MODE="${PREJUMP_STRUCTURED_QUERY_STREAM_MODE:-structured}"
TABLE_STREAM_MODE="${PREJUMP_TABLE_STREAM_MODE:-delimited}"
ORDERING_HEAD_WINDOW="${PREJUMP_ORDERING_HEAD_WINDOW:-8}"
SEARCH_STATE_CACHE_MAX_BYTES="${PREJUMP_SEARCH_STATE_CACHE_MAX_BYTES:-134217728}"
PARTIAL_MERGE_INPLACE_PRUNE="${PREJUMP_PARTIAL_MERGE_INPLACE_PRUNE:-true}"
MEMO_SKYLINE_V3="${PREJUMP_MEMO_SKYLINE_V3:-true}"
ROWSET_POOL_REQUIRED="${PREJUMP_ROWSET_POOL_REQUIRED:-true}"
SPARSE_KERNEL_REQUIRED="${PREJUMP_SPARSE_KERNEL_REQUIRED:-true}"
NATIVE_ROWSET_REQUIRED="${PERFECT_PROTO_NATIVE_ROWSET_REQUIRED:-true}"
SIMD_ROWSET_REQUIRED="${PERFECT_PROTO_SIMD_ROWSET_REQUIRED:-true}"
BITMAP_BACKEND="${PERFECT_PROTO_BITMAP_BACKEND:-exact}"

usage() {
  cat <<EOF
Usage: bash tools/server_run_prejump_predictive_indexed_mining.sh --start=YYYY-MM-DD --end=YYYY-MM-DD [--config=/abs/path/config.json] [--run-prefix=name] [--emit-jsonl=true|false] [--pack-out-dir=/abs/path] [--index-out-dir=/abs/path] [--mine-out-dir=/abs/path]

This command performs feature_store -> partitioned token index build/merge -> parallel indexed mining.
OOS evaluation and curated catalog rebuild are separate explicit steps.
PREJUMP_PACK_SOURCE_MODE must remain feature_store on the canonical server wrapper path.
Use low-level build tools directly if you need raw/debug-only experiments.
Set PREJUMP_BUILD_FEATURE_STORE=true to rebuild/update the predictive feature store explicitly before index build.
Set PREJUMP_EMIT_TOKEN_POSTINGS_PARQUET=true only for debug inspection. Primary runtime uses token_postings.bin + token_dictionary.parquet and leaves token_postings.parquet disabled by default.
Set PREJUMP_INDEX_MERGE_MODE=global_stream, PREJUMP_INDEX_MERGED_DICTIONARY_STREAM_MODE=delimited, PREJUMP_INDEX_DISTINCT_TOKEN_SCAN_REQUIRED=true, PREJUMP_INDEX_NATIVE_POSTINGS_MERGE_REQUIRED=true, PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED=true, PREJUMP_INDEX_SCHEMA_PREFLIGHT_REQUIRED=true, and PREJUMP_INDEX_OUTPUT_SINK_MODE=delimited for the exact partition-merge primary path.
PREJUMP_INDEX_MERGE_READ_CONCURRENCY=<n> now affects only the slower debug path with PREJUMP_EMIT_TOKEN_POSTINGS_PARQUET=true.
Set PREJUMP_ORDERING_HEAD_WINDOW=<n> and PREJUMP_SEARCH_STATE_CACHE_MAX_BYTES=<bytes> for exact-safe mining calibration.
PREJUMP_PARTIAL_MERGE_INPLACE_PRUNE and PREJUMP_MEMO_SKYLINE_V3 must remain true on the canonical exact path.
PREJUMP_MEMO_SKYLINE_V3 is the required runtime gate for the current memo skyline v5 metadata/compaction implementation.
PREJUMP_ROWSET_POOL_REQUIRED must remain true on the canonical exact path.
PREJUMP_SPARSE_KERNEL_REQUIRED must remain true on the canonical exact path.
Canonical predictive tokenizer options must remain fixed:
  PREJUMP_TOKENIZER_SURFACE_NAME=v5_prejump_contextual
  PREJUMP_TOKENIZER_BIN_COUNT=5
  PREJUMP_TOKENIZER_INCLUDE_SYMBOL_TOKEN=false
  PREJUMP_TOKENIZER_INCLUDE_MISSING_TOKENS=false
  PREJUMP_TOKENIZER_INCLUDE_CATEGORICAL_TOKENS=true
PREJUMP_PRIMARY_SINK_MODE, PREJUMP_FEATURE_STORE_SINK_MODE, and PREJUMP_PARTIAL_RULE_SINK_MODE must remain structured on the canonical predictive path.
PREJUMP_QUERY_STREAM_MODE must remain delimited and PREJUMP_STRUCTURED_QUERY_STREAM_MODE must remain structured on the canonical predictive parquet reader path.
PREJUMP_TABLE_STREAM_MODE must remain delimited on the canonical predictive table-stream reader path.
Native exact runtime contract:
  PERFECT_PROTO_NATIVE_ROWSET_REQUIRED=true
  PERFECT_PROTO_SIMD_ROWSET_REQUIRED=true
  PERFECT_PROTO_BITMAP_BACKEND=exact
Feature-store partitions created before the exact quantile sidecar v3 contract must be rebuilt with tools/build_perfect_prototype_prejump_feature_store.mjs --overwrite-existing=true before predictive partitioned index builds.
Index progress payloads now expose quantileMergeMs, fdPoolPeak, and dictionaryCursorRows.
Stale predictive temp cleanup:
  find "$ROOT_DIR/artifacts/runs" \\( -name '.tmp_token_postings.parquet' -o -name '.tmp_feature_store_batch_*.jsonl' -o -name '.tmp_pack_batch_*.jsonl' \\) -type f -delete
EOF
}

validate_date() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "[fatal] invalid $label format: $value" >&2
    exit 4
  fi
  if ! date -d "$value" >/dev/null 2>&1; then
    echo "[fatal] invalid $label value: $value" >&2
    exit 4
  fi
}

assert_dir_available() {
  local label="$1"
  local dir_path="$2"
  if [[ -d "$dir_path" ]] && find "$dir_path" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    echo "[fatal] $label already exists and is not empty: $dir_path" >&2
    exit 4
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[fatal] required command not found: $name" >&2
    exit 4
  fi
}

assert_preflight_resources() {
  local mem_kb avail_mem_gb disk_avail_gb derived_required_mem_gb effective_required_mem_gb
  if [[ ! "$MINER_WORKERS" =~ ^[0-9]+$ ]] || (( MINER_WORKERS < 1 )); then
    echo "[fatal] invalid PREJUMP_MINER_WORKERS: $MINER_WORKERS" >&2
    exit 4
  fi
  mem_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null | tail -n1)"
  if [[ -z "$mem_kb" || ! "$mem_kb" =~ ^[0-9]+$ ]]; then
    echo "[fatal] unable to read MemAvailable from /proc/meminfo" >&2
    exit 4
  fi
  avail_mem_gb=$(( mem_kb / 1024 / 1024 ))
  if [[ ! "$MIN_AVAILABLE_MEM_BASE_GB" =~ ^[0-9]+$ ]] || (( MIN_AVAILABLE_MEM_BASE_GB < 1 )); then
    echo "[fatal] invalid PREJUMP_MIN_AVAILABLE_MEM_BASE_GB: $MIN_AVAILABLE_MEM_BASE_GB" >&2
    exit 4
  fi
  if [[ ! "$MIN_AVAILABLE_MEM_PER_WORKER_GB" =~ ^[0-9]+$ ]] || (( MIN_AVAILABLE_MEM_PER_WORKER_GB < 0 )); then
    echo "[fatal] invalid PREJUMP_MIN_AVAILABLE_MEM_PER_WORKER_GB: $MIN_AVAILABLE_MEM_PER_WORKER_GB" >&2
    exit 4
  fi
  derived_required_mem_gb=$(( MIN_AVAILABLE_MEM_BASE_GB + (MIN_AVAILABLE_MEM_PER_WORKER_GB * MINER_WORKERS) ))
  effective_required_mem_gb=$MIN_AVAILABLE_MEM_GB
  if (( derived_required_mem_gb > effective_required_mem_gb )); then
    effective_required_mem_gb=$derived_required_mem_gb
  fi
  if (( avail_mem_gb < effective_required_mem_gb )); then
    echo "[fatal] insufficient available memory: ${avail_mem_gb}GiB < required ${effective_required_mem_gb}GiB (base=${MIN_AVAILABLE_MEM_BASE_GB}GiB, perWorker=${MIN_AVAILABLE_MEM_PER_WORKER_GB}GiB, workers=${MINER_WORKERS})" >&2
    exit 4
  fi

  disk_avail_gb="$(df -BG --output=avail "$ROOT_DIR" | tail -n1 | tr -dc '0-9')"
  if [[ -z "$disk_avail_gb" || ! "$disk_avail_gb" =~ ^[0-9]+$ ]]; then
    echo "[fatal] unable to read available disk for $ROOT_DIR" >&2
    exit 4
  fi
  if (( disk_avail_gb < MIN_ROOT_AVAIL_GB )); then
    echo "[fatal] insufficient available disk: ${disk_avail_gb}GiB < required ${MIN_ROOT_AVAIL_GB}GiB" >&2
    exit 4
  fi
}

assert_no_conflicting_heavy_processes() {
  local conflicts
  conflicts="$(ps -eo pid=,cmd= | grep -E 'tools/build_perfect_prototype_prejump_feature_store\\.mjs|tools/build_perfect_prototype_prejump_pack\\.mjs|tools/build_perfect_prototype_token_index\\.mjs|tools/build_perfect_prototype_partitioned_token_index\\.mjs|tools/merge_perfect_prototype_token_index_partitions\\.mjs|tools/mine_perfect_prototypes_indexed\\.mjs|tools/mine_perfect_prototypes_parallel_indexed\\.mjs|tools/server_run_prejump_predictive_indexed_mining\\.sh' | grep -v grep | grep -v "$$" || true)"
  if [[ -n "$conflicts" ]]; then
    echo "[fatal] conflicting predictive heavy process already running:" >&2
    echo "$conflicts" >&2
    exit 4
  fi
}

run_node() {
  local heap_mb="$NODE_HEAP_MB"
  if [[ ! "$heap_mb" =~ ^[0-9]+$ ]] || (( heap_mb < 1024 )); then
    echo "[fatal] invalid PREJUMP_NODE_HEAP_MB: $heap_mb" >&2
    exit 4
  fi
  if [[ ! "$DUCKDB_MEMORY_LIMIT_GB" =~ ^[0-9]+$ ]] || (( DUCKDB_MEMORY_LIMIT_GB < 1 )); then
    echo "[fatal] invalid PERFECT_PROTO_DUCKDB_MEMORY_LIMIT_GB: $DUCKDB_MEMORY_LIMIT_GB" >&2
    exit 4
  fi
  if [[ ! "$DUCKDB_THREADS" =~ ^[0-9]+$ ]] || (( DUCKDB_THREADS < 1 )); then
    echo "[fatal] invalid PERFECT_PROTO_DUCKDB_THREADS: $DUCKDB_THREADS" >&2
    exit 4
  fi
  if [[ ! "$MINER_WORKERS" =~ ^[0-9]+$ ]] || (( MINER_WORKERS < 1 )); then
    echo "[fatal] invalid PREJUMP_MINER_WORKERS: $MINER_WORKERS" >&2
    exit 4
  fi
  if [[ ! "$ORDERING_HEAD_WINDOW" =~ ^[0-9]+$ ]]; then
    echo "[fatal] invalid PREJUMP_ORDERING_HEAD_WINDOW: $ORDERING_HEAD_WINDOW" >&2
    exit 4
  fi
  if [[ ! "$SEARCH_STATE_CACHE_MAX_BYTES" =~ ^[0-9]+$ ]]; then
    echo "[fatal] invalid PREJUMP_SEARCH_STATE_CACHE_MAX_BYTES: $SEARCH_STATE_CACHE_MAX_BYTES" >&2
    exit 4
  fi
  if [[ "$PARTIAL_MERGE_INPLACE_PRUNE" != "true" ]]; then
    echo "[fatal] PREJUMP_PARTIAL_MERGE_INPLACE_PRUNE must remain true" >&2
    exit 4
  fi
  if [[ "$MEMO_SKYLINE_V3" != "true" ]]; then
    echo "[fatal] PREJUMP_MEMO_SKYLINE_V3 must remain true" >&2
    exit 4
  fi
  if [[ "$ROWSET_POOL_REQUIRED" != "true" ]]; then
    echo "[fatal] PREJUMP_ROWSET_POOL_REQUIRED must remain true" >&2
    exit 4
  fi
  if [[ "$SPARSE_KERNEL_REQUIRED" != "true" ]]; then
    echo "[fatal] PREJUMP_SPARSE_KERNEL_REQUIRED must remain true" >&2
    exit 4
  fi
  if [[ "$PRIMARY_SINK_MODE" != "structured" ]]; then
    echo "[fatal] PREJUMP_PRIMARY_SINK_MODE must remain structured" >&2
    exit 4
  fi
  if [[ "$FEATURE_STORE_SINK_MODE" != "structured" ]]; then
    echo "[fatal] PREJUMP_FEATURE_STORE_SINK_MODE must remain structured" >&2
    exit 4
  fi
  if [[ "$PARTIAL_RULE_SINK_MODE" != "structured" ]]; then
    echo "[fatal] PREJUMP_PARTIAL_RULE_SINK_MODE must remain structured" >&2
    exit 4
  fi
  if [[ "$QUERY_STREAM_MODE" != "delimited" ]]; then
    echo "[fatal] PREJUMP_QUERY_STREAM_MODE must remain delimited" >&2
    exit 4
  fi
  if [[ "$STRUCTURED_QUERY_STREAM_MODE" != "structured" ]]; then
    echo "[fatal] PREJUMP_STRUCTURED_QUERY_STREAM_MODE must remain structured" >&2
    exit 4
  fi
  if [[ "$TABLE_STREAM_MODE" != "delimited" ]]; then
    echo "[fatal] PREJUMP_TABLE_STREAM_MODE must remain delimited" >&2
    exit 4
  fi
  if [[ "$NATIVE_ROWSET_REQUIRED" != "true" ]]; then
    echo "[fatal] PERFECT_PROTO_NATIVE_ROWSET_REQUIRED must remain true" >&2
    exit 4
  fi
  if [[ "$SIMD_ROWSET_REQUIRED" != "true" ]]; then
    echo "[fatal] PERFECT_PROTO_SIMD_ROWSET_REQUIRED must remain true" >&2
    exit 4
  fi
  if [[ "$BITMAP_BACKEND" != "exact" ]]; then
    echo "[fatal] PERFECT_PROTO_BITMAP_BACKEND must remain exact" >&2
    exit 4
  fi
  PERFECT_PROTO_DUCKDB_MEMORY_LIMIT_GB="$DUCKDB_MEMORY_LIMIT_GB" \
  PERFECT_PROTO_DUCKDB_THREADS="$DUCKDB_THREADS" \
  PREJUMP_INDEX_OUTPUT_SINK_MODE="$INDEX_OUTPUT_SINK_MODE" \
  PREJUMP_INDEX_MERGED_DICTIONARY_STREAM_MODE="$INDEX_MERGED_DICTIONARY_STREAM_MODE" \
  PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED="$INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED" \
  PREJUMP_PARTIAL_MERGE_INPLACE_PRUNE="$PARTIAL_MERGE_INPLACE_PRUNE" \
  PREJUMP_MEMO_SKYLINE_V3="$MEMO_SKYLINE_V3" \
  PREJUMP_ROWSET_POOL_REQUIRED="$ROWSET_POOL_REQUIRED" \
  PREJUMP_SPARSE_KERNEL_REQUIRED="$SPARSE_KERNEL_REQUIRED" \
  PREJUMP_PRIMARY_SINK_MODE="$PRIMARY_SINK_MODE" \
  PREJUMP_FEATURE_STORE_SINK_MODE="$FEATURE_STORE_SINK_MODE" \
  PREJUMP_PARTIAL_RULE_SINK_MODE="$PARTIAL_RULE_SINK_MODE" \
  PREJUMP_QUERY_STREAM_MODE="$QUERY_STREAM_MODE" \
  PREJUMP_STRUCTURED_QUERY_STREAM_MODE="$STRUCTURED_QUERY_STREAM_MODE" \
  PREJUMP_TABLE_STREAM_MODE="$TABLE_STREAM_MODE" \
  PERFECT_PROTO_NATIVE_ROWSET_REQUIRED="$NATIVE_ROWSET_REQUIRED" \
  PERFECT_PROTO_SIMD_ROWSET_REQUIRED="$SIMD_ROWSET_REQUIRED" \
  PERFECT_PROTO_BITMAP_BACKEND="$BITMAP_BACKEND" \
  NODE_OPTIONS="--max-old-space-size=$heap_mb ${NODE_OPTIONS:-}" \
  node "$@"
}

if [[ "$PACK_SOURCE_MODE" != "feature_store" ]]; then
  echo "[fatal] PREJUMP_PACK_SOURCE_MODE must remain feature_store on the canonical server wrapper: $PACK_SOURCE_MODE" >&2
  exit 4
fi
if [[ "$BUILD_FEATURE_STORE" != "true" && "$BUILD_FEATURE_STORE" != "false" ]]; then
  echo "[fatal] invalid PREJUMP_BUILD_FEATURE_STORE: $BUILD_FEATURE_STORE" >&2
  exit 4
fi
if [[ "$EMIT_TOKEN_POSTINGS_PARQUET" != "true" && "$EMIT_TOKEN_POSTINGS_PARQUET" != "false" ]]; then
  echo "[fatal] invalid PREJUMP_EMIT_TOKEN_POSTINGS_PARQUET: $EMIT_TOKEN_POSTINGS_PARQUET" >&2
  exit 4
fi
if [[ "$INDEX_MERGE_MODE" != "global_stream" ]]; then
  echo "[fatal] PREJUMP_INDEX_MERGE_MODE must remain global_stream: $INDEX_MERGE_MODE" >&2
  exit 4
fi
if [[ "$INDEX_MERGED_DICTIONARY_STREAM_MODE" != "delimited" ]]; then
  echo "[fatal] PREJUMP_INDEX_MERGED_DICTIONARY_STREAM_MODE must remain delimited: $INDEX_MERGED_DICTIONARY_STREAM_MODE" >&2
  exit 4
fi
if [[ "$INDEX_DISTINCT_TOKEN_SCAN_REQUIRED" != "true" ]]; then
  echo "[fatal] PREJUMP_INDEX_DISTINCT_TOKEN_SCAN_REQUIRED must remain true" >&2
  exit 4
fi
if [[ "$INDEX_NATIVE_POSTINGS_MERGE_REQUIRED" != "true" ]]; then
  echo "[fatal] PREJUMP_INDEX_NATIVE_POSTINGS_MERGE_REQUIRED must remain true" >&2
  exit 4
fi
if [[ "$INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED" != "true" ]]; then
  echo "[fatal] PREJUMP_INDEX_NATIVE_POSTINGS_SPLICE_REQUIRED must remain true" >&2
  exit 4
fi
if [[ "$INDEX_SCHEMA_PREFLIGHT_REQUIRED" != "true" ]]; then
  echo "[fatal] PREJUMP_INDEX_SCHEMA_PREFLIGHT_REQUIRED must remain true" >&2
  exit 4
fi
if [[ ! "$INDEX_MERGE_READ_CONCURRENCY" =~ ^[0-9]+$ ]] || (( INDEX_MERGE_READ_CONCURRENCY < 1 )); then
  echo "[fatal] invalid PREJUMP_INDEX_MERGE_READ_CONCURRENCY: $INDEX_MERGE_READ_CONCURRENCY" >&2
  exit 4
fi
if [[ "$INDEX_OUTPUT_SINK_MODE" != "delimited" ]]; then
  echo "[fatal] PREJUMP_INDEX_OUTPUT_SINK_MODE must remain delimited: $INDEX_OUTPUT_SINK_MODE" >&2
  exit 4
fi
if [[ "$TOKENIZER_SURFACE_NAME" != "v5_prejump_contextual" ]]; then
  echo "[fatal] PREJUMP_TOKENIZER_SURFACE_NAME must remain v5_prejump_contextual: $TOKENIZER_SURFACE_NAME" >&2
  exit 4
fi
if [[ "$TOKENIZER_BIN_COUNT" != "5" ]]; then
  echo "[fatal] PREJUMP_TOKENIZER_BIN_COUNT must remain 5: $TOKENIZER_BIN_COUNT" >&2
  exit 4
fi
if [[ "$TOKENIZER_INCLUDE_SYMBOL_TOKEN" != "false" ]]; then
  echo "[fatal] PREJUMP_TOKENIZER_INCLUDE_SYMBOL_TOKEN must remain false: $TOKENIZER_INCLUDE_SYMBOL_TOKEN" >&2
  exit 4
fi
if [[ "$TOKENIZER_INCLUDE_MISSING_TOKENS" != "false" ]]; then
  echo "[fatal] PREJUMP_TOKENIZER_INCLUDE_MISSING_TOKENS must remain false: $TOKENIZER_INCLUDE_MISSING_TOKENS" >&2
  exit 4
fi
if [[ "$TOKENIZER_INCLUDE_CATEGORICAL_TOKENS" != "true" ]]; then
  echo "[fatal] PREJUMP_TOKENIZER_INCLUDE_CATEGORICAL_TOKENS must remain true: $TOKENIZER_INCLUDE_CATEGORICAL_TOKENS" >&2
  exit 4
fi
if [[ "$PRIMARY_SINK_MODE" != "structured" ]]; then
  echo "[fatal] PREJUMP_PRIMARY_SINK_MODE must remain structured: $PRIMARY_SINK_MODE" >&2
  exit 4
fi
if [[ "$FEATURE_STORE_SINK_MODE" != "structured" ]]; then
  echo "[fatal] PREJUMP_FEATURE_STORE_SINK_MODE must remain structured: $FEATURE_STORE_SINK_MODE" >&2
  exit 4
fi
if [[ "$PARTIAL_RULE_SINK_MODE" != "structured" ]]; then
  echo "[fatal] PREJUMP_PARTIAL_RULE_SINK_MODE must remain structured: $PARTIAL_RULE_SINK_MODE" >&2
  exit 4
fi
if [[ "$QUERY_STREAM_MODE" != "delimited" ]]; then
  echo "[fatal] PREJUMP_QUERY_STREAM_MODE must remain delimited: $QUERY_STREAM_MODE" >&2
  exit 4
fi
if [[ "$STRUCTURED_QUERY_STREAM_MODE" != "structured" ]]; then
  echo "[fatal] PREJUMP_STRUCTURED_QUERY_STREAM_MODE must remain structured: $STRUCTURED_QUERY_STREAM_MODE" >&2
  exit 4
fi
if [[ "$TABLE_STREAM_MODE" != "delimited" ]]; then
  echo "[fatal] PREJUMP_TABLE_STREAM_MODE must remain delimited: $TABLE_STREAM_MODE" >&2
  exit 4
fi

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --start=*) START_DATE="${arg#*=}" ;;
    --end=*) END_DATE="${arg#*=}" ;;
    --run-prefix=*) RUN_PREFIX="${arg#*=}" ;;
    --emit-jsonl=*) EMIT_JSONL="${arg#*=}" ;;
    --pack-out-dir=*) PACK_OUT_DIR="${arg#*=}" ;;
    --index-out-dir=*) INDEX_OUT_DIR="${arg#*=}" ;;
    --mine-out-dir=*) MINE_OUT_DIR="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage >&2
      exit 4
      ;;
  esac
done

if [[ -z "$START_DATE" || -z "$END_DATE" ]]; then
  echo "[fatal] --start and --end are required" >&2
  usage >&2
  exit 4
fi

validate_date "start date" "$START_DATE"
validate_date "end date" "$END_DATE"
if [[ "$START_DATE" > "$END_DATE" ]]; then
  echo "[fatal] start date is after end date: $START_DATE > $END_DATE" >&2
  exit 4
fi

require_command flock
mkdir -p "$LOCK_DIR"
exec {LOCK_FD}> "$LOCK_PATH"
if ! flock -n "$LOCK_FD"; then
  echo "[fatal] predictive indexed mining already running: $LOCK_PATH" >&2
  exit 4
fi
trap 'flock -u "$LOCK_FD" >/dev/null 2>&1 || true' EXIT

assert_preflight_resources
assert_no_conflicting_heavy_processes

echo "[run] native rowset kernel preflight"
bash "$ROOT_DIR/scripts/build_native_rowset_kernel.sh"
bash "$ROOT_DIR/scripts/verify_native_rowset_kernel.sh"

if [[ -z "$PACK_OUT_DIR" ]]; then
  PACK_OUT_DIR="$ROOT_DIR/artifacts/runs/${RUN_PREFIX}/step-perfect-prototype-prejump"
fi
if [[ -z "$INDEX_OUT_DIR" ]]; then
  INDEX_OUT_DIR="$ROOT_DIR/artifacts/runs/${RUN_PREFIX}/step-perfect-prototype-index"
fi
if [[ -z "$MINE_OUT_DIR" ]]; then
  MINE_OUT_DIR="$ROOT_DIR/artifacts/runs/${RUN_PREFIX}/step-perfect-prototype"
fi

assert_dir_available "pack output directory" "$PACK_OUT_DIR"
assert_dir_available "index output directory" "$INDEX_OUT_DIR"
assert_dir_available "mine output directory" "$MINE_OUT_DIR"

if [[ "$BUILD_FEATURE_STORE" == "true" ]]; then
  echo "[run] predictive feature store build"
  run_node tools/build_perfect_prototype_prejump_feature_store.mjs \
    "--config=$CONFIG_PATH" \
    "--start=$START_DATE" \
    "--end=$END_DATE" \
    "--feature-store-dir=$FEATURE_STORE_DIR"
fi

echo "[run] predictive partitioned token index build"
run_node tools/build_perfect_prototype_partitioned_token_index.mjs \
  "--start=$START_DATE" \
  "--end=$END_DATE" \
  "--feature-store-dir=$FEATURE_STORE_DIR" \
  "--workspace-dir=$PACK_OUT_DIR" \
  "--out-dir=$INDEX_OUT_DIR" \
  "--surface-name=$TOKENIZER_SURFACE_NAME" \
  "--bin-count=$TOKENIZER_BIN_COUNT" \
  "--include-symbol-token=$TOKENIZER_INCLUDE_SYMBOL_TOKEN" \
  "--include-missing-tokens=$TOKENIZER_INCLUDE_MISSING_TOKENS" \
  "--include-categorical-tokens=$TOKENIZER_INCLUDE_CATEGORICAL_TOKENS" \
  "--merge-mode=$INDEX_MERGE_MODE" \
  "--merged-dictionary-stream-mode=$INDEX_MERGED_DICTIONARY_STREAM_MODE" \
  "--distinct-token-scan-required=$INDEX_DISTINCT_TOKEN_SCAN_REQUIRED" \
  "--native-postings-merge-required=$INDEX_NATIVE_POSTINGS_MERGE_REQUIRED" \
  "--schema-preflight-required=$INDEX_SCHEMA_PREFLIGHT_REQUIRED" \
  "--read-concurrency=$INDEX_MERGE_READ_CONCURRENCY" \
  "--emit-token-postings-parquet=$EMIT_TOKEN_POSTINGS_PARQUET"

if [[ ! -f "$INDEX_OUT_DIR/manifest.json" ]]; then
  echo "[fatal] expected partitioned index manifest not found: $INDEX_OUT_DIR/manifest.json" >&2
  exit 4
fi
if [[ ! -f "$INDEX_OUT_DIR/partition_manifest.json" ]]; then
  echo "[fatal] canonical server mining requires partition_manifest.json: $INDEX_OUT_DIR/partition_manifest.json" >&2
  exit 4
fi
node -e 'const fs=require("fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); if (m.partitioned !== true) { console.error(`[fatal] canonical server mining requires partitioned=true manifest: ${p}`); process.exit(4); }' \
  "$INDEX_OUT_DIR/manifest.json"

echo "[run] predictive parallel indexed mining"
run_node tools/mine_perfect_prototypes_parallel_indexed.mjs \
  "--index-dir=$INDEX_OUT_DIR" \
  "--out-dir=$MINE_OUT_DIR" \
  "--train-start=$START_DATE" \
  "--train-end=$END_DATE" \
  "--min-hit-count=6" \
  "--max-gap=100000" \
  "--max-rule-size=6" \
  "--max-seed-tokens=4000" \
  "--max-rules=4000" \
  "--max-search-states=20000000" \
  "--workers=$MINER_WORKERS" \
  "--ordering-head-window=$ORDERING_HEAD_WINDOW" \
  "--search-state-cache-max-bytes=$SEARCH_STATE_CACHE_MAX_BYTES"

echo "[ok] predictive parallel indexed mining complete"
echo "workspaceDir=$PACK_OUT_DIR"
echo "indexOutDir=$INDEX_OUT_DIR"
echo "mineOutDir=$MINE_OUT_DIR"
