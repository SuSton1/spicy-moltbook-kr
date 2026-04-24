#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_rolling_research_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"
OPEN_PACK_NODE_HEAP_MB="6144"
EXACT_INDEX_NODE_HEAP_MB="6144"
MINE_NODE_HEAP_MB="8192"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"

# shellcheck source=/dev/null
source "$LIB_PATH"

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
WINDOW_ID=""
SOURCE_RUN_ID=""
RUN_ID=""
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_SEARCH_STATES=""
MAX_RULES_OVERRIDE=""

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_open_pack_node() {
  NODE_OPTIONS="--max-old-space-size=$OPEN_PACK_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

run_exact_index_node() {
  NODE_OPTIONS="--max-old-space-size=$EXACT_INDEX_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

run_mine_node() {
  NODE_OPTIONS="--max-old-space-size=$MINE_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_stepb_1d_tp12_no_stop_low_gap_top_window.sh --window-id=<id> --source-run-id=<source_run_id> --run-id=<run_id> [--contract-path=PATH] [--candle-path=PATH] [--max-search-states=N] [--max-rules=N]
Server-only helper that reruns exact LOW_GAP_TOP mining on a TP12 no-stop source-pack window.
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      CONTRACT_PATH="${1#*=}"
      shift
      ;;
    --window-id=*)
      WINDOW_ID="${1#*=}"
      shift
      ;;
    --source-run-id=*)
      SOURCE_RUN_ID="${1#*=}"
      shift
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
      shift
      ;;
    --candle-path=*)
      CANDLE_PATH="${1#*=}"
      shift
      ;;
    --max-search-states=*)
      MAX_SEARCH_STATES="${1#*=}"
      shift
      ;;
    --max-rules=*)
      MAX_RULES_OVERRIDE="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"
ROOT_REAL="$(cd "$ROOT_DIR" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  fatal "Run this wrapper on the server repo root: expected=$EXPECTED_REAL actual=$ROOT_REAL"
fi
[[ -n "$WINDOW_ID" ]] || fatal "--window-id is required"
[[ -n "$SOURCE_RUN_ID" ]] || fatal "--source-run-id is required"
[[ -n "$RUN_ID" ]] || fatal "--run-id is required"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" "$WINDOW_ID" "$MAX_SEARCH_STATES" <<'NODE'
import {
  loadTp12NoStopRollingResearchContract,
  resolveTp12NoStopRollingSearchBudget,
  resolveTp12NoStopRollingWindow,
} from "./src/lib/tp12_no_stop_rolling_contract.mjs"

const [contractPath, windowId, requestedBudgetRaw] = process.argv.slice(2)
const contract = await loadTp12NoStopRollingResearchContract({
  contractPath,
  cwd: process.cwd(),
})
const window = resolveTp12NoStopRollingWindow({
  contract,
  windowId,
})
const requestedBudget = Number(requestedBudgetRaw)
const effectiveBudget = Number.isInteger(requestedBudget) && requestedBudget > 0
  ? requestedBudget
  : resolveTp12NoStopRollingSearchBudget({ contract, window })
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
const emitNumber = (key, value) => {
  console.log(`${key}=${Number(value)}`)
}
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("CONFIG_PATH", contract.searchContract.configPath)
emit("EXPECTED_LINE_ID", contract.searchContract.lineId)
emit("EXPECTED_CONTEXT_SURFACE", contract.searchContract.contextSurface)
emit("SELECTION_MODE", contract.searchContract.selectionMode)
emit("SPLIT_POLICY", contract.searchContract.splitPolicy)
emit("FOLD_SCHEME", contract.searchContract.foldScheme)
emitNumber("MIN_HIT_COUNT", contract.searchContract.minHitCount)
emitNumber("MIN_TRAIN_MATCHED_DATES", contract.searchContract.minTrainMatchedDates)
emitNumber("MIN_TRAIN_MATCHED_MONTHS", contract.searchContract.minTrainMatchedMonths)
emitNumber("MIN_TRAIN_MATCHED_FOLDS", contract.searchContract.minTrainMatchedFolds)
emitNumber("MAX_RULE_SIZE", contract.searchContract.maxRuleSize)
emitNumber("MAX_SEED_TOKENS", contract.searchContract.maxSeedTokens)
emitNumber("MAX_RULES", contract.searchContract.maxRules)
emitNumber("MAX_GAP_TRADING_DAYS", contract.searchContract.maxGapTradingDays)
emitNumber("MAX_SEARCH_STATES_EFFECTIVE", effectiveBudget)
emit("TRAIN_START", window.trainDateFrom)
emit("TRAIN_END", window.trainDateTo)
emit("OOS_START", window.oosDateFrom)
emit("OOS_END", window.oosDateTo)
emit("WINDOW_KIND", window.kind)
NODE
)"

