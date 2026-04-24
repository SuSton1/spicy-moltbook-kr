#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-tp12_year2hit_executable_nested_micro_split_v1}"
TRAIN_OUT_DIR="${TRAIN_OUT_DIR:-artifacts/runs/${RUN_ID}/train_only}"
OOS_OUT_DIR="${OOS_OUT_DIR:-artifacts/runs/${RUN_ID}/oos_replay}"
CONTRACT_PATH="${CONTRACT_PATH:-meta/tp12_year2hit_executable_nested_micro_split_contract.json}"
DATE_FROM="${DATE_FROM:-2025-01-02}"
DATE_TO="${DATE_TO:-2026-04-14}"
SURVIVORS_PATH="${SURVIVORS_PATH:-${TRAIN_OUT_DIR}/micro_split_operational/micro_split_final_survivors.jsonl}"
OOS_EVENTS_PATH="${OOS_EVENTS_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_oos_r1/step-tp12-year2hit-gated-catalog-oos-replay/oos_candidate_events.jsonl}"
OOS_LABELS_PATH="${OOS_LABELS_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_oos_r1/step-tp12-year2hit-gated-catalog-oos-replay/oos_label_events.jsonl}"
OOS_LABEL_EVENTS_PATH="${OOS_LABEL_EVENTS_PATH:-$OOS_LABELS_PATH}"
OOS_CONTEXT_PATH="${OOS_CONTEXT_PATH:-artifacts/runs/tp12_year2hit_zero_fp_micro_split_oos_replay_v1/oos_replay/oos_context_features_dedup_symbol_date.jsonl}"
TRAIN_EVENTS_PATH="${TRAIN_EVENTS_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/candidate_events.jsonl}"
CATALOG_PATH="${CATALOG_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/gated_catalog.jsonl}"
CLUSTERS_PATH="${CLUSTERS_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/pattern_clusters.jsonl}"
CANDLE_PATH="${CANDLE_PATH:-data/candle_daily.jsonl}"
OOS_ENRICHED_PATH="${OOS_ENRICHED_PATH:-${OOS_OUT_DIR}/oos_operational_consensus_rows.jsonl}"
OOS_NON_EXECUTABLE_PATH="${OOS_NON_EXECUTABLE_PATH:-${OOS_OUT_DIR}/oos_non_executable_consensus_rows.jsonl}"
OOS_ENRICHED_SUMMARY_PATH="${OOS_ENRICHED_SUMMARY_PATH:-${OOS_OUT_DIR}/oos_operational_consensus_summary.json}"
OOS_REPLAY_DIR="${OOS_REPLAY_DIR:-${OOS_OUT_DIR}/cover_replay}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

mkdir -p "$OOS_OUT_DIR"

node tools/build_tp12_executable_consensus_rows.mjs \
  --patch-key "${RUN_ID}_oos_replay" \
  --events "$OOS_EVENTS_PATH" \
  --reliability-events "$TRAIN_EVENTS_PATH" \
  --context "$OOS_CONTEXT_PATH" \
  --labels "$OOS_LABELS_PATH" \
  --label-events "$OOS_LABEL_EVENTS_PATH" \
  --catalog "$CATALOG_PATH" \
  --clusters "$CLUSTERS_PATH" \
  --candles "$CANDLE_PATH" \
  --date-from "$DATE_FROM" \
  --date-to "$DATE_TO" \
  --out-enriched "$OOS_ENRICHED_PATH" \
  --out-non-executable "$OOS_NON_EXECUTABLE_PATH" \
  --out-summary "$OOS_ENRICHED_SUMMARY_PATH"

node tools/replay_tp12_micro_split_covers_executable.mjs \
  --contract "$CONTRACT_PATH" \
  --survivors "$SURVIVORS_PATH" \
  --enriched "$OOS_ENRICHED_PATH" \
  --date-from "$DATE_FROM" \
  --date-to "$DATE_TO" \
  --allow-empty-survivors=true \
  --out-dir "$OOS_REPLAY_DIR"
