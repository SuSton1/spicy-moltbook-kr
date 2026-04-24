#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/technique_grammar_contract.json"
DEFAULT_PLAN_PATH="artifacts/runs/tp12_technique_seed_dryrun_v1_20260412_r3/bank_discovery_plan.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_technique_bank_discovery_rolling.sh --run-id=<run_id> [--plan-path=PATH] [--contract-path=PATH] [--bank-ids=id1,id2] [--max-banks=N] [--window-group=screen|all] [--candle-path=PATH] [--max-rules=N]
Server-only helper that drives shortlist-selected technique banks into the fixed TP12 no-stop rolling wrapper.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
PLAN_PATH="$DEFAULT_PLAN_PATH"
RUN_ID=""
BANK_IDS=""
MAX_BANKS=""
WINDOW_GROUP="screen"
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --plan-path=*) PLAN_PATH="${1#*=}"; shift ;;
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --bank-ids=*) BANK_IDS="${1#*=}"; shift ;;
    --max-banks=*) MAX_BANKS="${1#*=}"; shift ;;
    --window-group=*) WINDOW_GROUP="${1#*=}"; shift ;;
    --candle-path=*) CANDLE_PATH="${1#*=}"; shift ;;
    --max-rules=*) MAX_RULES="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: ${1}" >&2; exit 1 ;;
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
[[ -f "$CONTRACT_PATH" ]] || fatal "contract path missing: $CONTRACT_PATH"
[[ -f "$PLAN_PATH" ]] || fatal "plan path missing: $PLAN_PATH"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-bank-discovery"
MANIFEST_PATH="$OUT_DIR/manifest.json"
SUMMARY_PATH="$OUT_DIR/summary.json"
MANIFEST_BANKS_JSONL="$OUT_DIR/manifest_banks.jsonl"
DERIVED_CONTRACT_DIR="$OUT_DIR/candidate_contracts"
BANKS_TSV="$OUT_DIR/selected_banks.tsv"

if [[ -e "$OUT_DIR" ]]; then
  fatal "technique bank discovery out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR" "$DERIVED_CONTRACT_DIR"

eval "$(
  node --input-type=module - "$PLAN_PATH" "$BANK_IDS" "$MAX_BANKS" "$BANKS_TSV" <<'NODE'
import fs from "node:fs/promises"
import { loadTechniqueBankDiscoveryPlan, selectTechniqueBankDiscoveryPlanBanks } from "./src/lib/technique_bank_discovery_contract.mjs"

const [planPath, bankIdsCsv, maxBanksRaw, banksTsvPath] = process.argv.slice(2)
const requestedBankIds = String(bankIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const maxBanks = String(maxBanksRaw ?? "").trim()
const numericMaxBanks = maxBanks ? Number(maxBanks) : null
const planArtifact = await loadTechniqueBankDiscoveryPlan({ planPath, cwd: process.cwd() })
const banks = selectTechniqueBankDiscoveryPlanBanks({
  planArtifact,
  selectedBankIds: requestedBankIds,
  maxBanks: numericMaxBanks,
})
if (banks.length < 1) throw new Error("No technique banks selected")
await fs.writeFile(
  banksTsvPath,
  `${banks.map((bank) => [
    bank.bankId,
    bank.mechanismId,
    bank.scopeId,
    bank.lookbackCandidateId,
    bank.topTemplateId,
    Number(bank.shortlistedTemplateCount ?? 0) || 0,
  ].join("\t")).join("\n")}\n`,
  "utf8",
)
const emit = (key, value) => console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
emit("PLAN_CONTRACT_ID", planArtifact.contractId)
emit("SELECTED_BANK_COUNT", banks.length)
NODE
)"

