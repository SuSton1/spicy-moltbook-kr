#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-tp12_year2hit_executable_nested_micro_split_v1}"
OUT_DIR="${OUT_DIR:-artifacts/runs/${RUN_ID}/train_only}"
CONTRACT_PATH="${CONTRACT_PATH:-meta/tp12_year2hit_executable_nested_micro_split_contract.json}"
DATE_FROM="${DATE_FROM:-2016-01-04}"
DATE_TO="${DATE_TO:-2024-12-30}"
EVENTS_PATH="${EVENTS_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/candidate_events.jsonl}"
CONTEXT_PATH="${CONTEXT_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/context_features.jsonl}"
LABELS_PATH="${LABELS_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/hard_negative_dataset.jsonl}"
LABEL_EVENTS_PATH="${LABEL_EVENTS_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/label_events.jsonl}"
CATALOG_PATH="${CATALOG_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/gated_catalog.jsonl}"
CLUSTERS_PATH="${CLUSTERS_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/pattern_clusters.jsonl}"
CANDLE_PATH="${CANDLE_PATH:-data/candle_daily.jsonl}"
SOURCE_RULES_PATH="${SOURCE_RULES_PATH:-artifacts/runs/tp12_year2hit_zero_fp_full_train_replay_v1/train_only_diagnostic/full_train_rule_replay.jsonl}"
ENRICHED_PATH="${ENRICHED_PATH:-${OUT_DIR}/train_operational_consensus_rows.jsonl}"
EXECUTABLE_ONLY_PATH="${EXECUTABLE_ONLY_PATH:-${OUT_DIR}/train_executable_only_consensus_rows.jsonl}"
NON_EXECUTABLE_PATH="${NON_EXECUTABLE_PATH:-${OUT_DIR}/train_non_executable_consensus_rows.jsonl}"
ENRICHED_SUMMARY_PATH="${ENRICHED_SUMMARY_PATH:-${OUT_DIR}/train_operational_consensus_summary.json}"
SOURCE_REPLAY_DIR="${SOURCE_REPLAY_DIR:-${OUT_DIR}/source_rule_operational_replay}"
MICRO_SPLIT_DIR="${MICRO_SPLIT_DIR:-${OUT_DIR}/micro_split_operational}"
TRAIN_REPLAY_DIR="${TRAIN_REPLAY_DIR:-${OUT_DIR}/train_operational_cover_replay}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

mkdir -p "$OUT_DIR"

node tools/build_tp12_executable_consensus_rows.mjs \
  --patch-key "$RUN_ID" \
  --events "$EVENTS_PATH" \
  --reliability-events "$EVENTS_PATH" \
  --context "$CONTEXT_PATH" \
  --labels "$LABELS_PATH" \
  --label-events "$LABEL_EVENTS_PATH" \
  --catalog "$CATALOG_PATH" \
  --clusters "$CLUSTERS_PATH" \
  --candles "$CANDLE_PATH" \
  --date-from "$DATE_FROM" \
  --date-to "$DATE_TO" \
  --out-enriched "$ENRICHED_PATH" \
  --out-executable "$EXECUTABLE_ONLY_PATH" \
  --out-non-executable "$NON_EXECUTABLE_PATH" \
  --out-summary "$ENRICHED_SUMMARY_PATH"

node tools/replay_tp12_zero_fp_rules_full_train.mjs \
  --mode operational_full_train_replay_executable_hit_v1 \
  --rules "$SOURCE_RULES_PATH" \
  --enriched "$ENRICHED_PATH" \
  --catalog "$CATALOG_PATH" \
  --date-from "$DATE_FROM" \
  --date-to "$DATE_TO" \
  --out-dir "$SOURCE_REPLAY_DIR"

INPUT_MODE=enriched \
  ENRICHED_PATH="$ENRICHED_PATH" \
  BROKEN_RULES_PATH="${SOURCE_REPLAY_DIR}/full_train_rule_replay.jsonl" \
  CONTRACT_PATH="$CONTRACT_PATH" \
  OUT_DIR="$MICRO_SPLIT_DIR" \
  bash tools/run_tp12_year2hit_zero_fp_micro_split.sh "$@"

node tools/replay_tp12_micro_split_covers_executable.mjs \
  --contract "$CONTRACT_PATH" \
  --survivors "${MICRO_SPLIT_DIR}/micro_split_final_survivors.jsonl" \
  --enriched "$ENRICHED_PATH" \
  --date-from "$DATE_FROM" \
  --date-to "$DATE_TO" \
  --allow-empty-survivors=true \
  --out-dir "$TRAIN_REPLAY_DIR"
