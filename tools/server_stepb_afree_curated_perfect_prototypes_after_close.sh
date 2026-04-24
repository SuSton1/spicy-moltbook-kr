#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"
DEFAULT_DATE="$(date +%F)"
DEFAULT_RUN_ID="perfect_proto_stepb_afree_live_after_close_${DEFAULT_DATE//-/}_$(date +%H%M%S)"
EXPECTED_LINE_ID="stepb_dplus1_plus_lite"
EXPECTED_MAX_GAP_TRADING_DAYS="100000"
EXPECTED_SURFACE="v3_contextual_plus_lite"
EXPECTED_SOURCE_TYPE="perfect_prototype_stepb_open_eval_pack"
EXPECTED_SELECTION_MODE="union_all"
DEFAULT_EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE="${STEPB_AFREE_AFTER_CLOSE_WRAPPER_CLOSE_RET_FILTER_GTE:-28}"
OPEN_PACK_NODE_HEAP_MB="6144"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"
ALLOW_MUTABLE_CATALOG="${PERFECT_PROTO_ALLOW_MUTABLE_CATALOG:-false}"

CONFIG_PATH="$DEFAULT_CONFIG"
CATALOG_PATH=""
TARGET_DATE="$DEFAULT_DATE"
RUN_ID="$DEFAULT_RUN_ID"
EXPECTED_CATALOG_SHA256=""
EXPECTED_RULE_IDS_SHA256=""
EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE="$DEFAULT_EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE"

usage() {
  cat <<EOF
Usage: bash tools/server_stepb_afree_curated_perfect_prototypes_after_close.sh --catalog=/abs/path/catalog.json --expected-catalog-sha256=<sha256> --expected-rule-ids-sha256=<sha256> [--exclude-recommendation-close-ret-pct-gte=28] [--date=YYYY-MM-DD] [--config=/abs/path/config.json] [--run-id=<run_id>] [--allow-mutable-catalog=true]
EOF
}

run_open_pack_node() {
  NODE_OPTIONS="--max-old-space-size=$OPEN_PACK_NODE_HEAP_MB ${NODE_OPTIONS:-}" node "$@"
}

for arg in "$@"; do
  case "$arg" in
    --date=*) TARGET_DATE="${arg#*=}" ;;
    --catalog=*) CATALOG_PATH="${arg#*=}" ;;
    --expected-catalog-sha256=*) EXPECTED_CATALOG_SHA256="${arg#*=}" ;;
    --expected-rule-ids-sha256=*) EXPECTED_RULE_IDS_SHA256="${arg#*=}" ;;
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
    --exclude-recommendation-close-ret-pct-gte=*) EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE="${arg#*=}" ;;
    --allow-mutable-catalog=*) ALLOW_MUTABLE_CATALOG="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage >&2
      exit 4
      ;;
  esac
done

[[ -f "$LIB_PATH" ]] || { echo "[fatal] shared Step-B baseline helper library not found: $LIB_PATH" >&2; exit 4; }
source "$LIB_PATH"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "[fatal] config not found: $CONFIG_PATH" >&2
  exit 4
fi

if [[ -z "$CATALOG_PATH" ]]; then
  echo "[fatal] missing --catalog. A-free live apply requires an explicit frozen catalog path." >&2
  exit 4
fi

if [[ ! -f "$CATALOG_PATH" ]]; then
  echo "[fatal] catalog not found: $CATALOG_PATH" >&2
  exit 4
fi

if [[ "$ALLOW_MUTABLE_CATALOG" != "true" && "$CATALOG_PATH" != *"/artifacts/curated/frozen/"*"/catalog.json" ]]; then
  echo "[fatal] A-free live apply requires an immutable frozen catalog path under artifacts/curated/frozen/" >&2
  echo "[fatal] pass --allow-mutable-catalog=true only for explicit manual maintenance tasks" >&2
  exit 4
fi

CATALOG_MANIFEST_PATH="$(dirname "$CATALOG_PATH")/manifest.json"
if [[ ! -f "$CATALOG_MANIFEST_PATH" ]]; then
  echo "[fatal] frozen catalog manifest not found: $CATALOG_MANIFEST_PATH" >&2
  exit 4
