#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
DEFAULT_CONTRACT_PATH="meta/technique_grammar_contract.json"
DEFAULT_CANDLE_PATH="$ROOT_DIR/data/candle_daily.jsonl"

fatal() {
  echo "[fatal] $*" >&2
  exit 4
}

usage() {
  cat <<'EOF2'
Usage: bash tools/run_technique_cluster_template_rolling.sh --run-id=<run_id> --plan-path=PATH [--contract-path=PATH] [--template-ids=id1,id2] [--max-templates=N] [--window-group=screen|all] [--candle-path=PATH] [--max-rules=N] [--keep-source-runs]
Server-only helper that drives cluster-bank-selected technique templates into the fixed TP12 no-stop rolling wrapper.
EOF2
}

CONTRACT_PATH="$DEFAULT_CONTRACT_PATH"
PLAN_PATH=""
RUN_ID=""
TEMPLATE_IDS=""
MAX_TEMPLATES=""
WINDOW_GROUP="screen"
CANDLE_PATH="$DEFAULT_CANDLE_PATH"
MAX_RULES=""
KEEP_SOURCE_RUNS=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) CONTRACT_PATH="${1#*=}"; shift ;;
    --plan-path=*) PLAN_PATH="${1#*=}"; shift ;;
    --run-id=*) RUN_ID="${1#*=}"; shift ;;
    --template-ids=*) TEMPLATE_IDS="${1#*=}"; shift ;;
    --max-templates=*) MAX_TEMPLATES="${1#*=}"; shift ;;
    --window-group=*) WINDOW_GROUP="${1#*=}"; shift ;;
    --candle-path=*) CANDLE_PATH="${1#*=}"; shift ;;
    --max-rules=*) MAX_RULES="${1#*=}"; shift ;;
    --keep-source-runs) KEEP_SOURCE_RUNS=1; shift ;;
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
[[ -f "$PLAN_PATH" ]] || fatal "plan path missing: $PLAN_PATH"
[[ -f "$CANDLE_PATH" ]] || fatal "candle path missing: $CANDLE_PATH"

OUT_DIR="$ROOT_DIR/artifacts/runs/$RUN_ID/step-perfect-prototype-technique-cluster-template-screen"
MANIFEST_PATH="$OUT_DIR/manifest.json"
SUMMARY_PATH="$OUT_DIR/summary.json"
MANIFEST_TEMPLATES_JSONL="$OUT_DIR/manifest_templates.jsonl"
DERIVED_CONTRACT_DIR="$OUT_DIR/candidate_contracts"
TEMPLATES_TSV="$OUT_DIR/selected_templates.tsv"

if [[ -e "$OUT_DIR" ]]; then
  fatal "technique cluster template screen out dir already exists: $OUT_DIR"
fi
mkdir -p "$OUT_DIR" "$DERIVED_CONTRACT_DIR"
declare -A SEEN_CHILD_RUN_IDS=()

eval "$(
  node --input-type=module - "$PLAN_PATH" "$TEMPLATE_IDS" "$MAX_TEMPLATES" "$TEMPLATES_TSV" <<'NODE'
import fs from "node:fs/promises"
import {
  loadTechniqueClusterTemplateScreenPlan,
  selectTechniqueClusterTemplateScreenPlanTemplates,
} from "./src/lib/technique_cluster_template_screen_contract.mjs"

const [planPath, templateIdsCsv, maxTemplatesRaw, templatesTsvPath] = process.argv.slice(2)
const requestedTemplateIds = String(templateIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean)
const maxTemplates = String(maxTemplatesRaw ?? "").trim()
const numericMaxTemplates = maxTemplates ? Number(maxTemplates) : null
const planArtifact = await loadTechniqueClusterTemplateScreenPlan({ planPath, cwd: process.cwd() })
const templates = selectTechniqueClusterTemplateScreenPlanTemplates({
  planArtifact,
  selectedTemplateIds: requestedTemplateIds,
  maxTemplates: numericMaxTemplates,
})
if (templates.length < 1) throw new Error("No cluster template screen entries selected")
await fs.writeFile(
  templatesTsvPath,
  `${templates.map((template) => [
    template.candidateTemplateId,
    template.bankId,
    template.mechanismId,
    template.scopeId,
    template.lookbackCandidateId,
  ].join("\t")).join("\n")}\n`,
  "utf8",
)
const emit = (key, value) => console.log(`${key}=${JSON.stringify(String(value ?? ""))}`)
emit("PLAN_CONTRACT_ID", planArtifact.contractId)
emit("SELECTED_TEMPLATE_COUNT", templates.length)
NODE
)"

template_slug() {
  node --input-type=module - "$1" <<'NODE'
import { buildTechniqueTemplateScreenRunSlug } from "./src/lib/technique_template_screen_contract.mjs"

process.stdout.write(
  buildTechniqueTemplateScreenRunSlug({
    value: process.argv[2],
    maxLength: 96,
  }),
)
NODE
}

