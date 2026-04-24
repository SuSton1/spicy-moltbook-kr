#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_baseline.json"
DEFAULT_RUN_ID="perfect_proto_stepb_dplus1_baseline_$(date +%Y%m%d_%H%M%S)"
EXPECTED_BASELINE_LINE_ID="stepb_dplus1_baseline"
EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_CONTEXT_SURFACE="v3_contextual"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"

CONFIG_PATH="$DEFAULT_CONFIG"
RUN_ID="$DEFAULT_RUN_ID"
SPLIT_POLICY=""
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
SELECTION_MODE="union_all"
CLOSE28_FILTER_PCT="28"
MIN_HIT_COUNT="6"
MAX_GAP_TRADING_DAYS="$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS"
MAX_RULE_SIZE="6"
MAX_SEED_TOKENS="4000"
MAX_RULES="4000"
MAX_SEARCH_STATES="20000000"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepb_dplus1_baseline.sh --split-policy=decision_date_only|strict_label_boundary [--config=/abs/path/config.json] [--run-id=<run_id>] [--train-start=YYYY-MM-DD] [--train-end=YYYY-MM-DD] [--oos-start=YYYY-MM-DD] [--oos-end=YYYY-MM-DD] [--selection-mode=union_all|champion_only] [--close28-filter-pct=28] [--min-hit-count=6] [--max-gap=100000] [--max-rule-size=6] [--max-seed-tokens=4000] [--max-rules=4000] [--max-search-states=20000000]
Note: stepb_dplus1_baseline is locked to the historical no-gap semantics and must use --max-gap=100000.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --split-policy=*) SPLIT_POLICY="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --selection-mode=*) SELECTION_MODE="${arg#*=}" ;;
    --close28-filter-pct=*) CLOSE28_FILTER_PCT="${arg#*=}" ;;
    --min-hit-count=*) MIN_HIT_COUNT="${arg#*=}" ;;
    --max-gap=*) MAX_GAP_TRADING_DAYS="${arg#*=}" ;;
    --max-rule-size=*) MAX_RULE_SIZE="${arg#*=}" ;;
    --max-seed-tokens=*) MAX_SEED_TOKENS="${arg#*=}" ;;
    --max-rules=*) MAX_RULES="${arg#*=}" ;;
    --max-search-states=*) MAX_SEARCH_STATES="${arg#*=}" ;;
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
  fatal "server-only Step-B baseline wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
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

for value in "$TRAIN_START" "$TRAIN_END" "$OOS_START" "$OOS_END"; do
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fatal "invalid date: $value"
done

if [[ "$TRAIN_START" > "$TRAIN_END" ]]; then
  fatal "invalid train range: train-start ($TRAIN_START) must be <= train-end ($TRAIN_END)"
fi

if [[ "$OOS_START" > "$OOS_END" ]]; then
  fatal "invalid OOS range: oos-start ($OOS_START) must be <= oos-end ($OOS_END)"
fi

if [[ ! "$TRAIN_END" < "$OOS_START" ]]; then
  fatal "train/OOS ranges must not overlap: require train-end ($TRAIN_END) < oos-start ($OOS_START)"
fi

if [[ "$MAX_GAP_TRADING_DAYS" != "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" ]]; then
  fatal "$EXPECTED_BASELINE_LINE_ID is locked to historical no-gap semantics: require --max-gap=$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS, got $MAX_GAP_TRADING_DAYS"
fi

[[ -f "$LIB_PATH" ]] || fatal "shared Step-B baseline helper library not found: $LIB_PATH"
source "$LIB_PATH"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_RUN_ID="${RUN_ID}_train"
TRAIN_MINE_RUN_ID="${RUN_ID}_train_mine"
OOS_RUN_ID="${RUN_ID}_oos"
TRAIN_CONFIG_PATH="$RUN_DIR/train_runtime_config.json"
OOS_CONFIG_PATH="$RUN_DIR/oos_runtime_config.json"
TRAIN_RULE_IDS_PATH="$RUN_DIR/train_rule_ids_all.txt"
FREEZE_RESULT_PATH="$RUN_DIR/freeze_result.json"
TRAIN_REAPPLY_DIR="$RUN_DIR/step-perfect-prototype-train-reapply"
OOS_REPORT_DIR="$RUN_DIR/step-perfect-prototype-oos"
OOS_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-oos-apply-raw"
OOS_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-oos-apply-close28"
REPORT_DIR="$RUN_DIR/step-perfect-prototype-baseline-report"

mkdir -p "$RUN_DIR"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
write_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"
validate_baseline_contract_config "$TRAIN_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
CONFIG_SHA256="$(compute_sha256 "$CONFIG_PATH")"
TRAIN_CONFIG_SHA256="$(compute_sha256 "$TRAIN_CONFIG_PATH")"
node src/cli.mjs step-a --config="$TRAIN_CONFIG_PATH" --run-id="$TRAIN_RUN_ID"
node src/cli.mjs step-b --config="$TRAIN_CONFIG_PATH" --run-id="$TRAIN_RUN_ID"
apply_strict_label_boundary "$ROOT_DIR/artifacts/runs/$TRAIN_RUN_ID/step-b" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"
link_stage "step-a-train" "$ROOT_DIR/artifacts/runs/$TRAIN_RUN_ID/step-a"
link_stage "step-b-train" "$ROOT_DIR/artifacts/runs/$TRAIN_RUN_ID/step-b"

