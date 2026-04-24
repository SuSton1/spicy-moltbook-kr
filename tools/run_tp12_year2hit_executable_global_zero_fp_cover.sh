#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-tp12_year2hit_executable_global_zero_fp_cover_v1}"
OUT_DIR="${OUT_DIR:-artifacts/runs/${RUN_ID}/train_only}"
CONTRACT_PATH="${CONTRACT_PATH:-meta/tp12_year2hit_executable_global_zero_fp_cover_contract.json}"
DATE_FROM="${DATE_FROM:-2016-01-04}"
DATE_TO="${DATE_TO:-2024-12-30}"
SOURCE_RUN_ID="${SOURCE_RUN_ID:-tp12_year2hit_executable_nested_micro_split_v1}"
SOURCE_TRAIN_DIR="${SOURCE_TRAIN_DIR:-artifacts/runs/${SOURCE_RUN_ID}/train_only}"
ENRICHED_PATH="${ENRICHED_PATH:-${SOURCE_TRAIN_DIR}/train_operational_consensus_rows.jsonl}"
BROKEN_RULES_PATH="${BROKEN_RULES_PATH:-${SOURCE_TRAIN_DIR}/source_rule_operational_replay/full_train_rule_replay.jsonl}"
GLOBAL_COVER_DIR="${GLOBAL_COVER_DIR:-${OUT_DIR}/global_cover}"
TRAIN_REPLAY_DIR="${TRAIN_REPLAY_DIR:-${OUT_DIR}/global_train_cover_replay}"
SURVIVORS_PATH="${SURVIVORS_PATH:-${GLOBAL_COVER_DIR}/micro_split_global_final_survivors.jsonl}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"

[[ -f "$CONTRACT_PATH" ]] || { echo "contract not found: $CONTRACT_PATH" >&2; exit 2; }
[[ -f "$ENRICHED_PATH" ]] || { echo "operational enriched rows not found: $ENRICHED_PATH" >&2; exit 2; }
[[ -f "$BROKEN_RULES_PATH" ]] || { echo "operational source replay not found: $BROKEN_RULES_PATH" >&2; exit 2; }

mkdir -p "$OUT_DIR"

INPUT_MODE=enriched \
  ENRICHED_PATH="$ENRICHED_PATH" \
  BROKEN_RULES_PATH="$BROKEN_RULES_PATH" \
  CONTRACT_PATH="$CONTRACT_PATH" \
  OUT_DIR="$GLOBAL_COVER_DIR" \
  bash tools/run_tp12_year2hit_zero_fp_micro_split.sh "$@"

node tools/replay_tp12_micro_split_covers_executable.mjs \
  --contract "$CONTRACT_PATH" \
  --survivors "$SURVIVORS_PATH" \
  --enriched "$ENRICHED_PATH" \
  --date-from "$DATE_FROM" \
  --date-to "$DATE_TO" \
  --allow-empty-survivors=true \
  --out-dir "$TRAIN_REPLAY_DIR"
