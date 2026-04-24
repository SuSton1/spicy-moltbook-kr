#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_ID=""
CONTRACT_PATH="meta/tp12_year2hit_train_2016_2024_contract.json"
CANDLE_PATH="data/candle_daily.jsonl"
UNIVERSE_PATH="data/universe_daily.jsonl"
LIFECYCLE_PATH="data/historical_symbol_lifecycle.jsonl"
SHARES_PATH="data/historical_shares_intervals.jsonl"
OUT_ROOT=""
MAX_PATTERN_SIZE=""
MIN_CANDIDATE_PRECISION=""
MAX_TOP1_HIT_DATE_SHARE=""

usage() {
  cat <<'EOF'
Usage:
  bash tools/run_tp12_year2hit_trainfirst_mining_pipeline.sh --run-id=ID [options]

Builds the explicit train-first year2hit discovery path:
label events -> tokenized events -> positive-first candidates -> materialized train events
-> existing train gate -> quality gate -> gated catalog -> OOS preflight.

This wrapper does not run OOS replay and does not relax year2hit gates.
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --candle-path=*) CANDLE_PATH="${1#*=}"; shift ;;
    --universe-path=*) UNIVERSE_PATH="${1#*=}"; shift ;;
    --lifecycle-path=*) LIFECYCLE_PATH="${1#*=}"; shift ;;
    --shares-path=*) SHARES_PATH="${1#*=}"; shift ;;
    --out-root=*) OUT_ROOT="${1#*=}"; shift ;;
    --max-pattern-size=*) MAX_PATTERN_SIZE="${1#*=}"; shift ;;
    --min-candidate-precision=*) MIN_CANDIDATE_PRECISION="${1#*=}"; shift ;;
    --max-top1-hit-date-share=*) MAX_TOP1_HIT_DATE_SHARE="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
  esac
done

[[ -n "$RUN_ID" ]] || { echo "--run-id is required" >&2; exit 4; }
[[ -f "$CONTRACT_PATH" ]] || { echo "contract not found: $CONTRACT_PATH" >&2; exit 4; }
[[ -f "$CANDLE_PATH" ]] || { echo "candle path not found: $CANDLE_PATH" >&2; exit 4; }
[[ -f "$UNIVERSE_PATH" ]] || { echo "universe path not found: $UNIVERSE_PATH" >&2; exit 4; }
[[ -f "$LIFECYCLE_PATH" ]] || { echo "lifecycle path not found: $LIFECYCLE_PATH" >&2; exit 4; }
[[ -f "$SHARES_PATH" ]] || { echo "shares path not found: $SHARES_PATH" >&2; exit 4; }

if [[ -z "$OUT_ROOT" ]]; then
  OUT_ROOT="$ROOT_DIR/artifacts/runs/$RUN_ID/step-tp12-year2hit-positive-first"
fi
mkdir -p "$OUT_ROOT"

mapfile -t contract_ranges < <(node --input-type=module - "$CONTRACT_PATH" <<'NODE'
import fs from "node:fs"

const contractPath = process.argv[2]
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"))
const decisionFrom = String(contract?.decisionWindow?.from ?? contract?.trainDateRange?.from ?? "").trim()
const decisionTo = String(contract?.decisionWindow?.to ?? contract?.oosDateRange?.to ?? contract?.trainDateRange?.to ?? "").trim()
const trainFrom = String(contract?.trainDateRange?.from ?? "").trim()
const trainTo = String(contract?.trainDateRange?.to ?? "").trim()
for (const [label, value] of Object.entries({ decisionFrom, decisionTo, trainFrom, trainTo })) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`contract ${label} is invalid: ${value || "missing"}`)
}
if (decisionFrom > decisionTo) throw new Error(`contract decision range is invalid: ${decisionFrom}..${decisionTo}`)
if (trainFrom > trainTo) throw new Error(`contract train range is invalid: ${trainFrom}..${trainTo}`)
console.log(decisionFrom)
console.log(decisionTo)
console.log(trainFrom)
console.log(trainTo)
NODE
)