node tools/mine_perfect_prototypes.mjs \
  --source-run-id="$TRAIN_RUN_ID" \
  --out-run-id="$TRAIN_MINE_RUN_ID" \
  --surface="$EXPECTED_CONTEXT_SURFACE" \
  --min-hit-count="$MIN_HIT_COUNT" \
  --max-gap="$MAX_GAP_TRADING_DAYS" \
  --max-rule-size="$MAX_RULE_SIZE" \
  --max-seed-tokens="$MAX_SEED_TOKENS" \
  --max-rules="$MAX_RULES" \
  --max-search-states="$MAX_SEARCH_STATES"
link_stage "step-perfect-prototype-train" "$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype"

node --input-type=module - "$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype/catalog.json" "$TRAIN_RULE_IDS_PATH" <<'NODE'
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

node tools/build_curated_perfect_prototype_catalog.mjs \
  --source-catalog="$ROOT_DIR/artifacts/runs/$TRAIN_MINE_RUN_ID/step-perfect-prototype/catalog.json" \
  --rule-ids-file="$TRAIN_RULE_IDS_PATH" \
  --label="${EXPECTED_BASELINE_LINE_ID}_all_rules" \
  --note="line=$EXPECTED_BASELINE_LINE_ID surface=$EXPECTED_CONTEXT_SURFACE splitPolicy=$SPLIT_POLICY maxGap=$MAX_GAP_TRADING_DAYS train=$TRAIN_START:$TRAIN_END oos=$OOS_START:$OOS_END" \
  > "$FREEZE_RESULT_PATH"

FROZEN_CATALOG_PATH="$(read_json_field "$FREEZE_RESULT_PATH" "outPath")"
EXPECTED_CATALOG_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "catalogContentSha256")"
EXPECTED_RULE_IDS_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "ruleIdsSha256")"

node tools/report_perfect_prototypes_oos.mjs \
  --input="$ROOT_DIR/artifacts/runs/$TRAIN_RUN_ID/step-b/templates_lite.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$TRAIN_REAPPLY_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

write_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
validate_baseline_contract_config "$OOS_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
OOS_CONFIG_SHA256="$(compute_sha256 "$OOS_CONFIG_PATH")"
node src/cli.mjs step-a --config="$OOS_CONFIG_PATH" --run-id="$OOS_RUN_ID"
node src/cli.mjs step-b --config="$OOS_CONFIG_PATH" --run-id="$OOS_RUN_ID"
apply_strict_label_boundary "$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-b" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
link_stage "step-a-oos" "$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-a"
link_stage "step-b-oos" "$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-b"

node tools/report_perfect_prototypes_oos.mjs \
  --input="$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-b/templates_lite.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$OOS_REPORT_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

node tools/apply_perfect_prototypes.mjs \
  --input="$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-b/templates_lite.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$OOS_APPLY_RAW_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

node tools/apply_perfect_prototypes.mjs \
  --input="$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-b/templates_lite.jsonl" \
  --catalog="$FROZEN_CATALOG_PATH" \
  --out-dir="$OOS_APPLY_CLOSE28_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

node tools/report_stepb_dplus1_train_oos_leaderboard.mjs \
  --catalog="$FROZEN_CATALOG_PATH" \
  --train-input="$ROOT_DIR/artifacts/runs/$TRAIN_RUN_ID/step-b/templates_lite.jsonl" \
  --train-report-dir="$TRAIN_REAPPLY_DIR" \
  --oos-input="$ROOT_DIR/artifacts/runs/$OOS_RUN_ID/step-b/templates_lite.jsonl" \
  --oos-report-dir="$OOS_REPORT_DIR" \
  --oos-apply-raw-dir="$OOS_APPLY_RAW_DIR" \
  --oos-apply-close28-dir="$OOS_APPLY_CLOSE28_DIR" \
  --out-dir="$REPORT_DIR" \
  --run-id="$RUN_ID" \
  --split-policy="$SPLIT_POLICY" \
  --selection-mode="$SELECTION_MODE" \
  --close28-filter-pct="$CLOSE28_FILTER_PCT" \
  --max-gap="$MAX_GAP_TRADING_DAYS" \
  --config-path="$CONFIG_PATH" \
  --config-sha256="$CONFIG_SHA256" \
  --train-config-path="$TRAIN_CONFIG_PATH" \
  --train-config-sha256="$TRAIN_CONFIG_SHA256" \
  --oos-config-path="$OOS_CONFIG_PATH" \
  --oos-config-sha256="$OOS_CONFIG_SHA256" \
  --train-start="$TRAIN_START" \
  --train-end="$TRAIN_END" \
  --oos-start="$OOS_START" \
  --oos-end="$OOS_END" \
  --line-id="$EXPECTED_BASELINE_LINE_ID"

echo "[ok] step-b dplus1 baseline run complete"
echo "runId=$RUN_ID"
echo "splitPolicy=$SPLIT_POLICY"
echo "maxGapTradingDays=$MAX_GAP_TRADING_DAYS"
echo "frozenCatalog=$FROZEN_CATALOG_PATH"
echo "catalogContentSha256=$EXPECTED_CATALOG_SHA256"
echo "ruleIdsSha256=$EXPECTED_RULE_IDS_SHA256"
echo "trainRunId=$TRAIN_RUN_ID"
echo "trainMineRunId=$TRAIN_MINE_RUN_ID"
echo "oosRunId=$OOS_RUN_ID"
echo "trainReapplyDir=$TRAIN_REAPPLY_DIR"
echo "oosReportDir=$OOS_REPORT_DIR"
echo "oosApplyRawDir=$OOS_APPLY_RAW_DIR"
echo "oosApplyClose28Dir=$OOS_APPLY_CLOSE28_DIR"
echo "leaderboardDir=$REPORT_DIR"
