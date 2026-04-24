#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-tp12_year2hit_zero_fp_micro_split_v1}"
OUT_DIR="${OUT_DIR:-artifacts/runs/${RUN_ID}/train_only_diagnostic}"
CONTRACT_PATH="${CONTRACT_PATH:-meta/tp12_year2hit_zero_fp_micro_split_contract.json}"
INPUT_MODE="${INPUT_MODE:-source}"
ENRICHED_PATH="${ENRICHED_PATH:-}"
BROKEN_RULES_PATH="${BROKEN_RULES_PATH:-artifacts/runs/tp12_year2hit_zero_fp_full_train_replay_v1/train_only_diagnostic/full_train_rule_replay.jsonl}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

if [[ "$INPUT_MODE" == "enriched" ]]; then
  [[ -n "$ENRICHED_PATH" ]] || { echo "ENRICHED_PATH is required when INPUT_MODE=enriched" >&2; exit 2; }
  node tools/build_tp12_year2hit_zero_fp_micro_split.mjs \
    --contract="$CONTRACT_PATH" \
    --enriched="$ENRICHED_PATH" \
    --broken-rules="$BROKEN_RULES_PATH" \
    --out-dir="$OUT_DIR" \
    "$@"
elif [[ "$INPUT_MODE" == "source" ]]; then
  EVENTS_PATH="${EVENTS_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/candidate_events.jsonl}"
  CONTEXT_PATH="${CONTEXT_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/context_features.jsonl}"
  LABELS_PATH="${LABELS_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/hard_negative_dataset.jsonl}"
  CLUSTERS_PATH="${CLUSTERS_PATH:-artifacts/runs/tp12_h80_wilson_contrastive_abstention_v1/train_only_foundation/pattern_clusters.jsonl}"
  CATALOG_PATH="${CATALOG_PATH:-artifacts/runs/tp12_h80_global_next_session_regen_v1_r3/step-tp12-year2hit-positive-first/gated_catalog.jsonl}"
  node tools/build_tp12_year2hit_zero_fp_micro_split.mjs \
    --contract="$CONTRACT_PATH" \
    --events="$EVENTS_PATH" \
    --context="$CONTEXT_PATH" \
    --labels="$LABELS_PATH" \
    --clusters="$CLUSTERS_PATH" \
    --catalog="$CATALOG_PATH" \
    --broken-rules="$BROKEN_RULES_PATH" \
    --out-dir="$OUT_DIR" \
    "$@"
else
  echo "unknown INPUT_MODE: $INPUT_MODE" >&2
  exit 2
fi
