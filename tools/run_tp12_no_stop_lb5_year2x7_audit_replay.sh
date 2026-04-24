#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_lb5_year2x7_research_contract.json"
LIB_PATH="$ROOT_DIR/tools/lib_stepb_dplus1_baseline_wrapper.sh"

# shellcheck source=/dev/null
source "$LIB_PATH"

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
RUN_ID=""

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_tp12_no_stop_lb5_year2x7_audit_replay.sh --run-id=<run_id> [--contract-path=PATH]
Server-only helper that audits the completed canonical lb5 TP12 no-stop bank under strict year2x7 and replays the surviving subset on the same untouched OOS.
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*)
      CONTRACT_PATH="${1#*=}"
      shift
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
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
[[ -n "$RUN_ID" ]] || fatal "--run-id is required"

eval "$(
  node --input-type=module - "$CONTRACT_PATH" <<'NODE'
import { loadTp12NoStopLb5Year2x7ResearchContract } from "./src/lib/tp12_no_stop_lb5_year2x7_contract.mjs"

const [contractPath] = process.argv.slice(2)
const contract = await loadTp12NoStopLb5Year2x7ResearchContract({
  contractPath,
  cwd: process.cwd(),
})
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
const emitNumber = (key, value) => {
  console.log(`${key}=${Number(value)}`)
}
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("BASE_SOURCE_RUN_ID", contract.baselineRunIds.sourceRunId)
emit("BASE_SCOPE_RUN_ID", contract.baselineRunIds.scopeRunId)
emit("PRIMARY_LABEL_ID", contract.labelContract.primaryLabelId)
emit("SECONDARY_LABEL_ID", contract.labelContract.secondaryLabelId)
emitNumber("LOOKBACK_TRADING_DAYS", contract.lookbackTradingDays)
emit("TRAIN_START", contract.trainWindow.from)
emit("TRAIN_END", contract.trainWindow.to)
emit("OOS_START", contract.oosWindow.from)
emit("OOS_END", contract.oosWindow.to)
emit("SELECTION_MODE", "union_all")
NODE
)"

BASE_SOURCE_RUN_DIR="$ROOT_DIR/artifacts/runs/$BASE_SOURCE_RUN_ID"
BASE_SCOPE_RUN_DIR="$ROOT_DIR/artifacts/runs/$BASE_SCOPE_RUN_ID"
TRAIN_PACK_PATH="$BASE_SCOPE_RUN_DIR/step-perfect-prototype-open-train-pack/daily_pack.jsonl"
OOS_PACK_PATH="$BASE_SCOPE_RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
TRAIN_CATALOG_PATH="$BASE_SCOPE_RUN_DIR/step-perfect-prototype-train/catalog.json"
TRAIN_MATCHES_PATH="$BASE_SCOPE_RUN_DIR/step-perfect-prototype-open-train-apply-raw/matches.jsonl"
[[ -f "$TRAIN_PACK_PATH" ]] || fatal "missing base train pack: $TRAIN_PACK_PATH"
[[ -f "$OOS_PACK_PATH" ]] || fatal "missing base oos pack: $OOS_PACK_PATH"
[[ -f "$TRAIN_CATALOG_PATH" ]] || fatal "missing base train catalog: $TRAIN_CATALOG_PATH"
[[ -f "$TRAIN_MATCHES_PATH" ]] || fatal "missing base train matches: $TRAIN_MATCHES_PATH"
[[ -d "$BASE_SOURCE_RUN_DIR" ]] || fatal "missing base source run dir: $BASE_SOURCE_RUN_DIR"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
AUDIT_DIR="$RUN_DIR/year2x7_audit"
TRAIN_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-train-apply-raw"
OOS_APPLY_RAW_DIR="$RUN_DIR/step-perfect-prototype-open-oos-apply-raw"
FREEZE_RESULT_PATH="$RUN_DIR/freeze_result.json"
SUMMARY_PATH="$RUN_DIR/year2x7_replay_summary.json"
RUNTIME_SUMMARY_PATH="$RUN_DIR/year2x7_runtime_summary.json"

if [[ -e "$RUN_DIR" ]]; then
  fatal "run dir already exists: $RUN_DIR"
fi
mkdir -p "$RUN_DIR"

started_at="$(date +%s)"

