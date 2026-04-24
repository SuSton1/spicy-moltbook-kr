#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_RUN_ID="perfect_proto_stepb_plus_lite_open_eval_$(date +%Y%m%d_%H%M%S)"
EXPECTED_BASELINE_LINE_ID="stepb_dplus1_plus_lite"
EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_CONTEXT_SURFACE="v3_contextual_plus_lite"
OPEN_PACK_NODE_HEAP_MB="6144"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
DEFAULT_DISCOVERY_UNIVERSE_ID="afree_open"
DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS="3"

CONFIG_PATH="$DEFAULT_CONFIG"
RUN_ID="$DEFAULT_RUN_ID"
CATALOG_PATH=""
EXPECTED_CATALOG_SHA256=""
EXPECTED_RULE_IDS_SHA256=""
SPLIT_POLICY=""
TRAIN_START="2020-11-27"
TRAIN_END="2024-12-31"
OOS_START="2025-01-01"
OOS_END="2026-01-31"
SELECTION_MODE="union_all"
CLOSE28_FILTER_PCT="28"
DISCOVERY_UNIVERSE_ID="$DEFAULT_DISCOVERY_UNIVERSE_ID"
RECENT_IMPULSE_LOOKBACK_DAYS="$DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"
ENABLED_RECENT_IMPULSE_LANES=""
ALLOWED_STEPA_LANES=""
USES_STEPA_SEED_INPUT="0"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_open_pack_node() {
  NODE_OPTIONS="--max-old-space-size=$OPEN_PACK_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<EOF
Usage: bash tools/server_run_stepb_plus_lite_open_eval.sh \
  --catalog=/abs/path/frozen_catalog.json \
  --expected-catalog-sha256=<sha256> \
  --expected-rule-ids-sha256=<sha256> \
  --split-policy=decision_date_only|strict_label_boundary \
  [--config=/abs/path/config.json] [--run-id=<run_id>] \
  [--train-start=YYYY-MM-DD] [--train-end=YYYY-MM-DD] \
  [--oos-start=YYYY-MM-DD] [--oos-end=YYYY-MM-DD] \
  [--selection-mode=union_all|champion_only|top2_per_day_union] [--close28-filter-pct=28] \
  [--discovery-universe-id=afree_open|recent_impulse_upto_1d|...|recent_impulse_upto_8d|same_day_plus_recent_upto_1d|...|same_day_plus_recent_upto_8d] \
  [--recent-impulse-lookback-days=1..8]
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --catalog=*) CATALOG_PATH="${arg#*=}" ;;
    --expected-catalog-sha256=*) EXPECTED_CATALOG_SHA256="${arg#*=}" ;;
    --expected-rule-ids-sha256=*) EXPECTED_RULE_IDS_SHA256="${arg#*=}" ;;
    --split-policy=*) SPLIT_POLICY="${arg#*=}" ;;
    --train-start=*) TRAIN_START="${arg#*=}" ;;
    --train-end=*) TRAIN_END="${arg#*=}" ;;
    --oos-start=*) OOS_START="${arg#*=}" ;;
    --oos-end=*) OOS_END="${arg#*=}" ;;
    --selection-mode=*) SELECTION_MODE="${arg#*=}" ;;
    --close28-filter-pct=*) CLOSE28_FILTER_PCT="${arg#*=}" ;;
    --discovery-universe-id=*) DISCOVERY_UNIVERSE_ID="${arg#*=}" ;;
    --recent-impulse-lookback-days=*) RECENT_IMPULSE_LOOKBACK_DAYS="${arg#*=}" ;;
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
  fatal "server-only open-eval wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi
