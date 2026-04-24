#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-tp12_year2hit_executable_zero_fp_tile_pool_audit_v1}"
PATCH_KEY="${PATCH_KEY:-tp12_year2hit_executable_zero_fp_tile_pool_audit_v1}"
TRAIN_OUT_DIR="${TRAIN_OUT_DIR:-artifacts/runs/${RUN_ID}/train_only}"
AUDIT_OUT_DIR="${AUDIT_OUT_DIR:-artifacts/runs/${RUN_ID}/tile_pool_audit}"
CONTRACT_PATH="${CONTRACT_PATH:-meta/tp12_year2hit_executable_zero_fp_tile_pool_audit_contract.json}"
SOURCE_RUN_ID="${SOURCE_RUN_ID:-tp12_year2hit_executable_nested_micro_split_v1}"
SOURCE_TRAIN_DIR="${SOURCE_TRAIN_DIR:-artifacts/runs/${SOURCE_RUN_ID}/train_only}"
ENRICHED_PATH="${ENRICHED_PATH:-${SOURCE_TRAIN_DIR}/train_operational_consensus_rows.jsonl}"
BROKEN_RULES_PATH="${BROKEN_RULES_PATH:-${SOURCE_TRAIN_DIR}/source_rule_operational_replay/full_train_rule_replay.jsonl}"
TILES_PATH="${TILES_PATH:-${TRAIN_OUT_DIR}/micro_split_global_zero_fp_tile_pool.jsonl}"

[[ -f "$CONTRACT_PATH" ]] || { echo "contract not found: $CONTRACT_PATH" >&2; exit 2; }
[[ -f "$ENRICHED_PATH" ]] || { echo "operational enriched rows not found: $ENRICHED_PATH" >&2; exit 2; }
[[ -f "$BROKEN_RULES_PATH" ]] || { echo "operational source replay not found: $BROKEN_RULES_PATH" >&2; exit 2; }

INPUT_MODE=enriched \
  ENRICHED_PATH="$ENRICHED_PATH" \
  BROKEN_RULES_PATH="$BROKEN_RULES_PATH" \
  CONTRACT_PATH="$CONTRACT_PATH" \
  OUT_DIR="$TRAIN_OUT_DIR" \
  bash tools/run_tp12_year2hit_zero_fp_micro_split.sh "$@"

[[ -f "$TILES_PATH" ]] || { echo "tile pool not found: $TILES_PATH" >&2; exit 2; }

node tools/audit_tp12_executable_zero_fp_tile_pool.mjs \
  --patch-key "$PATCH_KEY" \
  --tiles "$TILES_PATH" \
  --out-dir "$AUDIT_OUT_DIR"
