#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONFIG_PATH="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_DATE="$(date +%F)"
DEFAULT_RUN_ID_PREFIX="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_RUN_ID_PREFIX:-perfect_proto_stepb_plus_lite_curated_live_after_close}"
DEFAULT_RUN_ID="${DEFAULT_RUN_ID_PREFIX}_${DEFAULT_DATE//-/}_$(date +%H%M%S)"
EXPECTED_BASELINE_LINE_ID="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_LINE_ID:-stepb_dplus1_plus_lite}"
EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_CONTEXT_SURFACE="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_CONTEXT_SURFACE:-v3_contextual_plus_lite}"
EXPECTED_SOURCE_TYPE="perfect_prototype_stepb_open_eval_pack"
EXPECTED_SELECTION_MODE="union_all"
EXPECTED_SPLIT_POLICY="decision_date_only"
DEFAULT_DISCOVERY_UNIVERSE_ID="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_DISCOVERY_UNIVERSE_ID:-same_day_plus_recent_upto_3d}"
DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_RECENT_IMPULSE_LOOKBACK_DAYS:-3}"
EXPECTED_DISCOVERY_KIND="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_DISCOVERY_KIND:-same_day_plus_recent}"
DEFAULT_EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_CLOSE_RET_FILTER_GTE:-28}"
OPEN_PACK_NODE_HEAP_MB="6144"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
ALLOW_MUTABLE_CATALOG="${PERFECT_PROTO_ALLOW_MUTABLE_CATALOG:-false}"

CONFIG_PATH="${STEPB_PLUS_LITE_AFTER_CLOSE_WRAPPER_CONFIG:-$DEFAULT_CONFIG_PATH}"
CATALOG_PATH=""
TARGET_DATE="$DEFAULT_DATE"
RUN_ID="$DEFAULT_RUN_ID"
EXPECTED_CATALOG_SHA256=""
EXPECTED_RULE_IDS_SHA256=""
DISCOVERY_UNIVERSE_ID="$DEFAULT_DISCOVERY_UNIVERSE_ID"
RECENT_IMPULSE_LOOKBACK_DAYS="$DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"
ENABLED_RECENT_IMPULSE_LANES=""
ALLOWED_STEPA_LANES=""
EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE="$DEFAULT_EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

run_open_pack_node() {
  NODE_OPTIONS="--max-old-space-size=$OPEN_PACK_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

usage() {
  cat <<EOF
Usage: bash tools/server_stepb_plus_lite_curated_after_close.sh \
  --catalog=/abs/path/catalog.json \
  --expected-catalog-sha256=<sha256> \
  --expected-rule-ids-sha256=<sha256> \
  --discovery-universe-id=recent_impulse_upto_1d..recent_impulse_upto_8d|same_day_plus_recent_upto_1d..same_day_plus_recent_upto_8d \
  --recent-impulse-lookback-days=1..8 \
  [--exclude-recommendation-close-ret-pct-gte=28] \
  [--date=YYYY-MM-DD] [--config=/abs/path/config.json] [--run-id=<run_id>] [--allow-mutable-catalog=true]
EOF
}

for arg in "$@"; do
  case "$arg" in
    --date=*) TARGET_DATE="${arg#*=}" ;;
    --catalog=*) CATALOG_PATH="${arg#*=}" ;;
    --expected-catalog-sha256=*) EXPECTED_CATALOG_SHA256="${arg#*=}" ;;
    --expected-rule-ids-sha256=*) EXPECTED_RULE_IDS_SHA256="${arg#*=}" ;;
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --discovery-universe-id=*) DISCOVERY_UNIVERSE_ID="${arg#*=}" ;;
    --recent-impulse-lookback-days=*) RECENT_IMPULSE_LOOKBACK_DAYS="${arg#*=}" ;;
    --exclude-recommendation-close-ret-pct-gte=*) EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE="${arg#*=}" ;;
    --allow-mutable-catalog=*) ALLOW_MUTABLE_CATALOG="${arg#*=}" ;;
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
  fatal "server-only widened after-close wrapper must run from $EXPECTED_REAL, got $ROOT_REAL"