node tools/build_tp12_no_stop_rule_year_coverage_report.mjs \
  --contract-path="$RESOLVED_CONTRACT_PATH" \
  --catalog="$TRAIN_CATALOG_PATH" \
  --train-matches="$TRAIN_MATCHES_PATH" \
  --out-dir="$AUDIT_DIR" >/dev/null

AUDIT_SUMMARY_PATH="$AUDIT_DIR/year2x7_audit_summary.json"
SURVIVOR_RULE_IDS_PATH="$AUDIT_DIR/year2x7_survivor_rule_ids.txt"
SURVIVOR_RULE_COUNT="$(read_json_field "$AUDIT_SUMMARY_PATH" "survivorRuleCount" || printf '0')"

if [[ "$SURVIVOR_RULE_COUNT" -lt 1 ]]; then
  cat > "$FREEZE_RESULT_PATH" <<EOF
{
  "status": "no_rules",
  "reason": "strict_year2x7_survivor_rule_count_zero",
  "outPath": null,
  "catalogContentSha256": null,
  "ruleIdsSha256": null
}
EOF
else
  node tools/build_curated_perfect_prototype_catalog.mjs \
    --source-catalog="$TRAIN_CATALOG_PATH" \
    --rule-ids-file="$SURVIVOR_RULE_IDS_PATH" \
    --label="tp12_no_stop_lb5_year2x7" \
    --note="contract=$(basename "$RESOLVED_CONTRACT_PATH") scopeId=LOW_GAP_TOP candidateId=lb5 lookback=${LOOKBACK_TRADING_DAYS} strictYear2x7 train=${TRAIN_START}:${TRAIN_END} oos=${OOS_START}:${OOS_END}" \
    > "$FREEZE_RESULT_PATH"

  FROZEN_CATALOG_PATH="$(read_json_field "$FREEZE_RESULT_PATH" "outPath")"
  EXPECTED_CATALOG_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "catalogContentSha256")"
  EXPECTED_RULE_IDS_SHA256="$(read_json_field "$FREEZE_RESULT_PATH" "ruleIdsSha256")"
  [[ -f "$FROZEN_CATALOG_PATH" ]] || fatal "missing frozen subset catalog: $FROZEN_CATALOG_PATH"

  node tools/apply_perfect_prototypes.mjs \
    --input="$TRAIN_PACK_PATH" \
    --catalog="$FROZEN_CATALOG_PATH" \
    --out-dir="$TRAIN_APPLY_RAW_DIR" \
    --selection-mode="$SELECTION_MODE" \
    --start="$TRAIN_START" \
    --end="$TRAIN_END" \
    --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
    --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"

  node tools/apply_perfect_prototypes.mjs \
    --input="$OOS_PACK_PATH" \
    --catalog="$FROZEN_CATALOG_PATH" \
    --out-dir="$OOS_APPLY_RAW_DIR" \
    --selection-mode="$SELECTION_MODE" \
    --start="$OOS_START" \
    --end="$OOS_END" \
    --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
    --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256"
fi

node tools/build_tp12_no_stop_lb5_year2x7_summary.mjs \
  --contract-path="$RESOLVED_CONTRACT_PATH" \
  --audit-summary-path="$AUDIT_SUMMARY_PATH" \
  --freeze-result-path="$FREEZE_RESULT_PATH" \
  --train-apply-dir="$TRAIN_APPLY_RAW_DIR" \
  --oos-apply-dir="$OOS_APPLY_RAW_DIR" \
  --out="$SUMMARY_PATH" \
  --run-id="$RUN_ID" >/dev/null

finished_at="$(date +%s)"
elapsed_sec="$(( finished_at - started_at ))"

node --input-type=module - "$RUNTIME_SUMMARY_PATH" "$RUN_ID" "$RESOLVED_CONTRACT_PATH" "$BASE_SOURCE_RUN_ID" "$BASE_SCOPE_RUN_ID" "$SURVIVOR_RULE_COUNT" "$elapsed_sec" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"

const [outPath, runId, contractPath, baseSourceRunId, baseScopeRunId, survivorRuleCount, wallClockSec] = process.argv.slice(2)
await writeJson(outPath, {
  generatedAt: new Date().toISOString(),
  runId,
  contractPath,
  baseSourceRunId,
  baseScopeRunId,
  survivorRuleCount: Number(survivorRuleCount),
  wallClockSec: Number(wallClockSec),
})
NODE

echo "[done] tp12 no-stop lb5 strict year2x7 audit replay completed runId=${RUN_ID} survivorRuleCount=${SURVIVOR_RULE_COUNT}"
