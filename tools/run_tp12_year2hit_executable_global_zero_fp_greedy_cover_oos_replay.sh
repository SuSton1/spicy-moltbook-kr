#!/usr/bin/env bash
set -euo pipefail

RUN_ID="${RUN_ID:-tp12_year2hit_executable_global_zero_fp_greedy_cover_v1}" \
TRAIN_OUT_DIR="${TRAIN_OUT_DIR:-artifacts/runs/tp12_year2hit_executable_global_zero_fp_greedy_cover_v1/train_only}" \
OOS_OUT_DIR="${OOS_OUT_DIR:-artifacts/runs/tp12_year2hit_executable_global_zero_fp_greedy_cover_v1/oos}" \
CONTRACT_PATH="${CONTRACT_PATH:-meta/tp12_year2hit_executable_global_zero_fp_greedy_cover_contract.json}" \
SURVIVORS_PATH="${SURVIVORS_PATH:-artifacts/runs/tp12_year2hit_executable_global_zero_fp_greedy_cover_v1/train_only/global_cover/micro_split_global_greedy_final_survivors.jsonl}" \
REPLAY_DIR="${REPLAY_DIR:-artifacts/runs/tp12_year2hit_executable_global_zero_fp_greedy_cover_v1/oos/global_greedy_oos_cover_replay}" \
bash tools/run_tp12_year2hit_executable_global_zero_fp_cover_oos_replay.sh "$@"
