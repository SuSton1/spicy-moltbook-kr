#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TRAIN_CONTRACT_PATH="meta/tp12_year2hit_train_2016_2024_contract.json"
FIXED_CONTRACT_PATH="meta/tp12_no_stop_fixed_year2hit_research_contract.json"
RUN_ID=""
DATA_READINESS_SUMMARY=""
ASOF_SURVIVORSHIP_SUMMARY=""
LABEL_MANIFEST=""
TOKEN_DICTIONARY_MANIFEST=""
EVENT_ROW_MANIFEST=""
QUALITY_GATE_SUMMARY=""
SURVIVOR_CATALOG_MANIFEST=""
TRAIN_GATE_SUMMARY=""
GATED_CATALOG=""
GATED_CATALOG_MANIFEST=""
EXPECTED_GATE_SHA256=""
EXPECTED_CATALOG_SHA256=""
SPLIT_GROUP="holdout"
SPLIT_IDS=""
CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"
MAX_RULES=""
PRUNE_SOURCE_RUNS=0
PREFLIGHT_ONLY=0

usage() {
  cat <<'EOF'
Usage:
  bash tools/run_stepb_1d_tp12_no_stop_scope_fixed_trainfirst.sh --run-id=ID --train-gate-summary=PATH --gated-catalog=PATH --gated-catalog-manifest=PATH [options]

This wrapper is an explicit train-first OOS entry point. It fail-fast checks the 2016-2024
year2hit gate and gated catalog before any fixed-window OOS runner can be launched.
When the train contract requires extended manifests, pass the train label/token/event,
quality, and frozen-survivor manifest paths explicitly.

Contract options:
  --train-contract-path=PATH   Train gate/OOS preflight contract. Default: meta/tp12_year2hit_train_2016_2024_contract.json
  --fixed-contract-path=PATH   Fixed-window OOS contract. Default: meta/tp12_no_stop_fixed_year2hit_research_contract.json
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      echo "--contract-path is ambiguous for train-first runs; use --train-contract-path or --fixed-contract-path explicitly" >&2
      exit 4
      ;;
    --train-contract-path=*) TRAIN_CONTRACT_PATH="${1#*=}"; shift ;;
    --fixed-contract-path=*) FIXED_CONTRACT_PATH="${1#*=}"; shift ;;
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --data-readiness-summary=*) DATA_READINESS_SUMMARY="${1#*=}"; shift ;;
    --asof-survivorship-summary=*) ASOF_SURVIVORSHIP_SUMMARY="${1#*=}"; shift ;;
    --label-manifest=*) LABEL_MANIFEST="${1#*=}"; shift ;;
    --token-dictionary-manifest=*) TOKEN_DICTIONARY_MANIFEST="${1#*=}"; shift ;;
    --event-row-manifest=*) EVENT_ROW_MANIFEST="${1#*=}"; shift ;;
    --quality-gate-summary=*) QUALITY_GATE_SUMMARY="${1#*=}"; shift ;;
    --survivor-catalog-manifest=*) SURVIVOR_CATALOG_MANIFEST="${1#*=}"; shift ;;
    --train-gate-summary=*) TRAIN_GATE_SUMMARY="${1#*=}"; shift ;;
    --gated-catalog=*) GATED_CATALOG="${1#*=}"; shift ;;
    --gated-catalog-manifest=*) GATED_CATALOG_MANIFEST="${1#*=}"; shift ;;
    --expected-gate-sha256=*) EXPECTED_GATE_SHA256="${1#*=}"; shift ;;
    --expected-catalog-sha256=*) EXPECTED_CATALOG_SHA256="${1#*=}"; shift ;;
    --split-group=*) SPLIT_GROUP="${1#*=}"; shift ;;
    --split-ids=*) SPLIT_IDS="${1#*=}"; shift ;;
    --candle-path=*) CANDLE_PATH="${1#*=}"; shift ;;
    --max-rules=*) MAX_RULES="${1#*=}"; shift ;;
    --prune-source-runs) PRUNE_SOURCE_RUNS=1; shift ;;
    --preflight-only) PREFLIGHT_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