DATA_READINESS_SUMMARY="$OUT_ROOT/data_readiness_summary.json"
ASOF_SURVIVORSHIP_SUMMARY="$OUT_ROOT/asof_survivorship_summary.json"
LABEL_EVENTS="$OUT_ROOT/label_events.jsonl"
LABEL_SUMMARY="$OUT_ROOT/label_event_summary.json"
TOKENIZED_EVENTS="$OUT_ROOT/tokenized_events.jsonl"
TOKENIZED_SUMMARY="$OUT_ROOT/tokenized_event_summary.json"
CANDIDATE_CATALOG="$OUT_ROOT/candidate_catalog.jsonl"
CANDIDATE_MANIFEST="$OUT_ROOT/candidate_mining_manifest.json"
CANDIDATE_EVENTS="$OUT_ROOT/candidate_events.jsonl"
MATERIALIZE_SUMMARY="$OUT_ROOT/candidate_event_materialize_summary.json"
TRAIN_GATE_DIR="$OUT_ROOT/train_gate"
QUALITY_SUMMARY="$OUT_ROOT/quality_gate_summary.json"
QUALITY_SURVIVORS="$OUT_ROOT/quality_passed_survivors.jsonl"
QUALITY_REJECTED="$OUT_ROOT/quality_rejected_survivors.jsonl"
QUALITY_FILTERED_GATE_SUMMARY="$OUT_ROOT/quality_filtered_train_gate_summary.json"
SURVIVOR_CATALOG="$OUT_ROOT/survivor_catalog.jsonl"
SURVIVOR_MANIFEST="$OUT_ROOT/survivor_catalog_manifest.json"
GATED_CATALOG="$OUT_ROOT/gated_catalog.jsonl"
GATED_MANIFEST="$OUT_ROOT/gated_catalog_manifest.json"
PREFLIGHT_SUMMARY="$OUT_ROOT/oos_preflight_summary.json"

DATA_DIR="$(dirname "$CANDLE_PATH")"
EXPECTED_UNIVERSE_PATH="$DATA_DIR/universe_daily.jsonl"
if [[ "$(realpath -m "$UNIVERSE_PATH")" != "$(realpath -m "$EXPECTED_UNIVERSE_PATH")" ]]; then
  echo "data readiness requires universe_daily.jsonl in the same data dir as candle_daily.jsonl: expected $EXPECTED_UNIVERSE_PATH got $UNIVERSE_PATH" >&2
  exit 4
fi

python3 tools/build_tp12_year2hit_data_readiness_summary.py \
  "--data-dir=$DATA_DIR" \
  "--from=${contract_ranges[0]}" \
  "--to=${contract_ranges[1]}" \
  "--min-latest-common-date=${contract_ranges[1]}" \
  "--lifecycle-path=$LIFECYCLE_PATH" \
  "--shares-path=$SHARES_PATH" \
  "--out=$DATA_READINESS_SUMMARY"

node tools/build_tp12_label_events.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--candle-path=$CANDLE_PATH" \
  "--out-events=$LABEL_EVENTS" \
  "--out-summary=$LABEL_SUMMARY"

node tools/build_tp12_tokenized_events.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--label-events=$LABEL_EVENTS" \
  "--candle-path=$CANDLE_PATH" \
  "--universe-path=$UNIVERSE_PATH" \
  "--out-events=$TOKENIZED_EVENTS" \
  "--out-summary=$TOKENIZED_SUMMARY"

miner_args=(
  "tools/mine_tp12_year2hit_candidates.mjs"
  "--contract-path=$CONTRACT_PATH"
  "--tokenized-events=$TOKENIZED_EVENTS"
  "--out-catalog=$CANDIDATE_CATALOG"
  "--out-manifest=$CANDIDATE_MANIFEST"
)
if [[ -n "$MAX_PATTERN_SIZE" ]]; then
  miner_args+=("--max-pattern-size=$MAX_PATTERN_SIZE")
