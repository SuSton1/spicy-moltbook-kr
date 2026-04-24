#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_RUN_PREFIX="perfect_proto_stepb_plus_lite_widened_recent_matrix_$(date +%Y%m%d_%H%M%S)"

CONFIG_PATH="$DEFAULT_CONFIG"
RUN_PREFIX="$DEFAULT_RUN_PREFIX"
SPLIT_POLICY=""
LOOKBACKS_RAW="1,2,3,4,5,6,7,8"
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
SELECTION_MODE="union_all"
CLOSE28_FILTER_PCT="28"
MIN_HIT_COUNT="6"
ENABLE_TRAIN_MATCHED_DATE_PRUNE="1"
MIN_TRAIN_MATCHED_DATES="10"
MIN_TRAIN_MATCHED_MONTHS=""
MIN_TRAIN_MATCHED_QUARTERS=""
MAX_TOP1_DATE_HIT_SHARE="0.3"
MAX_TOP3_DATE_HIT_SHARE="0.6"
MAX_RULES_PER_MATCHED_DATE_SIGNATURE="3"
MAX_RULES_PER_MATCHED_MONTH_SIGNATURE=""
MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE=""
ENABLE_DIVERSE_SEARCH_ORDERING=""
DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE=""
DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE=""
DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY=""
ENABLE_DIVERSE_CATALOG_SELECTION=""
ENABLE_MDL_CATALOG_SELECTION=""
DIVERSE_CATALOG_TARGET_RULES=""
DIVERSE_NOVELTY_WEIGHT=""
DIVERSE_OVERLAP_PENALTY_WEIGHT=""
DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT=""
MDL_DESCRIPTION_LENGTH_WEIGHT=""
MDL_OVERLAP_PENALTY_WEIGHT=""
HIT_COUNT_MODE=""
HIT_COUNT_DAY_SYMBOL_CAP=""
MAX_GAP="100000"
MAX_RULE_SIZE="6"
MAX_SEED_TOKENS="4000"
MAX_RULES="4000"
MAX_SEARCH_STATES="20000000"
SEARCH_MODE="exact_indexed_kernel_v1"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepb_plus_lite_widened_recent_matrix.sh --split-policy=decision_date_only|strict_label_boundary [--config=/abs/path/config.json] [--run-prefix=<prefix>] [--lookbacks=1,2,3,4,5,6,7,8] [server_run_stepb_dplus1_plus_lite.sh compatible tuning args...]
Runs same_day_plus_recent_upto_Nd widened discovery families under the shared stepb_dplus1_plus_lite contract and writes a matrix manifest.
Default widened breadth guards: --min-train-matched-dates=10 --max-top1-date-hit-share=0.3 --max-top3-date-hit-share=0.6 --max-rules-per-matched-date-signature=3
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-prefix=*) RUN_PREFIX="${arg#*=}" ;;
    --split-policy=*) SPLIT_POLICY="${arg#*=}" ;;
    --lookbacks=*) LOOKBACKS_RAW="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --selection-mode=*) SELECTION_MODE="${arg#*=}" ;;
    --close28-filter-pct=*) CLOSE28_FILTER_PCT="${arg#*=}" ;;
    --min-hit-count=*) MIN_HIT_COUNT="${arg#*=}" ;;
    --enable-train-matched-date-prune=*) ENABLE_TRAIN_MATCHED_DATE_PRUNE="${arg#*=}" ;;
    --min-train-matched-dates=*) MIN_TRAIN_MATCHED_DATES="${arg#*=}" ;;
    --min-train-matched-months=*) MIN_TRAIN_MATCHED_MONTHS="${arg#*=}" ;;
    --min-train-matched-quarters=*) MIN_TRAIN_MATCHED_QUARTERS="${arg#*=}" ;;
    --max-top1-date-hit-share=*) MAX_TOP1_DATE_HIT_SHARE="${arg#*=}" ;;
    --max-top3-date-hit-share=*) MAX_TOP3_DATE_HIT_SHARE="${arg#*=}" ;;
    --max-rules-per-matched-date-signature=*) MAX_RULES_PER_MATCHED_DATE_SIGNATURE="${arg#*=}" ;;
    --max-rules-per-matched-month-signature=*) MAX_RULES_PER_MATCHED_MONTH_SIGNATURE="${arg#*=}" ;;
    --max-rules-per-matched-quarter-signature=*) MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE="${arg#*=}" ;;
    --enable-diverse-search-ordering=*) ENABLE_DIVERSE_SEARCH_ORDERING="${arg#*=}" ;;
    --diverse-beam-max-per-month-signature=*) DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE="${arg#*=}" ;;
    --diverse-beam-max-per-quarter-signature=*) DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE="${arg#*=}" ;;
    --diverse-beam-max-per-anchor-family=*) DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY="${arg#*=}" ;;
    --enable-diverse-catalog-selection=*) ENABLE_DIVERSE_CATALOG_SELECTION="${arg#*=}" ;;
    --enable-mdl-catalog-selection=*) ENABLE_MDL_CATALOG_SELECTION="${arg#*=}" ;;
    --diverse-catalog-target-rules=*) DIVERSE_CATALOG_TARGET_RULES="${arg#*=}" ;;
    --diverse-novelty-weight=*) DIVERSE_NOVELTY_WEIGHT="${arg#*=}" ;;
    --diverse-overlap-penalty-weight=*) DIVERSE_OVERLAP_PENALTY_WEIGHT="${arg#*=}" ;;
    --diverse-anchor-family-penalty-weight=*) DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT="${arg#*=}" ;;
    --mdl-description-length-weight=*) MDL_DESCRIPTION_LENGTH_WEIGHT="${arg#*=}" ;;
    --mdl-overlap-penalty-weight=*) MDL_OVERLAP_PENALTY_WEIGHT="${arg#*=}" ;;
    --hit-count-mode=*) HIT_COUNT_MODE="${arg#*=}" ;;
    --hit-count-day-symbol-cap=*) HIT_COUNT_DAY_SYMBOL_CAP="${arg#*=}" ;;
    --max-gap=*) MAX_GAP="${arg#*=}" ;;
    --max-rule-size=*) MAX_RULE_SIZE="${arg#*=}" ;;
    --max-seed-tokens=*) MAX_SEED_TOKENS="${arg#*=}" ;;
    --max-rules=*) MAX_RULES="${arg#*=}" ;;
    --max-search-states=*) MAX_SEARCH_STATES="${arg#*=}" ;;
    --search-mode=*) SEARCH_MODE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *) fatal "unknown arg: $arg" ;;
  esac