[[ -n "$RUN_ID" ]] || { echo "--run-id is required" >&2; exit 4; }
[[ -n "$TRAIN_GATE_SUMMARY" ]] || { echo "--train-gate-summary is required" >&2; exit 4; }
[[ -n "$GATED_CATALOG" ]] || { echo "--gated-catalog is required" >&2; exit 4; }
[[ -n "$GATED_CATALOG_MANIFEST" ]] || { echo "--gated-catalog-manifest is required" >&2; exit 4; }

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-tp12-year2hit-trainfirst-preflight"
mkdir -p "$OUT_DIR"
PREFLIGHT_SUMMARY="$OUT_DIR/oos_preflight_summary.json"

preflight_args=(
  "tools/assert_tp12_year2hit_oos_preflight.mjs"
  "--contract-path=${TRAIN_CONTRACT_PATH}"
  "--train-gate-summary=${TRAIN_GATE_SUMMARY}"
  "--gated-catalog=${GATED_CATALOG}"
  "--gated-catalog-manifest=${GATED_CATALOG_MANIFEST}"
  "--out=${PREFLIGHT_SUMMARY}"
)
if [[ -n "$DATA_READINESS_SUMMARY" ]]; then
  preflight_args+=("--data-readiness-summary=${DATA_READINESS_SUMMARY}")
fi
if [[ -n "$ASOF_SURVIVORSHIP_SUMMARY" ]]; then
  preflight_args+=("--asof-survivorship-summary=${ASOF_SURVIVORSHIP_SUMMARY}")
fi
if [[ -n "$LABEL_MANIFEST" ]]; then
  preflight_args+=("--label-manifest=${LABEL_MANIFEST}")
fi
if [[ -n "$TOKEN_DICTIONARY_MANIFEST" ]]; then
  preflight_args+=("--token-dictionary-manifest=${TOKEN_DICTIONARY_MANIFEST}")
fi
if [[ -n "$EVENT_ROW_MANIFEST" ]]; then
  preflight_args+=("--event-row-manifest=${EVENT_ROW_MANIFEST}")
fi
if [[ -n "$QUALITY_GATE_SUMMARY" ]]; then
  preflight_args+=("--quality-gate-summary=${QUALITY_GATE_SUMMARY}")
fi
if [[ -n "$SURVIVOR_CATALOG_MANIFEST" ]]; then
  preflight_args+=("--survivor-catalog-manifest=${SURVIVOR_CATALOG_MANIFEST}")
fi
if [[ -n "$EXPECTED_GATE_SHA256" ]]; then
  preflight_args+=("--expected-gate-sha256=${EXPECTED_GATE_SHA256}")
fi
if [[ -n "$EXPECTED_CATALOG_SHA256" ]]; then
  preflight_args+=("--expected-catalog-sha256=${EXPECTED_CATALOG_SHA256}")
fi

node "${preflight_args[@]}"

if [[ "$PREFLIGHT_ONLY" == "1" ]]; then
  echo "[done] tp12 year2hit train-first preflight passed summary=${PREFLIGHT_SUMMARY}"
  exit 0
fi

delegate_args=(
  "--contract-path=${FIXED_CONTRACT_PATH}"
  "--run-id=${RUN_ID}"
  "--split-group=${SPLIT_GROUP}"
  "--split-ids=${SPLIT_IDS}"
  "--candle-path=${CANDLE_PATH}"
)
if [[ -n "$MAX_RULES" ]]; then
  delegate_args+=("--max-rules=${MAX_RULES}")
fi
if [[ "$PRUNE_SOURCE_RUNS" == "1" ]]; then
  delegate_args+=("--prune-source-runs")
fi

bash tools/run_stepb_1d_tp12_no_stop_scope_fixed.sh "${delegate_args[@]}"
