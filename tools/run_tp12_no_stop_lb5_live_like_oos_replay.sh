#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/tp12_no_stop_lb5_live_like_oos_replay_contract.json"
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
Usage: bash tools/run_tp12_no_stop_lb5_live_like_oos_replay.sh --run-id=<run_id> [--contract-path=PATH]
Server-only helper that replays the canonical lb5 untouched OOS one requested date at a time and verifies equivalence against the canonical batch OOS apply.
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
import { loadTp12NoStopLb5LiveLikeOosReplayContract } from "./src/lib/tp12_no_stop_lb5_live_like_oos_replay_contract.mjs"

const [contractPath] = process.argv.slice(2)
const contract = await loadTp12NoStopLb5LiveLikeOosReplayContract({
  contractPath,
  cwd: process.cwd(),
})
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
emit("RESOLVED_CONTRACT_PATH", contract.contractPath)
emit("BASE_SOURCE_RUN_ID", contract.baselineRunIds.sourceRunId)
emit("BASE_SCOPE_RUN_ID", contract.baselineRunIds.scopeRunId)
emit("OOS_START", contract.oosWindow.from)
emit("OOS_END", contract.oosWindow.to)
emit("SELECTION_MODE", contract.selectionMode)
NODE
)"

BASE_SOURCE_RUN_DIR="$ROOT_DIR/artifacts/runs/$BASE_SOURCE_RUN_ID"
BASE_SCOPE_RUN_DIR="$ROOT_DIR/artifacts/runs/$BASE_SCOPE_RUN_ID"
OOS_PACK_PATH="$BASE_SCOPE_RUN_DIR/step-perfect-prototype-open-oos-pack/daily_pack.jsonl"
BATCH_APPLY_RAW_DIR="$BASE_SCOPE_RUN_DIR/step-perfect-prototype-open-oos-apply-raw"
FREEZE_RESULT_PATH="$BASE_SCOPE_RUN_DIR/freeze_result.json"
[[ -d "$BASE_SOURCE_RUN_DIR" ]] || fatal "missing base source run dir: $BASE_SOURCE_RUN_DIR"
[[ -f "$OOS_PACK_PATH" ]] || fatal "missing base oos pack: $OOS_PACK_PATH"
[[ -d "$BATCH_APPLY_RAW_DIR" ]] || fatal "missing batch oos apply dir: $BATCH_APPLY_RAW_DIR"
[[ -f "$FREEZE_RESULT_PATH" ]] || fatal "missing base freeze result: $FREEZE_RESULT_PATH"

eval "$(
  node --input-type=module - "$FREEZE_RESULT_PATH" <<'NODE'
import { readJson } from "./src/lib/io.mjs"

const [freezeResultPath] = process.argv.slice(2)
const freezeResult = await readJson(freezeResultPath, null)
if (!freezeResult || typeof freezeResult !== "object") {
  throw new Error(`Missing freeze result: ${freezeResultPath}`)
}
const emit = (key, value) => {
  console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
}
emit("FROZEN_CATALOG_PATH", freezeResult.outPath)
emit("EXPECTED_CATALOG_SHA256", freezeResult.catalogContentSha256)
emit("EXPECTED_RULE_IDS_SHA256", freezeResult.ruleIdsSha256)
NODE
)"

[[ -f "$FROZEN_CATALOG_PATH" ]] || fatal "missing frozen catalog: $FROZEN_CATALOG_PATH"
[[ -n "$EXPECTED_CATALOG_SHA256" ]] || fatal "missing catalog sha"
[[ -n "$EXPECTED_RULE_IDS_SHA256" ]] || fatal "missing rule ids sha"

RUN_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID"
DAY_RUN_ROOT="$RUN_DIR/live_like_oos_days"
DATE_LIST_FILE="$RUN_DIR/requested_oos_dates.txt"
SUMMARY_PATH="$RUN_DIR/live_like_oos_replay_summary.json"
RUNTIME_SUMMARY_PATH="$RUN_DIR/live_like_oos_replay_runtime_summary.json"