if [[ -n "$MAX_RULES_OVERRIDE" ]]; then
  if [[ ! "$MAX_RULES_OVERRIDE" =~ ^[0-9]+$ || "$MAX_RULES_OVERRIDE" -lt 1 ]]; then
    fatal "--max-rules must be a positive integer, got: $MAX_RULES_OVERRIDE"
  fi
  MAX_RULES="$MAX_RULES_OVERRIDE"
fi

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_LINE_ID" "$MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
CONFIG_SHA256="$(compute_sha256 "$CONFIG_PATH")"
SOURCE_RUN_DIR="$ROOT_DIR/artifacts/runs/$SOURCE_RUN_ID"
SOURCE_TRAIN_PACK="$SOURCE_RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
SOURCE_OOS_PACK="$SOURCE_RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
[[ -f "$SOURCE_TRAIN_PACK" ]] || fatal "source train pack missing: $SOURCE_TRAIN_PACK"
[[ -f "$SOURCE_OOS_PACK" ]] || fatal "source oos pack missing: $SOURCE_OOS_PACK"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-train-pack"
OOS_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-oos-pack"
TRAIN_INDEX_DIR="$RUN_DIR/step-perfect-prototype-index-train"
TRAIN_MINE_DIR="$RUN_DIR/step-perfect-prototype-train"
TRAIN_REPORT_DIR="$RUN_DIR/step-perfect-prototype-open-train-report"
TRAIN_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-raw"
TRAIN_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-close28"
OOS_REPORT_DIR="$RUN_DIR/step-perfect-prototype-open-oos-report"
OOS_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-raw"
OOS_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-close28"
LEADERBOARD_DIR="$RUN_DIR/step-perfect-prototype-open-eval-report"
FREEZE_RESULT_PATH="$RUN_DIR/freeze_result.json"
NO_RULES_SUMMARY_PATH="$RUN_DIR/no_rules_summary.json"
TRAIN_RULE_IDS_PATH="$RUN_DIR/train_rule_ids.txt"
RUNTIME_SUMMARY_PATH="$RUN_DIR/tp12_no_stop_window_runtime.json"
SELECTION_LINE_ID="${EXPECTED_LINE_ID}_low_gap_top_probe"
ROW_CONTRACT="open_eval_recent_impulse_1d"
CLOSE28_FILTER_PCT="28"

if [[ -e "$RUN_DIR" ]]; then
  fatal "run dir already exists: $RUN_DIR"
fi
mkdir -p "$RUN_DIR"

write_no_rules_artifacts() {
  local summary_path="$1"
  local freeze_result_path="$2"
  local reason="$3"
  node --input-type=module - "$summary_path" "$freeze_result_path" "$reason" "$WINDOW_ID" "$WINDOW_KIND" <<'NODE'
import fs from "node:fs/promises"

const [summaryPath, freezeResultPath, reason, windowId, windowKind] = process.argv.slice(2)
const summary = {
  status: "no_rules",
  reason,
  windowId,
  windowKind,
}
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
await fs.writeFile(
  freezeResultPath,
  `${JSON.stringify({ status: "no_rules", reason, summaryPath }, null, 2)}\n`,
  "utf8",
)
NODE
}

node tools/build_perfect_prototype_tp12_low_subscope_filtered_pack.mjs \
  --input="$SOURCE_TRAIN_PACK" \
  --out-dir="$TRAIN_PACK_DIR" \
  --subscope-id="LOW_GAP_TOP" \
  --source-run-id="$SOURCE_RUN_ID" \
  --source-stage-label=train \
  --row-contract="$ROW_CONTRACT" \
  --require-nonempty=false >/dev/null

node tools/build_perfect_prototype_tp12_low_subscope_filtered_pack.mjs \
  --input="$SOURCE_OOS_PACK" \
  --out-dir="$OOS_PACK_DIR" \
  --subscope-id="LOW_GAP_TOP" \
  --source-run-id="$SOURCE_RUN_ID" \
  --source-stage-label=oos \
  --row-contract="$ROW_CONTRACT" \
  --require-nonempty=false >/dev/null

TRAIN_MATCHED_ROWS="$(read_json_field "$TRAIN_PACK_DIR/filter_summary.json" "matchedRows" || printf '0')"
OOS_MATCHED_ROWS="$(read_json_field "$OOS_PACK_DIR/filter_summary.json" "matchedRows" || printf '0')"

