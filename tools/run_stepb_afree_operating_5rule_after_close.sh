#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="$ROOT_DIR/config/lab.config.server.lite.stepb_dplus1_plus_lite.json"

CATALOG_PATH="/home/moltook/apps/stockdesk-lab-lite/artifacts/curated/frozen/perfect_proto_stepb_afree_daycap2_train_precision90_maxhit15_20m_v1_20260322/operating_7rule_plus_pp935d6457f10a_v1/catalog.json"
EXPECTED_CATALOG_SHA256="d94a55a33f4ad1fe3a0185d26154408c57a967ebfcc69bdb9a591f40584bea39"
EXPECTED_RULE_IDS_SHA256="65619b5bcdc57dbd894709a3dd17a5d03edb734e5734941c7d06e639898a40c1"

for arg in "$@"; do
  case "$arg" in
    --config=*|--catalog=*|--expected-catalog-sha256=*|--expected-rule-ids-sha256=*)
      echo "[fatal] tools/run_stepb_afree_operating_5rule_after_close.sh pins config/catalog/hash inputs and does not accept overrides: $arg" >&2
      exit 4
      ;;
  esac
done

"$ROOT_DIR/tools/run_server_command.sh" \
  bash tools/server_stepb_afree_curated_perfect_prototypes_after_close.sh \
  "$@" \
  --config="$CONFIG_PATH" \
  --catalog="$CATALOG_PATH" \
  --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
  --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"