fi

if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi
[[ -f "$CONFIG_PATH" ]] || fatal "config not found: $CONFIG_PATH"

if [[ -z "$CATALOG_PATH" ]]; then
  fatal "missing --catalog. same_day_plus_recent live apply requires an explicit frozen catalog path."
fi
if [[ "$CATALOG_PATH" != /* ]]; then
  CATALOG_PATH="$ROOT_DIR/$CATALOG_PATH"
fi
[[ -f "$CATALOG_PATH" ]] || fatal "catalog not found: $CATALOG_PATH"

if [[ "$ALLOW_MUTABLE_CATALOG" != "true" && "$CATALOG_PATH" != *"/artifacts/curated/frozen/"*"/catalog.json" ]]; then
  fatal "same_day_plus_recent live apply requires an immutable frozen catalog path under artifacts/curated/frozen/"
fi

CATALOG_MANIFEST_PATH="$(dirname "$CATALOG_PATH")/manifest.json"
[[ -f "$CATALOG_MANIFEST_PATH" ]] || fatal "frozen catalog manifest not found: $CATALOG_MANIFEST_PATH"

[[ -n "$EXPECTED_CATALOG_SHA256" ]] || fatal "missing --expected-catalog-sha256"
[[ -n "$EXPECTED_RULE_IDS_SHA256" ]] || fatal "missing --expected-rule-ids-sha256"
[[ "$EXPECTED_CATALOG_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fatal "invalid --expected-catalog-sha256: $EXPECTED_CATALOG_SHA256"
[[ "$EXPECTED_RULE_IDS_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || fatal "invalid --expected-rule-ids-sha256: $EXPECTED_RULE_IDS_SHA256"
[[ "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fatal "invalid --date: $TARGET_DATE"
[[ "$RECENT_IMPULSE_LOOKBACK_DAYS" =~ ^[0-9]+$ ]] || fatal "invalid --recent-impulse-lookback-days: $RECENT_IMPULSE_LOOKBACK_DAYS"
[[ "$EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE" =~ ^[0-9]+([.][0-9]+)?$ ]] || fatal "invalid --exclude-recommendation-close-ret-pct-gte: $EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE"

[[ -f "$LIB_PATH" ]] || fatal "shared Step-B baseline helper library not found: $LIB_PATH"
source "$LIB_PATH"

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$CONFIG_PATH" "$DEFAULT_RECENT_IMPULSE_LOOKBACK_DAYS"

eval "$(
  node --input-type=module - "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" "$EXPECTED_DISCOVERY_KIND" <<'NODE'
import { resolvePerfectPrototypeDiscoveryUniverse } from "./src/lib/perfect_prototype_multiline_contract.mjs"

const [discoveryUniverseId, requestedLookbackTradingDaysRaw, expectedDiscoveryKind] = process.argv.slice(2)
const requestedLookbackTradingDays = Number(requestedLookbackTradingDaysRaw)
const contract = resolvePerfectPrototypeDiscoveryUniverse({
  discoveryUniverseId,
  requestedLookbackTradingDays,
})
if (expectedDiscoveryKind === "same_day_plus_recent" && contract.isSameDayPlusRecentUniverse !== true) {
  throw new Error(
    `server_stepb_plus_lite_curated_after_close.sh requires same_day_plus_recent discovery universe, got ${discoveryUniverseId}`,
  )
}
if (expectedDiscoveryKind === "recent_impulse" && contract.isRecentImpulseUniverse !== true) {
  throw new Error(
    `server_stepb_plus_lite_curated_after_close.sh requires recent_impulse discovery universe, got ${discoveryUniverseId}`,
  )
}
if (!["same_day_plus_recent", "recent_impulse"].includes(String(expectedDiscoveryKind ?? "").trim())) {
  throw new Error(`unsupported expected discovery kind: ${expectedDiscoveryKind ?? "null"}`)
}
console.log(`ENABLED_RECENT_IMPULSE_LANES=${contract.enabledRecentImpulseLanes.join(",")}`)
console.log(`ALLOWED_STEPA_LANES=${contract.allowedStepALanes.join(",")}`)
NODE
)"

node - "$CATALOG_PATH" "$CATALOG_MANIFEST_PATH" "$EXPECTED_CONTEXT_SURFACE" "$DISCOVERY_UNIVERSE_ID" "$RECENT_IMPULSE_LOOKBACK_DAYS" <<'NODE'
const fs = require("fs")

const [catalogPath, manifestPath, expectedSurface, expectedDiscoveryUniverseId, expectedLookbackRaw] =
  process.argv.slice(2)
const expectedLookback = Number(expectedLookbackRaw)
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
if (rules.length < 1) {
  throw new Error(`Curated catalog has no rules: ${catalogPath}`)
}
const hasParentRule = rules.some((rule) => String(rule?.ruleLevel ?? "").trim().toLowerCase() === "parent")
const allPrototypeChildRules = rules.every((rule) => String(rule?.ruleId ?? "").trim().startsWith("PP_"))
if (hasParentRule || !allPrototypeChildRules) {
  throw new Error("same_day_plus_recent after-close wrapper only supports Step-B child PP_* catalogs.")
}
const surface = String(manifest?.surface ?? manifest?.selectionSurface ?? "").trim().toLowerCase()
if (surface !== String(expectedSurface).trim().toLowerCase()) {
  throw new Error(`same_day_plus_recent live wrapper requires surface=${expectedSurface}, got ${surface || "null"}`)
}
const datasetContract =
  manifest?.datasetContract ??
  manifest?.summary?.datasetContract ??
  catalog?.metadata?.datasetContract ??
  null
if (!datasetContract || typeof datasetContract !== "object") {
  throw new Error(`frozen same_day_plus_recent catalog is missing datasetContract: ${manifestPath}`)
}
const discoveryUniverseId = String(datasetContract?.discoveryUniverseId ?? "").trim()
if (discoveryUniverseId !== expectedDiscoveryUniverseId) {
  throw new Error(
    `frozen catalog discoveryUniverseId mismatch: expected=${expectedDiscoveryUniverseId} actual=${discoveryUniverseId || "null"}`,
  )
}
const requestedLookbackTradingDays = Number(datasetContract?.requestedLookbackTradingDays)
if (requestedLookbackTradingDays !== expectedLookback) {
  throw new Error(
    `frozen catalog requestedLookbackTradingDays mismatch: expected=${expectedLookback} actual=${datasetContract?.requestedLookbackTradingDays ?? "null"}`,
  )
}
NODE

eval "$(
  node --input-type=module - "$ROOT_DIR/data/candle_daily.jsonl" "$ROOT_DIR/data/universe_daily.jsonl" <<'NODE'
import fs from "node:fs"
import readline from "node:readline"

const [candlePath, universePath] = process.argv.slice(2)

const readLatestDateKey = async (filePath) => {
  let latest = ""
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  try {
    for await (const line of rl) {
      const trimmed = String(line ?? "").trim()
      if (!trimmed) continue
      const row = JSON.parse(trimmed)
      const dateKey = String(row?.dateKey ?? row?.tradingDateKey ?? "").trim()
      if (dateKey && dateKey > latest) latest = dateKey
    }
  } finally {
    rl.close()
  }
  return latest
}

const candleLatestDate = await readLatestDateKey(candlePath)
const universeLatestDate = await readLatestDateKey(universePath)
console.log(`CANDLE_LATEST_DATE=${candleLatestDate}`)
console.log(`UNIVERSE_LATEST_DATE=${universeLatestDate}`)
NODE
)"

[[ -n "${CANDLE_LATEST_DATE:-}" ]] || fatal "failed to resolve latest candle date from $ROOT_DIR/data/candle_daily.jsonl"
[[ -n "${UNIVERSE_LATEST_DATE:-}" ]] || fatal "failed to resolve latest universe date from $ROOT_DIR/data/universe_daily.jsonl"
if [[ "$CANDLE_LATEST_DATE" != "$UNIVERSE_LATEST_DATE" ]]; then
  fatal "candle/universe latest dates are not aligned: candle=$CANDLE_LATEST_DATE universe=$UNIVERSE_LATEST_DATE"
fi
if [[ "$TARGET_DATE" != "$CANDLE_LATEST_DATE" ]]; then
  fatal "requested --date must equal the latest common data date: date=$TARGET_DATE latest=$CANDLE_LATEST_DATE"
fi

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
RUNTIME_CONFIG_PATH="$RUN_DIR/runtime_config.json"
STEPA_RUN_ID="${RUN_ID}_stepa"
STEPA_DIR="$ROOT_DIR/artifacts/runs/$STEPA_RUN_ID/step-a"
PACK_DIR="$RUN_DIR/step-perfect-prototype-open-live-pack"
APPLY_DIR="$RUN_DIR/step-perfect-prototype-open-live-apply"
mkdir -p "$RUN_DIR"

write_period_config "$CONFIG_PATH" "$RUNTIME_CONFIG_PATH" "$TARGET_DATE" "$TARGET_DATE" "$EXPECTED_SPLIT_POLICY"
rewrite_recent_impulse_runtime_config "$RUNTIME_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"
validate_baseline_contract_config "$RUNTIME_CONFIG_PATH" "$EXPECTED_BASELINE_LINE_ID" "$EXPECTED_BASELINE_MAX_GAP_TRADING_DAYS" "$EXPECTED_CONTEXT_SURFACE"
validate_recent_impulse_runtime_config "$RUNTIME_CONFIG_PATH" "$RECENT_IMPULSE_LOOKBACK_DAYS"

node src/cli.mjs step-a --config="$RUNTIME_CONFIG_PATH" --run-id="$STEPA_RUN_ID"
link_stage "step-a" "$STEPA_DIR"

run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs \
  --config="$RUNTIME_CONFIG_PATH" \
  --out-dir="$PACK_DIR" \
  --start="$TARGET_DATE" \
  --end="$TARGET_DATE" \
  --surface-name="$EXPECTED_CONTEXT_SURFACE" \
  --source-type="$EXPECTED_SOURCE_TYPE" \
  --line-id="$EXPECTED_BASELINE_LINE_ID" \
  --seed-input="$STEPA_DIR/events_high8_lite.jsonl" \
  --discovery-universe-id="$DISCOVERY_UNIVERSE_ID" \
  --requested-lookback-trading-days="$RECENT_IMPULSE_LOOKBACK_DAYS" \
  --enabled-recent-impulse-lanes="$ENABLED_RECENT_IMPULSE_LANES" \
  --allowed-stepa-lanes="$ALLOWED_STEPA_LANES"

apply_strict_label_boundary_to_daily_pack "$PACK_DIR" "$TARGET_DATE" "$TARGET_DATE" "$EXPECTED_SPLIT_POLICY"

run_open_pack_node tools/apply_perfect_prototypes.mjs \
  --input="$PACK_DIR/daily_pack.jsonl" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$APPLY_DIR" \
  --selection-mode="$EXPECTED_SELECTION_MODE" \
  --start="$TARGET_DATE" \
  --end="$TARGET_DATE" \
  --exclude-recommendation-close-ret-pct-gte="$EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE" \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

[[ -f "$PACK_DIR/summary.json" ]] || fatal "missing pack summary: $PACK_DIR/summary.json"
[[ -f "$PACK_DIR/daily_pack.jsonl" ]] || fatal "missing daily pack: $PACK_DIR/daily_pack.jsonl"
[[ -f "$APPLY_DIR/summary.json" ]] || fatal "missing apply summary: $APPLY_DIR/summary.json"
[[ -f "$APPLY_DIR/deduped_symbols.jsonl" ]] || fatal "missing deduped output: $APPLY_DIR/deduped_symbols.jsonl"

echo "[ok] step-b plus-lite curated after-close run complete"
echo "runId=$RUN_ID"
echo "catalog=$CATALOG_PATH"
echo "packSummary=$PACK_DIR/summary.json"
echo "dailyPack=$PACK_DIR/daily_pack.jsonl"
echo "summary=$APPLY_DIR/summary.json"
echo "deduped=$APPLY_DIR/deduped_symbols.jsonl"
