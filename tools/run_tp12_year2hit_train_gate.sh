#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EVENTS_PATH=""
OUT_DIR=""
CONTRACT_PATH=""
TRAIN_FROM=""
TRAIN_TO=""
CORE_YEARS=""
MIN_HITS_PER_YEAR=""
HIT_FIELD=""
FAIL_ON_INVALID_ROWS=""
FAIL_ON_ZERO_SURVIVORS=""
REQUIRE_CORE_YEARS_WITHIN_TRAIN=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --events-path=*) EVENTS_PATH="${1#*=}"; shift ;;
    --out-dir=*) OUT_DIR="${1#*=}"; shift ;;
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --train-from=*) TRAIN_FROM="${1#*=}"; shift ;;
    --train-to=*) TRAIN_TO="${1#*=}"; shift ;;
    --core-years=*) CORE_YEARS="${1#*=}"; shift ;;
    --min-hits-per-year=*) MIN_HITS_PER_YEAR="${1#*=}"; shift ;;
    --hit-field=*) HIT_FIELD="${1#*=}"; shift ;;
    --fail-on-invalid-rows) FAIL_ON_INVALID_ROWS="1"; shift ;;
    --fail-on-zero-survivors) FAIL_ON_ZERO_SURVIVORS="1"; shift ;;
    --require-core-years-within-train) REQUIRE_CORE_YEARS_WITHIN_TRAIN="1"; shift ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

[[ -n "$EVENTS_PATH" ]] || { echo "--events-path is required" >&2; exit 1; }
[[ -n "$OUT_DIR" ]] || { echo "--out-dir is required" >&2; exit 1; }

mkdir -p "$OUT_DIR"

if [[ -z "$CONTRACT_PATH" ]]; then
  TRAIN_FROM="${TRAIN_FROM:-2016-08-12}"
  TRAIN_TO="${TRAIN_TO:-2023-12-29}"
  CORE_YEARS="${CORE_YEARS:-2017,2018,2019,2020,2021,2022,2023}"
  MIN_HITS_PER_YEAR="${MIN_HITS_PER_YEAR:-2}"
  HIT_FIELD="${HIT_FIELD:-hitTarget}"
  FAIL_ON_INVALID_ROWS="${FAIL_ON_INVALID_ROWS:-0}"
  FAIL_ON_ZERO_SURVIVORS="${FAIL_ON_ZERO_SURVIVORS:-0}"
  REQUIRE_CORE_YEARS_WITHIN_TRAIN="${REQUIRE_CORE_YEARS_WITHIN_TRAIN:-0}"
fi

args=(
  "tools/build_tp12_year2hit_train_gate_summary.mjs"
  "--events-path=${EVENTS_PATH}" \
  "--out-rule-ids=${OUT_DIR}/year2hit_survivor_pattern_ids.txt" \
  "--out-survivors-jsonl=${OUT_DIR}/year2hit_train_gate_survivors.jsonl" \
  "--out-rejected-jsonl=${OUT_DIR}/year2hit_train_gate_rejected.jsonl" \
  "--out=${OUT_DIR}/year2hit_train_gate_summary.json"
)

if [[ -n "$CONTRACT_PATH" ]]; then
  args+=("--contract-path=${CONTRACT_PATH}")
fi
if [[ -n "$TRAIN_FROM" ]]; then
  args+=("--train-from=${TRAIN_FROM}")
fi
if [[ -n "$TRAIN_TO" ]]; then
  args+=("--train-to=${TRAIN_TO}")
fi
if [[ -n "$CORE_YEARS" ]]; then
  args+=("--core-years=${CORE_YEARS}")
fi
if [[ -n "$MIN_HITS_PER_YEAR" ]]; then
  args+=("--min-hits-per-year=${MIN_HITS_PER_YEAR}")
fi
if [[ -n "$HIT_FIELD" ]]; then
  args+=("--hit-field=${HIT_FIELD}")
fi
if [[ -n "$FAIL_ON_INVALID_ROWS" ]]; then
  args+=("--fail-on-invalid-rows=${FAIL_ON_INVALID_ROWS}")
fi
if [[ -n "$FAIL_ON_ZERO_SURVIVORS" ]]; then
  args+=("--fail-on-zero-survivors=${FAIL_ON_ZERO_SURVIVORS}")
fi
if [[ -n "$REQUIRE_CORE_YEARS_WITHIN_TRAIN" ]]; then
  args+=("--require-core-years-within-train=${REQUIRE_CORE_YEARS_WITHIN_TRAIN}")
fi

node "${args[@]}"

echo "[done] tp12 year2hit train gate summary=${OUT_DIR}/year2hit_train_gate_summary.json"