fi

if [[ -z "$EXPECTED_CATALOG_SHA256" || -z "$EXPECTED_RULE_IDS_SHA256" ]]; then
  echo "[fatal] missing --expected-catalog-sha256 or --expected-rule-ids-sha256" >&2
  exit 4
fi

if [[ ! "$EXPECTED_CATALOG_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "[fatal] invalid --expected-catalog-sha256: $EXPECTED_CATALOG_SHA256" >&2
  exit 4
fi

if [[ ! "$EXPECTED_RULE_IDS_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "[fatal] invalid --expected-rule-ids-sha256: $EXPECTED_RULE_IDS_SHA256" >&2
  exit 4
fi

if [[ ! "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "[fatal] invalid --date: $TARGET_DATE" >&2
  exit 4
fi

if [[ ! "$EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "[fatal] invalid --exclude-recommendation-close-ret-pct-gte: $EXCLUDE_RECOMMENDATION_CLOSE_RET_PCT_GTE" >&2
  exit 4
fi

validate_baseline_contract_config "$CONFIG_PATH" "$EXPECTED_LINE_ID" "$EXPECTED_MAX_GAP_TRADING_DAYS" "$EXPECTED_SURFACE"

node - "$CATALOG_PATH" "$CATALOG_MANIFEST_PATH" "$EXPECTED_SURFACE" <<'NODE'
const fs = require("fs")

const [catalogPath, manifestPath, expectedSurface] = process.argv.slice(2)
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
if (rules.length < 1) {
  throw new Error(`Curated catalog has no rules: ${catalogPath}`)
}

const levels = Array.from(new Set(rules.map((rule) => String(rule?.ruleLevel ?? "").trim() || "unknown"))).sort()
const hasParentRule = rules.some((rule) => String(rule?.ruleLevel ?? "").trim().toLowerCase() === "parent")
const allPrototypeChildRules = rules.every((rule) => String(rule?.ruleId ?? "").trim().startsWith("PP_"))
if (hasParentRule || !allPrototypeChildRules) {
  throw new Error(
    [
      "server_stepb_afree_curated_perfect_prototypes_after_close.sh only supports Step-B child PP_* catalogs.",
      `Found rule levels: ${levels.join(", ")}`,
    ].join(" "),
  )
}

const sourceRunId = String(manifest?.sourceRunId ?? "").trim()
if (!sourceRunId.toLowerCase().includes("_afree_")) {
  throw new Error(
    `A-free live wrapper requires an A-free sourceRunId in the frozen catalog manifest: ${sourceRunId || "null"}`,
  )
}

const surface = String(manifest?.surface ?? manifest?.selectionSurface ?? "").trim().toLowerCase()
if (surface !== String(expectedSurface ?? "").trim().toLowerCase()) {
  throw new Error(`A-free live wrapper requires surface=${expectedSurface}, got ${surface || "null"}`)
}
NODE

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
PACK_DIR="$RUN_DIR/step-perfect-prototype-open-live-pack"
APPLY_DIR="$RUN_DIR/step-perfect-prototype-open-live-apply"
mkdir -p "$RUN_DIR"

run_open_pack_node tools/build_perfect_prototype_daily_pack.mjs \
  --config="$CONFIG_PATH" \
  --out-dir="$PACK_DIR" \
  --start="$TARGET_DATE" \
  --end="$TARGET_DATE" \
  --surface-name="$EXPECTED_SURFACE" \
  --source-type="$EXPECTED_SOURCE_TYPE" \
  --line-id="$EXPECTED_LINE_ID"

node tools/apply_perfect_prototypes.mjs \
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

echo "[ok] step-b afree curated after-close run complete"
echo "runId=$RUN_ID"
echo "catalog=$CATALOG_PATH"
echo "packSummary=$PACK_DIR/summary.json"
echo "dailyPack=$PACK_DIR/daily_pack.jsonl"
echo "summary=$APPLY_DIR/summary.json"
echo "deduped=$APPLY_DIR/deduped_symbols.jsonl"