started_at="$(date +%s)"
if [[ "$TRAIN_MATCHED_ROWS" -lt 1 || "$OOS_MATCHED_ROWS" -lt 1 ]]; then
  write_no_rules_artifacts "$NO_RULES_SUMMARY_PATH" "$FREEZE_RESULT_PATH" "unsat_no_subscope_rows"
else
  run_exact_index_node tools/build_stepb_exact_index.mjs \
    --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
    --out-dir="$TRAIN_INDEX_DIR" \
    --surface="$EXPECTED_CONTEXT_SURFACE" \
    --train-start="$TRAIN_START" \
    --train-end="$TRAIN_END" \
    --min-hit-count="$MIN_HIT_COUNT" \
    --max-gap="$MAX_GAP_TRADING_DAYS" \
    --max-rule-size="$MAX_RULE_SIZE" \
    --max-seed-tokens="$MAX_SEED_TOKENS" \
    --max-rules="$MAX_RULES" \
    --max-search-states="$MAX_SEARCH_STATES_EFFECTIVE"

  run_mine_node tools/mine_perfect_prototypes_indexed.mjs \
    --index-dir="$TRAIN_INDEX_DIR" \
    --out-dir="$TRAIN_MINE_DIR" \
    --min-hit-count="$MIN_HIT_COUNT" \
    --max-gap="$MAX_GAP_TRADING_DAYS" \
    --max-rule-size="$MAX_RULE_SIZE" \
    --max-seed-tokens="$MAX_SEED_TOKENS" \
    --max-rules="$MAX_RULES" \
    --max-search-states="$MAX_SEARCH_STATES_EFFECTIVE" \
    --enable-train-matched-date-prune=true \
    --min-train-matched-dates="$MIN_TRAIN_MATCHED_DATES" \
    --min-train-matched-months="$MIN_TRAIN_MATCHED_MONTHS" \
    --min-train-matched-folds="$MIN_TRAIN_MATCHED_FOLDS" \
    --fold-scheme="$FOLD_SCHEME"

  node --input-type=module - "$TRAIN_MINE_DIR/catalog.json" "$TRAIN_RULE_IDS_PATH" <<'NODE'