fi
if [[ -n "$MIN_CANDIDATE_PRECISION" ]]; then
  miner_args+=("--min-candidate-precision=$MIN_CANDIDATE_PRECISION")
fi
if [[ -n "$MAX_TOP1_HIT_DATE_SHARE" ]]; then
  miner_args+=("--max-top1-hit-date-share=$MAX_TOP1_HIT_DATE_SHARE")
fi
node "${miner_args[@]}"

node tools/materialize_tp12_candidate_events.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--candidate-catalog=$CANDIDATE_CATALOG" \
  "--tokenized-events=$TOKENIZED_EVENTS" \
  "--out-events=$CANDIDATE_EVENTS" \
  "--out-summary=$MATERIALIZE_SUMMARY"

node tools/audit_tp12_asof_survivorship.mjs \
  "--events-path=$CANDIDATE_EVENTS" \
  "--lifecycle-path=$LIFECYCLE_PATH" \
  "--from=${contract_ranges[2]}" \
  "--to=${contract_ranges[3]}" \
  "--out=$ASOF_SURVIVORSHIP_SUMMARY"

bash tools/run_tp12_year2hit_train_gate.sh \
  "--contract-path=$CONTRACT_PATH" \
  "--events-path=$CANDIDATE_EVENTS" \
  "--out-dir=$TRAIN_GATE_DIR"

node tools/build_tp12_year2hit_quality_gate_summary.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--train-gate-summary=$TRAIN_GATE_DIR/year2hit_train_gate_summary.json" \
  "--candidate-events=$CANDIDATE_EVENTS" \
  "--candidate-catalog=$CANDIDATE_CATALOG" \
  "--out-summary=$QUALITY_SUMMARY" \
  "--out-survivors=$QUALITY_SURVIVORS" \
  "--out-rejected=$QUALITY_REJECTED" \
  "--out-filtered-train-gate-summary=$QUALITY_FILTERED_GATE_SUMMARY"

node tools/freeze_tp12_year2hit_survivor_catalog.mjs \
  "--candidate-catalog=$CANDIDATE_CATALOG" \
  "--quality-gate-summary=$QUALITY_SUMMARY" \
  "--out-catalog=$SURVIVOR_CATALOG" \
  "--out-manifest=$SURVIVOR_MANIFEST"

node tools/build_tp12_year2hit_gated_catalog.mjs \
  "--source-catalog=$CANDIDATE_CATALOG" \
  "--train-gate-summary=$QUALITY_FILTERED_GATE_SUMMARY" \
  "--out-catalog=$GATED_CATALOG" \
  "--out-manifest=$GATED_MANIFEST"

node tools/assert_tp12_year2hit_oos_preflight.mjs \
  "--contract-path=$CONTRACT_PATH" \
  "--data-readiness-summary=$DATA_READINESS_SUMMARY" \
  "--asof-survivorship-summary=$ASOF_SURVIVORSHIP_SUMMARY" \
  "--label-manifest=$LABEL_SUMMARY" \
  "--token-dictionary-manifest=$TOKENIZED_SUMMARY" \
  "--event-row-manifest=$MATERIALIZE_SUMMARY" \
  "--quality-gate-summary=$QUALITY_SUMMARY" \
  "--survivor-catalog-manifest=$SURVIVOR_MANIFEST" \
  "--train-gate-summary=$QUALITY_FILTERED_GATE_SUMMARY" \
  "--gated-catalog=$GATED_CATALOG" \
  "--gated-catalog-manifest=$GATED_MANIFEST" \
  "--require-extended-manifests=true" \
  "--out=$PREFLIGHT_SUMMARY"

echo "[done] tp12 year2hit train-first mining pipeline out=$OUT_ROOT"