while IFS=$'\t' read -r TEMPLATE_ID BANK_ID MECHANISM_ID SCOPE_ID LOOKBACK_CANDIDATE_ID || [[ -n "${TEMPLATE_ID:-}" ]]; do
  [[ -n "${TEMPLATE_ID:-}" ]] || continue
  SAFE_TEMPLATE_SLUG="$(template_slug "$TEMPLATE_ID")"
  CHILD_RUN_ID="${RUN_ID}_${SAFE_TEMPLATE_SLUG}"
  CHILD_CONTRACT_PATH="$DERIVED_CONTRACT_DIR/${RUN_ID}_${SAFE_TEMPLATE_SLUG}.json"
  if [[ -n "${SEEN_CHILD_RUN_IDS[$CHILD_RUN_ID]+x}" ]]; then
    fatal "duplicate child run id derived from selected templates: $CHILD_RUN_ID"
  fi
  SEEN_CHILD_RUN_IDS["$CHILD_RUN_ID"]=1

  node tools/build_technique_cluster_template_screen_candidate_contract.mjs \
    "--contract-path=${CONTRACT_PATH}" \
    "--plan-path=${PLAN_PATH}" \
    "--template-id=${TEMPLATE_ID}" \
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
  if [[ "$KEEP_SOURCE_RUNS" != "1" ]]; then
    child_args+=("--prune-source-runs")
  fi
  bash tools/run_stepb_1d_tp12_no_stop_scope_rolling.sh "${child_args[@]}"

  CHILD_SUMMARY_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_summary.json"
  CHILD_REPORT_PATH="$ROOT_DIR/artifacts/runs/$CHILD_RUN_ID/step-perfect-prototype-1d-tp12-no-stop-rolling/rolling_report.md"
  [[ -f "$CHILD_SUMMARY_PATH" ]] || fatal "missing child rolling summary: $CHILD_SUMMARY_PATH"

  entry_json="$(
    node --input-type=module - "$PLAN_PATH" "$TEMPLATE_ID" "$CHILD_RUN_ID" "$CHILD_CONTRACT_PATH" "$CHILD_SUMMARY_PATH" "$CHILD_REPORT_PATH" <<'NODE'
import { readJson } from "./src/lib/io.mjs"

const [planPath, templateId, childRunId, childContractPath, rollingSummaryPath, rollingReportPath] = process.argv.slice(2)
const planArtifact = await readJson(planPath, null)
const template = Array.isArray(planArtifact?.selectedTemplates)
  ? planArtifact.selectedTemplates.find((item) => String(item?.candidateTemplateId ?? "") === String(templateId))
  : null
if (!template) throw new Error(`Unable to resolve selected cluster template entry: ${templateId}`)
console.log(JSON.stringify({
  candidateTemplateId: String(template.candidateTemplateId ?? ""),
  bankId: String(template.bankId ?? ""),
  sourceBankId: String(template.sourceBankId ?? template.bankId ?? ""),
  sourceClusterBankId: template.sourceClusterBankId ?? null,
  clusterId: template.clusterId ?? null,
  clusterRole: template.clusterRole ?? null,
  selectionReason: template.selectionReason ?? null,
  entryType: template.entryType ?? null,
  mechanismId: String(template.mechanismId ?? ""),
  scopeId: String(template.scopeId ?? ""),
  lookbackCandidateId: String(template.lookbackCandidateId ?? ""),
  childRunId,
  childContractPath,
  rollingSummaryPath,
  rollingReportPath,
}))
NODE
  )"
  printf '%s\n' "$entry_json" >> "$MANIFEST_TEMPLATES_JSONL"
done < "$TEMPLATES_TSV"

node --input-type=module - "$MANIFEST_PATH" "$RUN_ID" "$PLAN_PATH" "$PLAN_CONTRACT_ID" "$WINDOW_GROUP" "$MANIFEST_TEMPLATES_JSONL" "$TEMPLATE_IDS" "$MAX_TEMPLATES" <<'NODE'
import fs from "node:fs/promises"

import { writeJson } from "./src/lib/io.mjs"
import { TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_MANIFEST_KIND } from "./src/lib/technique_cluster_template_screen_contract.mjs"

const [manifestPath, runId, planPath, planContractId, windowGroup, templatesJsonlPath, requestedTemplateIdsCsv, maxTemplates] = process.argv.slice(2)
const lines = String(await fs.readFile(templatesJsonlPath, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean)
const templates = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`Malformed technique cluster template screen manifest entry at ${templatesJsonlPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
  }
})
await writeJson(manifestPath, {
  kind: TECHNIQUE_CLUSTER_TEMPLATE_SCREEN_MANIFEST_KIND,
  generatedAt: new Date().toISOString(),
  runId,
  planPath,
  planContractId,
  windowGroup,
  requestedTemplateIds: String(requestedTemplateIdsCsv ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  maxTemplates: String(maxTemplates ?? "").trim() || null,
  templates,
})
NODE

node tools/build_technique_template_screen_summary.mjs \
  "--manifest-path=${MANIFEST_PATH}" \
  "--out=${SUMMARY_PATH}" \
  "--candle-path=${CANDLE_PATH}" >/dev/null

echo "[done] technique cluster template rolling completed runId=${RUN_ID} templates=${SELECTED_TEMPLATE_COUNT} summary=${SUMMARY_PATH}"