done

ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "server-only widened recent matrix wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi
[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"

case "$SPLIT_POLICY" in
  decision_date_only|strict_label_boundary) ;;
  "") fatal "missing --split-policy=decision_date_only|strict_label_boundary" ;;
  *) fatal "invalid --split-policy: $SPLIT_POLICY" ;;
esac

LOOKBACKS_NORMALIZED="$(
  node --input-type=module - "$LOOKBACKS_RAW" <<'NODE'
const [raw] = process.argv.slice(2)
const values = Array.from(
  new Set(
    String(raw ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 8),
  ),
).sort((left, right) => left - right)
if (values.length < 1) {
  throw new Error(`lookbacks must contain integers in [1,8], got ${raw || "null"}`)
}
process.stdout.write(values.join(","))
NODE
)"
IFS=',' read -r -a LOOKBACKS <<< "$LOOKBACKS_NORMALIZED"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_PREFIX"
MANIFEST_ROWS_PATH="$RUN_DIR/widened_recent_matrix_runs.jsonl"
MANIFEST_PATH="$RUN_DIR/widened_recent_matrix_manifest.json"
mkdir -p "$RUN_DIR"
: > "$MANIFEST_ROWS_PATH"

for LOOKBACK in "${LOOKBACKS[@]}"; do
  DISCOVERY_UNIVERSE_ID="same_day_plus_recent_upto_${LOOKBACK}d"
  RUN_ID="${RUN_PREFIX}_${DISCOVERY_UNIVERSE_ID}"
  CMD=(
    bash tools/server_run_stepb_dplus1_plus_lite.sh
    --config="$CONFIG_PATH"
    --run-id="$RUN_ID"
    --split-policy="$SPLIT_POLICY"
    --train-start="$TRAIN_START"
    --train-end="$TRAIN_END"
    --oos-start="$OOS_START"
    --oos-end="$OOS_END"
    --selection-mode="$SELECTION_MODE"
    --close28-filter-pct="$CLOSE28_FILTER_PCT"
    --min-hit-count="$MIN_HIT_COUNT"
    --enable-train-matched-date-prune="$ENABLE_TRAIN_MATCHED_DATE_PRUNE"
    --min-train-matched-dates="$MIN_TRAIN_MATCHED_DATES"
    --min-train-matched-months="$MIN_TRAIN_MATCHED_MONTHS"
    --min-train-matched-quarters="$MIN_TRAIN_MATCHED_QUARTERS"
    --max-top1-date-hit-share="$MAX_TOP1_DATE_HIT_SHARE"
    --max-top3-date-hit-share="$MAX_TOP3_DATE_HIT_SHARE"
    --max-rules-per-matched-date-signature="$MAX_RULES_PER_MATCHED_DATE_SIGNATURE"
    --max-rules-per-matched-month-signature="$MAX_RULES_PER_MATCHED_MONTH_SIGNATURE"
    --max-rules-per-matched-quarter-signature="$MAX_RULES_PER_MATCHED_QUARTER_SIGNATURE"
    --enable-diverse-search-ordering="$ENABLE_DIVERSE_SEARCH_ORDERING"
    --diverse-beam-max-per-month-signature="$DIVERSE_BEAM_MAX_PER_MONTH_SIGNATURE"
    --diverse-beam-max-per-quarter-signature="$DIVERSE_BEAM_MAX_PER_QUARTER_SIGNATURE"
    --diverse-beam-max-per-anchor-family="$DIVERSE_BEAM_MAX_PER_ANCHOR_FAMILY"
    --enable-diverse-catalog-selection="$ENABLE_DIVERSE_CATALOG_SELECTION"
    --enable-mdl-catalog-selection="$ENABLE_MDL_CATALOG_SELECTION"
    --diverse-catalog-target-rules="$DIVERSE_CATALOG_TARGET_RULES"
    --diverse-novelty-weight="$DIVERSE_NOVELTY_WEIGHT"
    --diverse-overlap-penalty-weight="$DIVERSE_OVERLAP_PENALTY_WEIGHT"
    --diverse-anchor-family-penalty-weight="$DIVERSE_ANCHOR_FAMILY_PENALTY_WEIGHT"
    --mdl-description-length-weight="$MDL_DESCRIPTION_LENGTH_WEIGHT"
    --mdl-overlap-penalty-weight="$MDL_OVERLAP_PENALTY_WEIGHT"
    --max-gap="$MAX_GAP"
    --max-rule-size="$MAX_RULE_SIZE"
    --max-seed-tokens="$MAX_SEED_TOKENS"
    --max-rules="$MAX_RULES"
    --max-search-states="$MAX_SEARCH_STATES"
    --search-mode="$SEARCH_MODE"
    --discovery-universe-id="$DISCOVERY_UNIVERSE_ID"
    --recent-impulse-lookback-days="$LOOKBACK"
  )
  if [[ -n "$HIT_COUNT_MODE" ]]; then
    CMD+=(--hit-count-mode="$HIT_COUNT_MODE")
  fi
  if [[ -n "$HIT_COUNT_DAY_SYMBOL_CAP" ]]; then
    CMD+=(--hit-count-day-symbol-cap="$HIT_COUNT_DAY_SYMBOL_CAP")
  fi
  "${CMD[@]}"
  node --input-type=module - "$MANIFEST_ROWS_PATH" "$RUN_ID" "$LOOKBACK" "$DISCOVERY_UNIVERSE_ID" <<'NODE'
