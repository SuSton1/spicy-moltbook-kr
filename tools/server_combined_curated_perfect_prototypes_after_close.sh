#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONFIG="$ROOT_DIR/config/lab.config.server.lite.json"
DEFAULT_DATE="$(date +%F)"
DEFAULT_RUN_ID="perfect_proto_combined_live_after_close_${DEFAULT_DATE//-/}_$(date +%H%M%S)"

CONFIG_PATH="$DEFAULT_CONFIG"
PARENT_CATALOG_PATH=""
STEPB_CATALOG_PATH=""
TARGET_DATE="$DEFAULT_DATE"
RUN_ID="$DEFAULT_RUN_ID"
PARENT_EXPECTED_CATALOG_SHA256=""
PARENT_EXPECTED_RULE_IDS_SHA256=""
STEPB_EXPECTED_CATALOG_SHA256=""
STEPB_EXPECTED_RULE_IDS_SHA256=""

usage() {
  cat <<EOF
Usage: bash tools/server_combined_curated_perfect_prototypes_after_close.sh --parent-catalog=/abs/path/catalog.json --parent-expected-catalog-sha256=<sha256> --parent-expected-rule-ids-sha256=<sha256> --stepb-catalog=/abs/path/catalog.json --stepb-expected-catalog-sha256=<sha256> --stepb-expected-rule-ids-sha256=<sha256> [--date=YYYY-MM-DD] [--config=/abs/path/config.json] [--run-id=<run_id>]
EOF
}

for arg in "$@"; do
  case "$arg" in
    --date=*) TARGET_DATE="${arg#*=}" ;;
    --config=*) CONFIG_PATH="${arg#*=}" ;;
    --parent-catalog=*) PARENT_CATALOG_PATH="${arg#*=}" ;;
    --parent-expected-catalog-sha256=*) PARENT_EXPECTED_CATALOG_SHA256="${arg#*=}" ;;
    --parent-expected-rule-ids-sha256=*) PARENT_EXPECTED_RULE_IDS_SHA256="${arg#*=}" ;;
    --stepb-catalog=*) STEPB_CATALOG_PATH="${arg#*=}" ;;
    --stepb-expected-catalog-sha256=*) STEPB_EXPECTED_CATALOG_SHA256="${arg#*=}" ;;
    --stepb-expected-rule-ids-sha256=*) STEPB_EXPECTED_RULE_IDS_SHA256="${arg#*=}" ;;
    --run-id=*) RUN_ID="${arg#*=}" ;;
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

if [[ -z "$PARENT_CATALOG_PATH" ]]; then
  echo "[fatal] missing --parent-catalog. Combined live apply requires an explicit frozen parent catalog path." >&2
  exit 4
fi

if [[ ! -f "$PARENT_CATALOG_PATH" ]]; then
  echo "[fatal] parent catalog not found: $PARENT_CATALOG_PATH" >&2
  exit 4
fi

if [[ -z "$STEPB_CATALOG_PATH" ]]; then
  echo "[fatal] missing --stepb-catalog. Combined live apply requires an explicit frozen Step-B catalog path." >&2
  exit 4
fi

if [[ ! -f "$STEPB_CATALOG_PATH" ]]; then
  echo "[fatal] stepb catalog not found: $STEPB_CATALOG_PATH" >&2
  exit 4
fi

if [[ -z "$PARENT_EXPECTED_CATALOG_SHA256" || -z "$PARENT_EXPECTED_RULE_IDS_SHA256" ]]; then
  echo "[fatal] missing parent expected catalog hashes" >&2
  exit 4
fi

if [[ -z "$STEPB_EXPECTED_CATALOG_SHA256" || -z "$STEPB_EXPECTED_RULE_IDS_SHA256" ]]; then
  echo "[fatal] missing Step-B expected catalog hashes" >&2
  exit 4
fi

if [[ ! "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "[fatal] invalid --date: $TARGET_DATE" >&2
  exit 4
fi

PARENT_RUN_ID="${RUN_ID}_rule2"
STEPB_RUN_ID="${RUN_ID}_stepb"
OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-combined"

bash tools/server_curated_perfect_prototypes_after_close.sh \
  --date="$TARGET_DATE" \
  --catalog="$PARENT_CATALOG_PATH" \
  --expected-catalog-sha256="$PARENT_EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$PARENT_EXPECTED_RULE_IDS_SHA256" \
  --config="$CONFIG_PATH" \
  --run-id="$PARENT_RUN_ID"

bash tools/server_stepb_curated_perfect_prototypes_after_close.sh \
  --date="$TARGET_DATE" \
  --catalog="$STEPB_CATALOG_PATH" \
  --expected-catalog-sha256="$STEPB_EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$STEPB_EXPECTED_RULE_IDS_SHA256" \
  --config="$CONFIG_PATH" \
  --run-id="$STEPB_RUN_ID"

node tools/merge_curated_perfect_prototype_live_results.mjs \
  --parent-input="$ROOT_DIR/artifacts/runs/$PARENT_RUN_ID/step-perfect-prototype-apply/deduped_symbols.jsonl" \
  --stepb-input="$ROOT_DIR/artifacts/runs/$STEPB_RUN_ID/step-perfect-prototype-apply/deduped_symbols.jsonl" \
  --out-dir="$OUT_DIR" \
  --date="$TARGET_DATE" \
  --parent-catalog="$PARENT_CATALOG_PATH" \
  --stepb-catalog="$STEPB_CATALOG_PATH" \
  --parent-run-id="$PARENT_RUN_ID" \
  --stepb-run-id="$STEPB_RUN_ID"

echo "[ok] combined after-close run complete"
echo "runId=$RUN_ID"
echo "parentRunId=$PARENT_RUN_ID"
echo "stepbRunId=$STEPB_RUN_ID"
echo "combinedSummary=$OUT_DIR/combined_summary.json"
echo "combinedDeduped=$OUT_DIR/combined_deduped_symbols.jsonl"