while IFS=$'\t' read -r BANK_ID MECHANISM_ID SCOPE_ID LOOKBACK_CANDIDATE_ID TOP_TEMPLATE_ID SHORTLISTED_TEMPLATE_COUNT || [[ -n "${BANK_ID:-}" ]]; do
  [[ -n "${BANK_ID:-}" ]] || continue
  SAFE_BANK_SLUG="$(echo "$BANK_ID" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g')"
  CHILD_RUN_ID="${RUN_ID}_${SAFE_BANK_SLUG}"
  CHILD_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}_${SAFE_BANK_SLUG}.json"

  node tools/build_technique_bank_discovery_candidate_contract.mjs \
    "--contract-path=${CONTRACT_PATH}" \
    "--plan-path=${PLAN_PATH}" \
    "--bank-id=${BANK_ID}" \
    "--out=${CHILD_CONTRACT_PATH}" >/dev/null

  child_args=(
    "--contract-path=${CHILD_CONTRACT_PATH}"
    "--run-id=${CHILD_RUN_ID}"
    "--window-group=${WINDOW_GROUP}"
    "--candle-path=${CANDLE_PATH}"
  )
  if [[ -n "$MAX_RULES" ]]; then
    child_args+=("--max-rules=${MAX_RULES}")
  fi
  bash tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh "${child_args[@]}"

  CHILD_SUMMARY_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_summary.json"
  CHILD_REPORT_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_report.md"
  [[ -f "$CHILD_SUMMARY_PATH" ]] || fatal "missing child rolling summary: $CHILD_SUMMARY_PATH"

  entry_json="$(
    node --input-type=module - "$BANK_ID" "$MECHANISM_ID" "$SCOPE_ID" "$LOOKBACK_CANDIDATE_ID" "$TOP_TEMPLATE_ID" "$SHORTLISTED_TEMPLATE_COUNT" "$CHILD_RUN_ID" "$CHILD_CONTRACT_PATH" "$CHILD_SUMMARY_PATH" "$CHILD_REPORT_PATH" <<'NODE'
const [
  bankId,
  mechanismId,
  scopeId,
  lookbackCandidateId,
  topTemplateId,
  shortlistedTemplateCount,
  childRunId,
  childContractPath,
  rollingSummaryPath,
  rollingReportPath,
] = process.argv.slice(2)
console.log(JSON.stringify({
  bankId,
  mechanismId,
  scopeId,
  lookbackCandidateId,
  topTemplateId,
  shortlistedTemplateCount: Number(shortlistedTemplateCount),
  childRunId,
  childContractPath,
  rollingSummaryPath,
  rollingReportPath,
}))
NODE
  )"
  printf '%s\n' "$entry_json" >> "$MANIFEST_BANKS_JSONL"
done < "$BANKS_TSV"

node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$PLAN_PATH" "$PLAN_CONTRACT_ID" "$WINDOW_GROUP" "$MANIFEST_BANKS_JSONL" "$BANK_IDS" "$MAX_BANKS" <<'NODE'
import fs from "node:fs/promises"
import { writeJson } from "./src/lib/io.mjs"
import { TECHNIQUE_BANK_DISCOVERY_MANIFEST_KIND } from "./src/lib/technique_bank_discovery_contract.mjs"

const [manifestPath, runId, planPath, planContractId, windowGroup, banksJsonlPath, requestedBankIdsCsv, maxBanks] = process.argv.slice(2)
const lines = String(await fs.readFile(banksJsonlPath, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean)
const banks = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`Malformed technique bank discovery manifest entry at ${banksJsonlPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
  }
})
await writeJson(manifestPath, {
  kind: TECHNIQUE_BANK_DISCOVERY_MANIFEST_KIND,
  generatedAt: new Date().toISOString(),
  runId,
  planPath,
  planContractId,
  windowGroup,
  requestedBankIds: String(requestedBankIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  maxBanks: String(maxBanks ?? "").trim() || null,
  banks,
})
NODE

node tools/build_technique_bank_discovery_summary.mjs \
  "--manifest-path=${MANIFEST_PATH}" \
  "--out=${SUMMARY_PATH}" \
  "--candle-path=${CANDLE_PATH}" >/dev/null

echo "[done] technique bank discovery rolling completed runId=${RUN_ID} banks=${SELECTED_BANK_COUNT} summary=${SUMMARY_PATH}"