[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"

if [[ "$CATALOG_PATH" != /* ]]; then
  CATALOG_PATH="$ROOT_DIR/$CATALOG_PATH"
fi
[[ -f "$CATALOG_PATH" ]] || fatal "catalog not found: $CATALOG_PATH"
[[ -n "$EXPECTED_CATALOG_SHA256" ]] || fatal "missing --expected-catalog-sha256"
[[ -n "$EXPECTED_RULE_IDS_SHA256" ]] || fatal "missing --expected-rule-ids-sha256"

case "$SPLIT_POLICY" in
  decision_date_only|strict_label_boundary) ;;
  "") fatal "missing --split-policy=decision_date_only|strict_label_boundary" ;;
  *) fatal "invalid --split-policy: $SPLIT_POLICY" ;;
esac

case "$SELECTION_MODE" in
  union_all|champion_only|top2_per_day_union) ;;
  *) fatal "invalid --selection-mode: $SELECTION_MODE" ;;
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

[[ -f "$LIB_PATH" ]] || fatal "shared Step-B baseline helper library not found: $LIB_PATH"
source "$LIB_PATH"
validate_recent_impulse_runtime_config "$CONFIG_PATH" "$DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"
eval "$(
  node --input-type=module - "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" "$DEFAULT_DISCOVERY_UNIVERSE_ID" "$DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"

const [discoveryUniverseId, requestedLookbackTradingDaysRaw, defaultDiscoveryUniverseId, defaultLookbackRaw] =
  process.argv.slice(2)
const requestedLookbackTradingDays = Number(requestedLookbackTradingDaysRaw)
const defaultLookback = Number(defaultLookbackRaw)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays,
})
if (contract.discoveryUniverseId === defaultDiscoveryUniverseId && requestedLookbackTradingDays !== defaultLookback) {
  throw new Error(
    `afree_open discovery universe is pinned to recentImpulseLookbackTradingDays=${defaultLookback}; got ${requestedLookbackTradingDays}`,
  )
}
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
console.log(`USES_STEPA_SEED_INPUT=${contract.usesStepASeedInput ? 1 : 0}`)
NODE
)"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
TRAIN_STEPA_RUN_ID="${RUN_ID}_train_stepa"
OOS_STEPA_RUN_ID="${RUN_ID}_oos_stepa"
TRAIN_CONFIG_PATH="$RUN_DIR/train_runtime_config.json"
OOS_CONFIG_PATH="$RUN_DIR/oos_runtime_config.json"
TRAIN_STEPA_DIR="$ROOT_DIR/artifacts/runs/$TRAIN_STEPA_RUN_ID/step-a"
OOS_STEPA_DIR="$ROOT_DIR/artifacts/runs/$OOS_STEPA_RUN_ID/step-a"
TRAIN_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-train-pack"
OOS_PACK_DIR="$RUN_DIR/step-perfect-prototype-open-oos-pack"
TRAIN_REPORT_DIR="$RUN_DIR/step-perfect-prototype-open-train-report"
OOS_REPORT_DIR="$RUN_DIR/step-perfect-prototype-open-oos-report"
TRAIN_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-raw"
TRAIN_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-close28"
OOS_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-raw"
OOS_APPLY_CLOSE28_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-close28"
LEADERBOARD_DIR="$RUN_DIR/step-perfect-prototype-open-eval-report"

mkdir -p "$RUN_DIR"
validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"

write_period_config "$CONFIG_PATH" "$TRAIN_CONFIG_PATH" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"
write_period_config "$CONFIG_PATH" "$OOS_CONFIG_PATH" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"
rewrite_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
rewrite_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_baseline_contract_config "$TRAIN_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_baseline_contract_config "$OOS_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$TRAIN_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_recent_impulse_runtime_config "$OOS_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"

CONFIG_SHA256="$(compute_sha256 "$CONFIG_PATH")"
TRAIN_CONFIG_SHA256="$(compute_sha256 "$TRAIN_CONFIG_PATH")"
OOS_CONFIG_SHA256="$(compute_sha256 "$OOS_CONFIG_PATH")"

TRAIN_PACK_ARGS=(
  --config="$TRAIN_CONFIG_PATH"
  --out-dir="$TRAIN_PACK_DIR"
  --start="$TRAIN_START"
  --end="$TRAIN_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_stepb_open_eval_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id="$DISCOVERY_UNIVERSE_ID"
  --requested-lookback-trading-days="$RECENT_IMPULSE_LOOKBACK_DAYS"
)
OOS_PACK_ARGS=(
  --config="$OOS_CONFIG_PATH"
  --out-dir="$OOS_PACK_DIR"
  --start="$OOS_START"
  --end="$OOS_END"
  --surface-name="$EXPECTED_CONTEXT_SURFACE"
  --source-type=perfect_prototype_stepb_open_eval_pack
  --line-id="$EXPECTED_BASELINE_LINE_ID"
  --discovery-universe-id="$DISCOVERY_UNIVERSE_ID"
  --requested-lookback-trading-days="$RECENT_IMPULSE_LOOKBACK_DAYS"
)
if [[ "$USES_STEPA_SEED_INPUT" == "1" ]]; then
  node src/cli.mjs step-a --config="$TRAIN_CONFIG_PATH" --run-id="$TRAIN_STEPA_RUN_ID"
  node src/cli.mjs step-a --config="$OOS_CONFIG_PATH" --run-id="$OOS_STEPA_RUN_ID"
  link_stage "step-a-train" "$TRAIN_STEPA_DIR"
  link_stage "step-a-oos" "$OOS_STEPA_DIR"
  TRAIN_PACK_ARGS+=(
    --seed-input="$TRAIN_STEPA_DIR/events_high8_lite.jsonl"
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES"
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"
  )
  OOS_PACK_ARGS+=(
    --seed-input="$OOS_STEPA_DIR/events_high8_lite.jsonl"
    --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES"
    --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"
  )
fi

run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs "${TRAIN_PACK_ARGS[@]}"
apply_strict_label_boundary_to_daily_pack "$TRAIN_PACK_DIR" "$TRAIN_START" "$TRAIN_END" "$SPLIT_POLICY"

run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs "${OOS_PACK_ARGS[@]}"
apply_strict_label_boundary_to_daily_pack "$OOS_PACK_DIR" "$OOS_START" "$OOS_END" "$SPLIT_POLICY"

link_stage "step-perfect-prototype-open-train-pack" "$TRAIN_PACK_DIR"
link_stage "step-perfect-prototype-open-oos-pack" "$OOS_PACK_DIR"

run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
  --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$TRAIN_REPORT_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$TRAIN_APPLY_RAW_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$TRAIN_PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$TRAIN_APPLY_CLOSE28_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --start="$TRAIN_START" \
  --end="$TRAIN_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/report_perfect_prototypes_oos.mjs \
  --input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$OOS_REPORT_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$OOS_APPLY_RAW_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$OOS_PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$OOS_APPLY_CLOSE28_DIR" \
  --selection-mode="$SELECTION_MODE" \
  --exclude-recommendation-close-ret-pct-gte="$CLOSE28_FILTER_PCT" \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --start="$OOS_START" \
  --end="$OOS_END" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

run_open_pack_node tools/report_stepb_plus_lite_open_eval_leaderboard.mjs \
  --catalog="$CATALOG_PATH" \
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
  --split-policy="$SPLIT_POLICY" \
  --line-id="$EXPECTED_BASELINE_LINE_ID" \
  --selection-mode="$SELECTION_MODE" \
  --config-path="$CONFIG_PATH" \
  --config-sha256="$CONFIG_SHA256" \
  --train-config-path="$TRAIN_CONFIG_PATH" \
  --train-config-sha256="$TRAIN_CONFIG_SHA256" \
  --oos-config-path="$OOS_CONFIG_PATH" \
  --oos-config-sha256="$OOS_CONFIG_SHA256" \
  --train-start="$TRAIN_START" \
  --train-end="$TRAIN_END" \
  --oos-start="$OOS_START" \
  --oos-end="$OOS_END"

echo "[ok] step-b plus-lite open-eval run complete"
echo "runId=$RUN_ID"
echo "discoveryUniverse=$DISCOVERY_UNIVERSE_ID"
echo "allowedStepALanes=${ALLOWED_STEPA_LANES:-}"
echo "catalog=$CATALOG_PATH"
echo "catalogContentSha256=$EXPECTED_CATALOG_SHA256"
echo "ruleIdsSha256=$EXPECTED_RULE_IDS_SHA256"
echo "trainPackDir=$TRAIN_PACK_DIR"
echo "oosPackDir=$OOS_PACK_DIR"
echo "trainReportDir=$TRAIN_REPORT_DIR"
echo "oosReportDir=$OOS_REPORT_DIR"
echo "leaderboardDir=$LEADERBOARD_DIR"