import fs from "node:fs/promises"
const [catalogPath, outPath] = process.argv.slice(2)
const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"))
const ruleIds = Array.from(
  new Set(
    (Array.isArray(catalog?.rules) ? catalog.rules : [])
      .map((rule) => String(rule?.ruleId ?? "").trim())
      .filter(Boolean),
  ),
).sort((left, right) => left.localeCompare(right))
await fs.writeFile(outPath, `${ruleIds.join("\n")}\n`, "utf8")
NODE

  TRAIN_RULE_COUNT="$(awk 'NF { count += 1 } END { print count + 0 }' "$TRAIN_RULE_IDS_PATH")"
  if [[ "$TRAIN_RULE_COUNT" -lt 1 ]]; then
    write_no_rules_artifacts "$NO_RULES_SUMMARY_PATH" "$FREEZE_RESULT_PATH" "train_mine_produced_zero_rules"
  else
    node tools/build_curated_perfect_prototype_catalog.mjs \
      --source-catalog="$TRAIN_MINE_DIR/catalog.json" \
      --rule-ids-file="$TRAIN_RULE_IDS_PATH" \
      --label="${SELECTION_LINE_ID}_all_rules" \
      --note="line=${SELECTION_LINE_ID} windowId=${WINDOW_ID} windowKind=${WINDOW_KIND} sourceRunId=${SOURCE_RUN_ID} surface=${EXPECTED_CONTEXT_SURFACE} splitPolicy=${SPLIT_POLICY} foldScheme=${FOLD_SCHEME} train=${TRAIN_START}:${TRAIN_END} oos=${OOS_START}:${OOS_END}" \
      > "$FREEZE_RESULT_PATH"

    FROZEN_CATALOG_PATH="$(read_json_field "$FREEZE_RESULT_PATH" "outPath")"
    EXPECTED_CATALOG_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "catalogContentSha256")"
    EXPECTED_RULE_IDS_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "ruleIdsSha256")"

    run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
      --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
      --catalog="$FROZEN_CATALOG_PATH" \
      --out-dir="$TRAIN_REPORT_DIR" \
      --selection-mode="$SELECTION_MODE" \
      --start="$TRAIN_START" \
      --end="$TRAIN_END" \
      --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
      --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

    run_open_pack_node tools/apply_perfect_prototypes.mjs \
      --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
      --catalog="$FROZEN_CATALOG_PATH" \
      --out-dir="$TRAIN_APPLY_RAW_DIR" \
      --selection-mode="$SELECTION_MODE" \
      --start="$TRAIN_START" \
      --end="$TRAIN_END" \
      --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
      --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

    run_open_pack_node tools/apply_perfect_prototypes.mjs \
      --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
      --catalog="$FROZEN_CATALOG_PATH" \
      --out-dir="$TRAIN_APPLY_CLOSE28_DIR" \
      --selection-mode="$SELECTION_MODE" \
      --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
      --candle-path="$CANDLE_PATH" \
      --start="$TRAIN_START" \
      --end="$TRAIN_END" \
      --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
      --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

    run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
      --input="$OOS_PACK_DIR/daily_pack.jsonl" \
      --catalog="$FROZEN_CATALOG_PATH" \
      --out-dir="$OOS_REPORT_DIR" \
      --selection-mode="$SELECTION_MODE" \
      --start="$OOS_START" \
      --end="$OOS_END" \
      --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
      --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

    run_open_pack_node tools/apply_perfect_prototypes.mjs \
      --input="$OOS_PACK_DIR/daily_pack.jsonl" \
      --catalog="$FROZEN_CATALOG_PATH" \
      --out-dir="$OOS_APPLY_RAW_DIR" \
      --selection-mode="$SELECTION_MODE" \
      --start="$OOS_START" \
      --end="$OOS_END" \
      --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
      --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

    run_open_pack_node tools/apply_perfect_prototypes.mjs \
      --input="$OOS_PACK_DIR/daily_pack.jsonl" \
      --catalog="$FROZEN_CATALOG_PATH" \
      --out-dir="$OOS_APPLY_CLOSE28_DIR" \
      --selection-mode="$SELECTION_MODE" \
      --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
      --candle-path="$CANDLE_PATH" \
      --start="$OOS_START" \
      --end="$OOS_END" \
      --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
      --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

    run_open_pack_node tools/report_stepb_plus_lite_open_eval_leaderboard.mjs \
      --catalog="$FROZEN_CATALOG_PATH" \
      --train-input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
      --train-report-dir="$TRAIN_REPORT_DIR" \
      --train-apply-raw-dir="$TRAIN_APPLY_RAW_DIR" \
      --train-apply-close28-dir="$TRAIN_APPLY_CLOSE28_DIR" \
      --oos-input="$OOS_PACK_DIR/daily_pack.jsonl" \
      --oos-report-dir="$OOS_REPORT_DIR" \
      --oos-apply-raw-dir="$OOS_APPLY_RAW_DIR" \
      --oos-apply-close28-dir="$OOS_APPLY_CLOSE28_DIR" \
      --out-dir="$LEADERBOARD_DIR" \
      --run-id="$RUN_ID" \
      --split-policy="strict_label_boundary" \
      --line-id="$SELECTION_LINE_ID" \
      --selection-mode="$SELECTION_MODE" \
      --config-path="$CONFIG_PATH" \
      --config-sha256="$CONFIG_SHA256" \
      --train-config-path="$CONFIG_PATH" \
      --train-config-sha256="$CONFIG_SHA256" \
      --oos-config-path="$CONFIG_PATH" \
      --oos-config-sha256="$CONFIG_SHA256" \
      --train-start="$TRAIN_START" \
      --train-end="$TRAIN_END" \
      --oos-start="$OOS_START" \
      --oos-end="$OOS_END"
  fi
fi
finished_at="$(date +%s)"
elapsed_sec="$(( finished_at - started_at ))"

node --input-type=module - "$RUNTIME_SUMMARY_PATH" "$WINDOW_ID" "$WINDOW_KIND" "$SOURCE_RUN_ID" "$RUN_ID" "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END" "$MAX_SEARCH_STATES_EFFECTIVE" "$MAX_RULES" "$elapsed_sec" "$CONFIG_PATH" "$FREEZE_RESULT_PATH" "$NO_RULES_SUMMARY_PATH" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"

const [
  outPath,
  windowId,
  windowKind,
  sourceRunId,
  runId,
  trainStart,
  trainEnd,
  oosStart,
  oosEnd,
  maxSearchStates,
  maxRules,
  wallClockSec,
  configPath,
  freezeResultPath,
  noRulesSummaryPath,
] = process.argv.slice(2)
await writeJson(outPath, {
  generatedAt: new Date().toISOString(),
  windowId,
  windowKind,
  sourceRunId,
  runId,
  trainStart,
  trainEnd,
  oosStart,
  oosEnd,
  maxSearchStates: Number(maxSearchStates),
  maxRules: Number(maxRules),
  wallClockSec: Number(wallClockSec),
  configPath,
  freezeResultPath,
  noRulesSummaryPath,
})
NODE

echo "[done] tp12 no-stop LOW_GAP_TOP window completed runId=${RUN_ID} windowId=${WINDOW_ID} sourceRunId=${SOURCE_RUN_ID}"
