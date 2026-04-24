#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RUN_ID:-tp12_year2hit_executable_global_greedy_stability_audit_v1}"
SOURCE_RUN_ID="${SOURCE_RUN_ID:-tp12_year2hit_executable_global_zero_fp_greedy_cover_v1}"
PATCH_KEY="${PATCH_KEY:-tp12_year2hit_executable_global_greedy_stability_audit_v1}"
OUT_DIR="${OUT_DIR:-artifacts/runs/${RUN_ID}}"
SURVIVORS_PATH="${SURVIVORS_PATH:-artifacts/runs/${SOURCE_RUN_ID}/train_only/global_cover/micro_split_global_greedy_final_survivors.jsonl}"
TRAIN_REPLAY_PATH="${TRAIN_REPLAY_PATH:-artifacts/runs/${SOURCE_RUN_ID}/train_only/global_greedy_train_cover_replay/executable_cover_replay.jsonl}"
OOS_REPLAY_PATH="${OOS_REPLAY_PATH:-artifacts/runs/${SOURCE_RUN_ID}/oos/global_greedy_oos_cover_replay/executable_cover_replay.jsonl}"

[[ -f "$SURVIVORS_PATH" ]] || { echo "survivors not found: $SURVIVORS_PATH" >&2; exit 2; }
[[ -f "$TRAIN_REPLAY_PATH" ]] || { echo "train replay not found: $TRAIN_REPLAY_PATH" >&2; exit 2; }
[[ -f "$OOS_REPLAY_PATH" ]] || { echo "OOS replay not found: $OOS_REPLAY_PATH" >&2; exit 2; }

node tools/audit_tp12_executable_global_greedy_stability.mjs \
  --patch-key "$PATCH_KEY" \
  --survivors "$SURVIVORS_PATH" \
  --train-replay "$TRAIN_REPLAY_PATH" \
  --oos-replay "$OOS_REPLAY_PATH" \
  --out-dir "$OUT_DIR" \
  "$@"