import fs from "node:fs/promises"

const [rowsPath, runId, lookbackRaw, discoveryUniverseId] = process.argv.slice(2)
const lookback = Number(lookbackRaw)
const payload = {
  runId,
  discoveryUniverseId,
  requestedLookbackTradingDays: lookback,
  runDir: `artifacts/runs/${runId}`,
  freezeResultPath: `artifacts/runs/${runId}/freeze_result.json`,
}
await fs.appendFile(rowsPath, `${JSON.stringify(payload)}\n`, "utf8")
NODE
done

node --input-type=module - "$MANIFEST_ROWS_PATH" "$MANIFEST_PATH" "$RUN_PREFIX" "$CONFIG_PATH" "$SPLIT_POLICY" "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END" "$SELECTION_MODE" "$SEARCH_MODE" <<'NODE'
import fs from "node:fs/promises"

const [rowsPath, manifestPath, runPrefix, configPath, splitPolicy, trainStart, trainEnd, oosStart, oosEnd, selectionMode, searchMode] =
  process.argv.slice(2)
const lines = String(await fs.readFile(rowsPath, "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
const runs = lines.map((line) => JSON.parse(line))
await fs.writeFile(
  manifestPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    runPrefix,
    configPath,
    splitPolicy,
    selectionMode,
    searchMode,
    trainWindow: {
      start: trainStart,
      end: trainEnd,
    },
    oosWindow: {
      start: oosStart,
      end: oosEnd,
    },
    runs,
  }, null, 2)}\n`,
  "utf8",
)
NODE

echo "[ok] widened recent matrix run complete"
echo "runPrefix=$RUN_PREFIX"
echo "manifest=$MANIFEST_PATH"