if [[ -e "$RUN_DIR" ]]; then
  fatal "run dir already exists: $RUN_DIR"
fi
mkdir -p "$DAY_RUN_ROOT"

node --input-type=module - "$OOS_PACK_PATH" "$DATE_LIST_FILE" "$OOS_START" "$OOS_END" <<'NODE'
import fs from "node:fs/promises"
import { iterateJsonl } from "./src/lib/io.mjs"

const [oosPackPath, outPath, startDate, endDate] = process.argv.slice(2)
const dateSet = new Set()
await iterateJsonl(oosPackPath, {
  strict: true,
  onRow: async (row) => {
    const dateKey = String(row?.dateKey ?? row?.decisionDateKey ?? row?.recommendationDateKey ?? row?.eventDate ?? "").trim()
    if (!dateKey) return
    if (startDate && dateKey < startDate) return
    if (endDate && dateKey > endDate) return
    dateSet.add(dateKey)
  },
})
const ordered = Array.from(dateSet).sort((left, right) => left.localeCompare(right))
await fs.writeFile(outPath, `${ordered.join("\n")}${ordered.length > 0 ? "\n" : ""}`, "utf8")
NODE

REQUESTED_DATE_COUNT="$(grep -cve '^[[:space:]]*$' "$DATE_LIST_FILE" || true)"
[[ "$REQUESTED_DATE_COUNT" -gt 0 ]] || fatal "requested OOS date list is empty: $DATE_LIST_FILE"

started_at="$(date +%s)"
while IFS= read -r DATE_KEY || [[ -n "${DATE_KEY:-}" ]]; do
  [[ -n "${DATE_KEY:-}" ]] || continue
  DAY_DIR="$DAY_RUN_ROOT/date=$DATE_KEY"
  node tools/apply_perfect_prototypes.mjs \
    --input="$OOS_PACK_PATH" \
    --catalog="$FROZEN_CATALOG_PATH" \
    --out-dir="$DAY_DIR" \
    --selection-mode="$SELECTION_MODE" \
    --start="$DATE_KEY" \
    --end="$DATE_KEY" \
    --expected-catalog-sha256="$EXPECTED_CATALOG_SHA256" \
    --expected-rule-ids-sha256="$EXPECTED_RULE_IDS_SHA256" >/dev/null
done < "$DATE_LIST_FILE"

node tools/build_tp12_no_stop_lb5_live_like_oos_replay_summary.mjs \
  --contract-path="$RESOLVED_CONTRACT_PATH" \
  --date-list-file="$DATE_LIST_FILE" \
  --day-run-root="$DAY_RUN_ROOT" \
  --batch-apply-dir="$BATCH_APPLY_RAW_DIR" \
  --out="$SUMMARY_PATH" \
  --run-id="$RUN_ID" \
  --fail-on-mismatch=true >/dev/null

finished_at="$(date +%s)"
elapsed_sec="$(( finished_at - started_at ))"

node --input-type=module - "$RUNTIME_SUMMARY_PATH" "$RUN_ID" "$RESOLVED_CONTRACT_PATH" "$BASE_SOURCE_RUN_ID" "$BASE_SCOPE_RUN_ID" "$REQUESTED_DATE_COUNT" "$elapsed_sec" <<'NODE'
import { writeJson } from "./src/lib/io.mjs"

const [outPath, runId, contractPath, baseSourceRunId, baseScopeRunId, requestedDateCount, wallClockSec] = process.argv.slice(2)
await writeJson(outPath, {
  generatedAt: new Date().toISOString(),
  runId,
  contractPath,
  baseSourceRunId,
  baseScopeRunId,
  requestedDateCount: Number(requestedDateCount),
  wallClockSec: Number(wallClockSec),
})
NODE

echo "[done] tp12 no-stop lb5 live-like OOS replay audit completed runId=${RUN_ID} requestedDates=${REQUESTED_DATE_COUNT}"
