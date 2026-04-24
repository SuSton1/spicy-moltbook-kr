#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/technique_grammar_fixed_2016_2024_contract.json"
DEFAULT_FIXED_CONTRACT_PATH="meta/tp12_no_stop_fixed_year2hit_research_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF'
Usage: bash tools/run_technique_cluster_bank_discovery_fixed.sh --run-id=<run_id> --plan-path=PATH [--contract-path=PATH] [--fixed-contract-path=PATH] [--cluster-bank-ids=id1,id2] [--max-banks=N] [--split-group=screen|confirm|holdout|all] [--candle-path=PATH] [--max-rules=N]
Server-only helper that drives explicit cluster-bank discovery entries into the TP12 no-stop fixed wrapper.
EOF
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
FIXED_CONTRACT_PATH="$DEFAULT_FIXED_CONTRACT_PATH"
PLAN_PATH=""
RUN_ID=""
CLUSTER_BANK_IDS=""
MAX_BANKS=""
SPLIT_GROUP="screen"
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES=""

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --fixed-contract-path=*) FIXED_CONTRACT_PATH="${1#*=}"; shift ;;
    --plan-path=*) PLAN_PATH="${1#*=}"; shift ;;
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --cluster-bank-ids=*) CLUSTER_BANK_IDS="${1#*=}"; shift ;;
    --max-banks=*) MAX_BANKS="${1#*=}"; shift ;;
    --split-group=*) SPLIT_GROUP="${1#*=}"; shift ;;
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
[[ -n "$PLAN_PATH" ]] || fatal "--plan-path is required"
[[ -f "$CONTRACT_PATH" ]] || fatal "contract path missing: $CONTRACT_PATH"
[[ -f "$FIXED_CONTRACT_PATH" ]] || fatal "fixed contract path missing: $FIXED_CONTRACT_PATH"
[[ -f "$PLAN_PATH" ]] || fatal "plan path missing: $PLAN_PATH"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-cluster-bank-discovery-fixed"
MANIFEST_PATH="$OUT_DIR/manifest.json"
SUMMARY_PATH="$OUT_DIR/summary.json"
MANIFEST_BANKS_JSONL="$OUT_DIR/manifest_banks.jsonl"
DERIVED_CONTRACT_DIR="$OUT_DIR/candidate_contracts"
BANKS_TSV="$OUT_DIR/selected_cluster_banks.tsv"

if [[ -e "$OUT_DIR" ]]; then
  fatal "technique cluster-bank discovery fixed out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR" "$DERIVED_CONTRACT_DIR"

eval "$(
  node --input-type=module - "$PLAN_PATH" "$CLUSTER_BANK_IDS" "$MAX_BANKS" "$BANKS_TSV" <<'NODE'
import fs from "node:fs/promises"
import {
  loadTechniqueClusterBankDiscoveryPlan,
  selectTechniqueClusterBankDiscoveryPlanEntries,
} from "./src/lib/technique_cluster_bank_discovery_contract.mjs"

const [planPath, clusterBankIdsCsv, maxBanksRaw, banksTsvPath] = process.argv.slice(2)
const requestedClusterBankIds = String(clusterBankIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const maxBanks = String(maxBanksRaw ?? "").trim()
const numericMaxBanks = maxBanks ? Number(maxBanks) : null
const planArtifact = await loadTechniqueClusterBankDiscoveryPlan({ planPath, cwd: process.cwd() })
const entries = selectTechniqueClusterBankDiscoveryPlanEntries({
  planArtifact,
  selectedClusterBankIds: requestedClusterBankIds,
  maxBanks: numericMaxBanks,
})
if (entries.length < 1) throw new Error("No cluster-bank discovery entries selected")
await fs.writeFile(
  banksTsvPath,
  `${entries.map((entry) => [
    entry.clusterBankId,
    entry.bankId,
    entry.mechanismId,
    entry.scopeId,
    entry.lookbackCandidateId,
    entry.entryType,
    entry.topTemplateId ?? "",
    Number(entry.shortlistedTemplateCount ?? 0) || 0,
  ].join("\t")).join("\n")}\n`,
  "utf8",
)
const emit = (key, value) => console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
emit("PLAN_CONTRACT_ID", planArtifact.contractId)
emit("SELECTED_BANK_COUNT", entries.length)
NODE
)"

