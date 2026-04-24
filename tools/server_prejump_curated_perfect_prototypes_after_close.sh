#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.prejump.json"
DEFAULT_DATE="$(date +%F)"
DEFAULT_RUN_ID="perfect_proto_prejump_live_after_close_${DEFAULT_DATE//-/}_$(date +%H%M%S)"

CONFIG_PATH="$DEFAULT_CONFIG"
CATALOG_PATH=""
TARGET_DATE="$DEFAULT_DATE"
RUN_ID="$DEFAULT_RUN_ID"
EXPECTED_CATALOG_SHA256=""
EXPECTED_RULE_IDS_SHA256=""
ALLOW_MUTABLE_CATALOG="${PREJUMP_ALLOW_MUTABLE_CATALOG:-false}"

usage() {
  cat <<EOF
Usage: bash tools/server_prejump_curated_perfect_prototypes_after_close.sh --catalog=/abs/path/catalog.json --expected-catalog-sha256=<sha256> --expected-rule-ids-sha256=<sha256> [--date=YYYY-MM-DD] [--config=/abs/path/config.json] [--run-id=<run_id>] [--allow-mutable-catalog=true]
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
    --allow-mutable-catalog=*) ALLOW_MUTABLE_CATALOG="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "[fatal] unknown arg: $arg" >&2
      usage >&2
      exit 4
      ;;
  esac
done

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "[fatal] config not found: $CONFIG_PATH" >&2
  exit 4
fi

if [[ -z "$CATALOG_PATH" ]]; then
  echo "[fatal] missing --catalog. Predictive live apply now requires an explicit frozen catalog path." >&2
  echo "[fatal] expected path shape: $ROOT_DIR/artifacts/curated/prejump_frozen/<train_run_id>/<selection_id>/catalog.json" >&2
  exit 4
fi

if [[ ! -f "$CATALOG_PATH" ]]; then
  echo "[fatal] predictive curated catalog not found: $CATALOG_PATH" >&2
  echo "[fatal] build it first with: tools/rebuild_prejump_curated_perfect_prototype_catalog.sh --source-catalog=/home/moltook/apps/stockdesk-lab-lite/artifacts/runs/<predictive_run>/step-perfect-prototype/catalog.json" >&2
  exit 4
fi

if [[ "$ALLOW_MUTABLE_CATALOG" != "true" && "$CATALOG_PATH" != *"/artifacts/curated/prejump_frozen/"*"/catalog.json" ]]; then
  echo "[fatal] predictive live apply requires an immutable frozen catalog path under artifacts/curated/prejump_frozen/" >&2
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
  echo "[fatal] live apply must be anchored to externally supplied frozen catalog hashes, not auto-read from the sibling manifest" >&2
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

node - "$CATALOG_PATH" <<'NODE'
const fs = require("fs")

const [catalogPath] = process.argv.slice(2)
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"))
const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
if (rules.length < 1) {
  throw new Error(`Curated catalog has no rules: ${catalogPath}`)
}
const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
if (surface !== "v5_prejump_contextual") {
  throw new Error(
    [
      "server_prejump_curated_perfect_prototypes_after_close.sh only supports predictive prejump catalogs.",
      `Found tokenizer surface: ${surface || "unknown"}`,
    ].join(" "),
  )
}
NODE

node tools/build_perfect_prototype_prejump_pack.mjs \
  --config="$CONFIG_PATH" \
  --out-run-id="$RUN_ID" \
  --start="$TARGET_DATE" \
  --end="$TARGET_DATE"

node tools/apply_perfect_prototypes.mjs \
  --input="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-prejump/prejump_pack.parquet" \
  --catalog="$CATALOG_PATH" \
  --out-dir="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-apply" \
  --selection-mode=union_all \
  --exclude-recommendation-close-ret-pct-gte=28 \
  --candle-path="$ROOT_DIR/data/candle_daily.jsonl" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256" \
  --start="$TARGET_DATE" \
  --end="$TARGET_DATE"

echo "[ok] prejump after-close run complete"
echo "runId=$RUN_ID"
echo "catalog=$CATALOG_PATH"
echo "prejumpPack=$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-prejump/prejump_pack.parquet"
echo "summary=$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-apply/summary.json"
echo "deduped=$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-apply/deduped_symbols.jsonl"