while IFS=$'\t' read -r CLUSTER_BANK_ID BANK_ID MECHANISM_ID SCOPE_ID LOOKBACK_CANDIDATE_ID ENTRY_TYPE TOP_TEMPLATE_ID SHORTLISTED_TEMPLATE_COUNT || [[ -n "${CLUSTER_BANK_ID:-}" ]]; do
  [[ -n "${CLUSTER_BANK_ID:-}" ]] || continue
  SAFE_BANK_SLUG="$(echo "$CLUSTER_BANK_ID" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g')"
  CHILD_RUN_ID="${RUN_ID}_${SAFE_BANK_SLUG}"
  CHILD_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}_${SAFE_BANK_SLUG}.json"

  node tools/build_technique_cluster_bank_discovery_fixed_candidate_contract.mjs \
    "--contract-path=${CONTRACT_PATH}" \
    "--fixed-contract-path=${FIXED_CONTRACT_PATH}" \
    "--plan-path=${PLAN_PATH}" \
    "--cluster-bank-id=${CLUSTER_BANK_ID}" \
    "--out=${CHILD_CONTRACT_PATH}" >/dev/null

  child_args=(
    "--contract-path=${CHILD_CONTRACT_PATH}"
    "--run-id=${CHILD_RUN_ID}"
    "--split-group=${SPLIT_GROUP}"
    "--candle-path=${CANDLE_PATH}"
  )
  if [[ -n "$MAX_RULES" ]]; then
    child_args+=("--max-rules=${MAX_RULES}")
  fi
  bash tools/run_stepb_1d_tp12_no_stop_scope_fixed.sh "${child_args[@]}"

  CHILD_SUMMARY_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-fixed/summary.json"
  CHILD_REPORT_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-fixed/rolling_report.md"
  [[ -f "$CHILD_SUMMARY_PATH" ]] || fatal "missing child fixed summary: $CHILD_SUMMARY_PATH"

  entry_json="$(
    node --input-type=module - "$PLAN_PATH" "$CLUSTER_BANK_ID" "$CHILD_RUN_ID" "$CHILD_CONTRACT_PATH" "$CHILD_SUMMARY_PATH" "$CHILD_REPORT_PATH" <<'NODE'
import { readJson } from "./src/lib/io.mjs"

const [planPath, clusterBankId, childRunId, childContractPath, rollingSummaryPath, rollingReportPath] = process.argv.slice(2)
const planArtifact = await readJson(planPath, null)
const entry = Array.isArray(planArtifact?.selectedClusterBanks)
  ? planArtifact.selectedClusterBanks.find((item) => String(item?.clusterBankId ?? "") === String(clusterBankId))
  : null
if (!entry) throw new Error(`Unable to resolve selected cluster bank entry: ${clusterBankId}`)
console.log(JSON.stringify({
  clusterBankId: String(entry.clusterBankId ?? ""),
  entryType: String(entry.entryType ?? ""),
  selectionPolicy: String(entry.selectionPolicy ?? ""),
  bankId: String(entry.bankId ?? ""),
  sourceBankId: String(entry.sourceBankId ?? ""),
  clusterId: entry.clusterId ?? null,
  mechanismId: String(entry.mechanismId ?? ""),
  scopeId: String(entry.scopeId ?? ""),
  lookbackCandidateId: String(entry.lookbackCandidateId ?? ""),
  topTemplateId: entry.topTemplateId ?? null,
  leaderTemplateId: entry.leaderTemplateId ?? null,
  breadthTemplateId: entry.breadthTemplateId ?? null,
  shortlistedTemplateCount: Number(entry.shortlistedTemplateCount ?? 0) || 0,
  shortlistedTemplateIds: Array.isArray(entry.shortlistedTemplateIds) ? entry.shortlistedTemplateIds : [],
  selectedTemplateIds: Array.isArray(entry.selectedTemplateIds) ? entry.selectedTemplateIds : [],
  selectedTemplateEntries: Array.isArray(entry.selectedTemplateEntries) ? entry.selectedTemplateEntries : [],
  sourceBankSummary: entry?.sourceBankSummary && typeof entry.sourceBankSummary === "object" ? entry.sourceBankSummary : null,
  bankDiscoveryConfig: entry?.bankDiscoveryConfig && typeof entry.bankDiscoveryConfig === "object" ? entry.bankDiscoveryConfig : {},
  childRunId,
  childContractPath,
  rollingSummaryPath,
  rollingReportPath,
}))
NODE
  )"
  printf '%s\n' "$entry_json" >> "$MANIFEST_BANKS_JSONL"
done < "$BANKS_TSV"

node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$PLAN_PATH" "$PLAN_CONTRACT_ID" "$SPLIT_GROUP" "$MANIFEST_BANKS_JSONL" "$CLUSTER_BANK_IDS" "$MAX_BANKS" <<'NODE'
import fs from "node:fs/promises"
import { writeJson } from "./src/lib/io.mjs"

const [manifestPath, runId, planPath, planContractId, splitGroup, banksJsonlPath, requestedClusterBankIdsCsv, maxBanks] = process.argv.slice(2)
const lines = String(await fs.readFile(banksJsonlPath, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean)
const banks = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`Malformed technique cluster-bank discovery fixed manifest entry at ${banksJsonlPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
  }
})
await writeJson(manifestPath, {
  kind: "technique_cluster_bank_discovery_fixed_manifest_v1",
  generatedAt: new Date().toISOString(),
  runId,
  planPath,
  planContractId,
  splitGroup,
  requestedClusterBankIds: String(requestedClusterBankIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  maxBanks: String(maxBanks ?? "").trim() || null,
  banks,
})
NODE

node tools/build_technique_bank_discovery_summary.mjs \
  "--manifest-path=${MANIFEST_PATH}" \
  "--out=${SUMMARY_PATH}" \
  "--candle-path=${CANDLE_PATH}" >/dev/null

echo "[done] technique cluster-bank discovery fixed completed runId=${RUN_ID} banks=${SELECTED_BANK_COUNT} summary=${SUMMARY_PATH}"
