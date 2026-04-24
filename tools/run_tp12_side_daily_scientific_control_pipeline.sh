#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SERVER_ROOT="${STOCKDESK_SERVER_REPO_ROOT:-/home/moltook/apps/stockdesk-lab-lite}"
cd "${ROOT}"

contract_path="meta/tp12_side_daily_research_contract.json"
downstream_run_dir=""
train_run_dir=""
oos_run_dir=""
feature_pack_path=""
run_id=""
out_root=""
candle_path="data/candle_daily.jsonl"
investor_daily_path="data/intraday_side/investor_daily.jsonl"
program_daily_path="data/intraday_side/program_daily.jsonl"
trade_strength_daily_path="data/intraday_side/trade_strength_daily.jsonl"
allowed_lanes=""
gate_id="d0_close"
skip_verify=0

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --contract-path=*) contract_path="${1#*=}" ; shift ;;
    --downstream-run-dir=*) downstream_run_dir="${1#*=}" ; shift ;;
    --train-run-dir=*) train_run_dir="${1#*=}" ; shift ;;
    --oos-run-dir=*) oos_run_dir="${1#*=}" ; shift ;;
    --feature-pack-path=*) feature_pack_path="${1#*=}" ; shift ;;
    --run-id=*) run_id="${1#*=}" ; shift ;;
    --out-root=*) out_root="${1#*=}" ; shift ;;
    --candle-path=*) candle_path="${1#*=}" ; shift ;;
    --investor-daily-path=*) investor_daily_path="${1#*=}" ; shift ;;
    --program-daily-path=*) program_daily_path="${1#*=}" ; shift ;;
    --trade-strength-daily-path=*) trade_strength_daily_path="${1#*=}" ; shift ;;
    --allowed-lanes=*) allowed_lanes="${1#*=}" ; shift ;;
    --gate-id=*) gate_id="${1#*=}" ; shift ;;
    --skip-verify) skip_verify=1 ; shift ;;
    *)
      echo "unknown arg: ${1}" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${downstream_run_dir}" || -z "${train_run_dir}" || -z "${oos_run_dir}" || -z "${feature_pack_path}" ]]; then
  echo "usage: bash tools/run_tp12_side_daily_scientific_control_pipeline.sh --downstream-run-dir=PATH --train-run-dir=PATH --oos-run-dir=PATH --feature-pack-path=PATH [--contract-path=meta/tp12_side_daily_research_contract.json --run-id=ID --out-root=PATH --allowed-lanes=csv --gate-id=d0_close --skip-verify]" >&2
  exit 1
fi

ROOT_REAL="$(cd "$ROOT" && pwd -P)"
EXPECTED_REAL="$EXPECTED_SERVER_ROOT"
if [[ -d "$EXPECTED_SERVER_ROOT" ]]; then
  EXPECTED_REAL="$(cd "$EXPECTED_SERVER_ROOT" && pwd -P)"
fi
if [[ "$ROOT_REAL" != "$EXPECTED_REAL" ]]; then
  echo "[fatal] tp12 side-daily scientific control pipeline must run from $EXPECTED_REAL, got $ROOT_REAL" >&2
  exit 4
fi

if [[ -z "${run_id}" ]]; then
  run_id="tp12_side_daily_scientific_control_$(date +%Y%m%d_%H%M%S)"
fi
if [[ -z "${out_root}" ]]; then
  out_root="artifacts/tp12_side_daily/scientific_control/run=${run_id}"
fi

if [[ "${contract_path}" != /* ]]; then
  contract_path="${ROOT}/${contract_path}"
fi
if [[ "${downstream_run_dir}" != /* ]]; then
  downstream_run_dir="${ROOT}/${downstream_run_dir}"
fi
if [[ "${train_run_dir}" != /* ]]; then
  train_run_dir="${ROOT}/${train_run_dir}"
fi
if [[ "${oos_run_dir}" != /* ]]; then
  oos_run_dir="${ROOT}/${oos_run_dir}"
fi
if [[ "${feature_pack_path}" != /* ]]; then
  feature_pack_path="${ROOT}/${feature_pack_path}"
fi
if [[ "${out_root}" != /* ]]; then
  out_root="${ROOT}/${out_root}"
fi
if [[ "${candle_path}" != /* ]]; then
  candle_path="${ROOT}/${candle_path}"
fi
if [[ "${investor_daily_path}" != /* ]]; then
  investor_daily_path="${ROOT}/${investor_daily_path}"
fi
if [[ "${program_daily_path}" != /* ]]; then
  program_daily_path="${ROOT}/${program_daily_path}"
fi
if [[ "${trade_strength_daily_path}" != /* ]]; then
  trade_strength_daily_path="${ROOT}/${trade_strength_daily_path}"
fi

[[ -f "${contract_path}" ]] || { echo "missing contract: ${contract_path}" >&2; exit 1; }
[[ -f "${feature_pack_path}" ]] || { echo "missing feature pack: ${feature_pack_path}" >&2; exit 1; }
control_input_summary_path="$(dirname "${feature_pack_path}")/control_input_summary.json"
[[ -f "${control_input_summary_path}" ]] || { echo "missing control-input summary: ${control_input_summary_path}" >&2; exit 1; }

eval "$(
  node --input-type=module - "${contract_path}" "${gate_id}" "${allowed_lanes}" "${control_input_summary_path}" <<'NODE'
import { loadTp12SideDailyResearchContract } from "./src/lib/tp12_side_daily_contract.mjs"
import { resolveTp12SideDailyComparisonVariants } from "./src/lib/tp12_side_daily_family_variants.mjs"
import { normalizeDateKey } from "./src/lib/date.mjs"
import { readJson } from "./src/lib/io.mjs"

const [contractPath, gateIdRaw, allowedLanesRaw, controlInputSummaryPath] = process.argv.slice(2)
const contract = await loadTp12SideDailyResearchContract({ contractPath, cwd: process.cwd() })
const controlInputSummary = await readJson(controlInputSummaryPath, null)
if (!controlInputSummary || typeof controlInputSummary !== "object") {
  throw new Error(`Missing control-input summary: ${controlInputSummaryPath}`)
}
if (String(controlInputSummary.kind ?? "") !== "tp12_side_daily_control_input_pack_v1") {
  throw new Error(`Unsupported control-input summary kind=${controlInputSummary.kind ?? "unknown"}`)
}

const normalizeRequiredDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid in ${controlInputSummaryPath}: ${value ?? "<null>"}`)
  }
  return normalized
}

const supportedDecisionFrom = normalizeRequiredDateKey(controlInputSummary.decisionDateFrom, "decisionDateFrom")
const supportedDecisionTo = normalizeRequiredDateKey(controlInputSummary.decisionDateTo, "decisionDateTo")
const supportedTrainFrom = normalizeRequiredDateKey(controlInputSummary.coverage?.train?.decisionDateFrom, "coverage.train.decisionDateFrom")
const supportedTrainTo = normalizeRequiredDateKey(controlInputSummary.coverage?.train?.decisionDateTo, "coverage.train.decisionDateTo")
const supportedOosFrom = normalizeRequiredDateKey(controlInputSummary.coverage?.oos?.decisionDateFrom, "coverage.oos.decisionDateFrom")
const supportedOosTo = normalizeRequiredDateKey(controlInputSummary.coverage?.oos?.decisionDateTo, "coverage.oos.decisionDateTo")

if (supportedDecisionFrom > contract.control.trainDateFrom) {
  throw new Error(
    `Control-input coverage does not reach frozen train floor: requested=${contract.control.trainDateFrom} actual=${supportedDecisionFrom}`,
  )
}
if (supportedTrainFrom > contract.control.trainDateFrom) {
  throw new Error(
    `Control-input train coverage does not reach frozen train floor: requested=${contract.control.trainDateFrom} actual=${supportedTrainFrom}`,
  )
}
if (supportedOosFrom > contract.control.oosDateFrom) {
  throw new Error(
    `Control-input OOS coverage does not reach frozen OOS floor: requested=${contract.control.oosDateFrom} actual=${supportedOosFrom}`,
  )
}

const effectiveDecisionFrom = contract.decisionWindow.from
const effectiveDecisionTo = supportedDecisionTo < contract.decisionWindow.to ? supportedDecisionTo : contract.decisionWindow.to
const effectiveTrainDateFrom = contract.control.trainDateFrom
const effectiveTrainDateTo = supportedTrainTo < contract.control.trainDateTo ? supportedTrainTo : contract.control.trainDateTo
const effectiveOosDateFrom = contract.control.oosDateFrom
const effectiveOosDateTo = supportedOosTo < contract.control.oosDateTo ? supportedOosTo : contract.control.oosDateTo

if (effectiveDecisionFrom > effectiveDecisionTo) {
  throw new Error(`Invalid effective decision window ${effectiveDecisionFrom}:${effectiveDecisionTo}`)
}
if (effectiveTrainDateFrom > effectiveTrainDateTo) {
  throw new Error(`Invalid effective train range ${effectiveTrainDateFrom}:${effectiveTrainDateTo}`)
}
if (effectiveOosDateFrom > effectiveOosDateTo) {
  throw new Error(`Invalid effective OOS range ${effectiveOosDateFrom}:${effectiveOosDateTo}`)
}
if (!(effectiveTrainDateTo < effectiveOosDateFrom)) {
  throw new Error(`Effective train/OOS ranges must not overlap: trainEnd=${effectiveTrainDateTo} oosStart=${effectiveOosDateFrom}`)
}

const variants = resolveTp12SideDailyComparisonVariants({
  comparisonOrder: contract.comparisonOrder,
  gateId: gateIdRaw,
})
const allowedLanes = String(allowedLanesRaw ?? "").trim() || contract.control.stepALaneSet.join(",")
console.log(`CONTRACT_ID=${contract.contractId}`)
console.log(`REQUESTED_DECISION_FROM=${contract.decisionWindow.from}`)
console.log(`REQUESTED_DECISION_TO=${contract.decisionWindow.to}`)
console.log(`REQUESTED_TRAIN_DATE_FROM=${contract.control.trainDateFrom}`)
console.log(`REQUESTED_TRAIN_DATE_TO=${contract.control.trainDateTo}`)
console.log(`REQUESTED_OOS_DATE_FROM=${contract.control.oosDateFrom}`)
console.log(`REQUESTED_OOS_DATE_TO=${contract.control.oosDateTo}`)
console.log(`EFFECTIVE_DECISION_FROM=${effectiveDecisionFrom}`)
console.log(`EFFECTIVE_DECISION_TO=${effectiveDecisionTo}`)
console.log(`EFFECTIVE_TRAIN_DATE_FROM=${effectiveTrainDateFrom}`)
console.log(`EFFECTIVE_TRAIN_DATE_TO=${effectiveTrainDateTo}`)
console.log(`EFFECTIVE_OOS_DATE_FROM=${effectiveOosDateFrom}`)
console.log(`EFFECTIVE_OOS_DATE_TO=${effectiveOosDateTo}`)
console.log(`CONTROL_INPUT_SUMMARY_PATH=${controlInputSummaryPath}`)
console.log(`FEATURE_PACK_DECISION_FROM=${supportedDecisionFrom}`)
console.log(`FEATURE_PACK_DECISION_TO=${supportedDecisionTo}`)
console.log(`FEATURE_PACK_TRAIN_DATE_FROM=${supportedTrainFrom}`)
console.log(`FEATURE_PACK_TRAIN_DATE_TO=${supportedTrainTo}`)
console.log(`FEATURE_PACK_OOS_DATE_FROM=${supportedOosFrom}`)
console.log(`FEATURE_PACK_OOS_DATE_TO=${supportedOosTo}`)
console.log(`STEPA_LANES=${contract.control.stepALaneSet.join(",")}`)
console.log(`TARGET_LABEL_IDS=${contract.control.targetLabelIds.join(",")}`)
console.log(`ALLOWLIST_POLICY=${contract.control.allowlistPolicy}`)
console.log(`COMMON_SUPPORT_POLICY=${contract.control.commonSupportPolicy}`)
console.log(`PIPELINE_ALLOWED_LANES=${allowedLanes}`)
console.log(`VARIANT_COUNT=${variants.length}`)
variants.forEach((variant, index) => {
  console.log(`VARIANT_${index}_ID=${variant.variantId}`)
  console.log(`VARIANT_${index}_KIND=${variant.kind}`)
  console.log(`VARIANT_${index}_GATE_ID=${variant.gateId}`)
  console.log(`VARIANT_${index}_DATASET_IDS=${variant.datasetIdCsv}`)
})
NODE
)"

allowlist_dir="${out_root}/allowlist"
manifest_dir="${out_root}/manifest"
control_root="${out_root}/control"
feature_root="${out_root}/features"
bridge_root="${out_root}/bridged_feature_pack"
pipeline_summary="${out_root}/pipeline_summary.json"

bash tools/run_tp12_side_daily_full_period_allowlist.sh \
  "--run-dir=${downstream_run_dir}" \
  "--out-dir=${allowlist_dir}" \
  "--decision-from=${EFFECTIVE_DECISION_FROM}" \
  "--decision-to=${EFFECTIVE_DECISION_TO}" \
  "--allowed-lanes=${PIPELINE_ALLOWED_LANES}" \
  --skip-verify

allowlist_path="${allowlist_dir}/allowlist_rows.jsonl"
allowlist_summary_path="${allowlist_dir}/allowlist_summary.json"
node --input-type=module - "${allowlist_path}" "${allowlist_summary_path}" "${feature_pack_path}" "${candle_path}" "${EFFECTIVE_TRAIN_DATE_FROM}" "${EFFECTIVE_TRAIN_DATE_TO}" "${EFFECTIVE_OOS_DATE_FROM}" "${EFFECTIVE_OOS_DATE_TO}" <<'NODE'
import { compareDateKey, normalizeDateKey } from "./src/lib/date.mjs"
import { iterateJsonl, readJson, writeJson, writeJsonl } from "./src/lib/io.mjs"

const [allowlistPath, summaryPath, featurePackPath, candlePath, trainDateFrom, trainDateTo, oosDateFrom, oosDateTo] = process.argv.slice(2)
const normalizedTrainDateFrom = normalizeDateKey(trainDateFrom)
const normalizedTrainDateTo = normalizeDateKey(trainDateTo)
const normalizedOosDateFrom = normalizeDateKey(oosDateFrom)
const normalizedOosDateTo = normalizeDateKey(oosDateTo)
if (!normalizedTrainDateFrom || !normalizedTrainDateTo || !normalizedOosDateFrom || !normalizedOosDateTo) {
  throw new Error("Effective split dates are missing while trimming allowlist")
}

const rows = []
await iterateJsonl(allowlistPath, {
  strict: true,
  onRow: async (row) => {
    rows.push(row)
  },
})
if (rows.length < 1) {
  throw new Error(`Scientific allowlist is empty before split trim: ${allowlistPath}`)
}

const inEffectiveSplit = (dateKey) =>
  (dateKey >= normalizedTrainDateFrom && dateKey <= normalizedTrainDateTo) ||
  (dateKey >= normalizedOosDateFrom && dateKey <= normalizedOosDateTo)

const featurePackKeys = new Set()
await iterateJsonl(featurePackPath, {
  strict: true,
  onRow: async (row) => {
    const decisionDateKey = normalizeDateKey(row?.decisionDateKey ?? row?.dateKey)
    const symbol = String(row?.symbol ?? "").trim()
    const stepALaneId = String(row?.stepALaneId ?? "").trim()
    if (!decisionDateKey || !symbol || !stepALaneId) return
    if (!inEffectiveSplit(decisionDateKey)) return
    featurePackKeys.add(`${decisionDateKey}::${symbol}::${stepALaneId}`)
  },
})
if (featurePackKeys.size < 1) {
  throw new Error(`Scientific feature-pack support is empty after effective split filter: ${featurePackPath}`)
}

let trimmedByEffectiveSplit = 0
let trimmedByFeaturePackIntersection = 0
const featureSupportedRows = rows.filter((row) => {
  const decisionDateKey = normalizeDateKey(row?.decisionDateKey ?? row?.dateKey)
  const symbol = String(row?.symbol ?? "").trim()
  const stepALaneId = String(row?.stepALaneId ?? "").trim()
  if (!decisionDateKey || !symbol || !stepALaneId) {
    throw new Error(`Malformed scientific allowlist row missing exact-pair fields: ${JSON.stringify(row)}`)
  }
  if (!inEffectiveSplit(decisionDateKey)) {
    trimmedByEffectiveSplit += 1
    return false
  }
  const exactKey = `${decisionDateKey}::${symbol}::${stepALaneId}`
  if (!featurePackKeys.has(exactKey)) {
    trimmedByFeaturePackIntersection += 1
    return false
  }
  return true
})
if (featureSupportedRows.length < 1) {
  throw new Error(`Scientific allowlist became empty after effective split trim: ${allowlistPath}`)
}

const requiredSymbols = new Set(featureSupportedRows.map((row) => String(row?.symbol ?? "").trim()).filter(Boolean))
const symbolTradingDates = new Map()
await iterateJsonl(candlePath, {
  strict: true,
  onRow: async (row) => {
    const symbol = String(row?.symbol ?? "").trim()
    if (!requiredSymbols.has(symbol)) return
    const dateKey = normalizeDateKey(row?.dateKey)
    if (!dateKey) return
    const dates = symbolTradingDates.get(symbol)
    if (dates) {
      dates.push(dateKey)
      return
    }
    symbolTradingDates.set(symbol, [dateKey])
  },
})

const symbolTradingDateIndexByKey = new Map()
for (const [symbol, dates] of symbolTradingDates.entries()) {
  dates.sort(compareDateKey)
  const indexByKey = new Map()
  dates.forEach((dateKey, index) => {
    indexByKey.set(dateKey, index)
  })
  symbolTradingDateIndexByKey.set(symbol, indexByKey)
}

const hasFullCandleWindow = (symbol, decisionDateKey) => {
  const tradingDates = symbolTradingDates.get(symbol)
  const tradingDateIndexByKey = symbolTradingDateIndexByKey.get(symbol)
  if (!Array.isArray(tradingDates) || !tradingDateIndexByKey) {
    return false
  }
  const decisionIndex = tradingDateIndexByKey.get(decisionDateKey)
  if (!Number.isInteger(decisionIndex)) {
    return false
  }
  const requestedIndexes = [decisionIndex - 1, decisionIndex, decisionIndex + 1, decisionIndex + 2, decisionIndex + 3, decisionIndex + 4]
  return requestedIndexes.every((index) => index >= 0 && index < tradingDates.length)
}

let trimmedByCandleWindowSupport = 0
const filteredRows = featureSupportedRows.filter((row) => {
  const decisionDateKey = normalizeDateKey(row?.decisionDateKey ?? row?.dateKey)
  const symbol = String(row?.symbol ?? "").trim()
  if (!decisionDateKey || !symbol) {
    throw new Error(`Malformed scientific allowlist row while checking candle support: ${JSON.stringify(row)}`)
  }
  if (!hasFullCandleWindow(symbol, decisionDateKey)) {
    trimmedByCandleWindowSupport += 1
    return false
  }
  return true
})
if (filteredRows.length < 1) {
  throw new Error(`Scientific allowlist became empty after candle-window trim: ${allowlistPath}`)
}

filteredRows.sort((left, right) => {
  const dateCmp = compareDateKey(String(left.decisionDateKey ?? left.dateKey), String(right.decisionDateKey ?? right.dateKey))
  if (dateCmp !== 0) return dateCmp
  const symbolCmp = String(left.symbol ?? "").localeCompare(String(right.symbol ?? ""))
  if (symbolCmp !== 0) return symbolCmp
  return String(left.stepALaneId ?? "").localeCompare(String(right.stepALaneId ?? ""))
})

const laneCounts = new Map()
const sourceTypeCounts = new Map()
for (const row of filteredRows) {
  const laneId = String(row?.stepALaneId ?? "").trim()
  const sourceType = String(row?.sourceType ?? "").trim()
  if (laneId) {
    laneCounts.set(laneId, Number(laneCounts.get(laneId) ?? 0) + 1)
  }
  if (sourceType) {
    sourceTypeCounts.set(sourceType, Number(sourceTypeCounts.get(sourceType) ?? 0) + 1)
  }
}

const existingSummary = (await readJson(summaryPath, null)) ?? {}
await writeJsonl(allowlistPath, filteredRows)
await writeJson(summaryPath, {
  ...existingSummary,
  rowCount: filteredRows.length,
  decisionDateFrom: filteredRows[0]?.decisionDateKey ?? filteredRows[0]?.dateKey ?? null,
  decisionDateTo: filteredRows[filteredRows.length - 1]?.decisionDateKey ?? filteredRows[filteredRows.length - 1]?.dateKey ?? null,
  laneCounts: Object.fromEntries(Array.from(laneCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
  sourceTypeCounts: Object.fromEntries(Array.from(sourceTypeCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
  requestedRowCount: rows.length,
  trimmedByEffectiveSplit,
  trimmedByFeaturePackIntersection,
  trimmedByCandleWindowSupport,
  effectiveSplit: {
    trainDateFrom: normalizedTrainDateFrom,
    trainDateTo: normalizedTrainDateTo,
    oosDateFrom: normalizedOosDateFrom,
    oosDateTo: normalizedOosDateTo,
  },
})
NODE
manifest_path="${manifest_dir}/requests.jsonl"
manifest_summary="${manifest_dir}/manifest_summary.json"

bash tools/run_tp12_side_daily_full_period_manifest.sh \
  "--train-run-dir=${train_run_dir}" \
  "--oos-run-dir=${oos_run_dir}" \
  "--allowlist-path=${allowlist_path}" \
  "--out=${manifest_path}" \
  "--summary-out=${manifest_summary}" \
  "--candle-path=${candle_path}" \
  "--allowed-lanes=${PIPELINE_ALLOWED_LANES}" \
  "--train-date-from=${EFFECTIVE_TRAIN_DATE_FROM}" \
  "--train-date-to=${EFFECTIVE_TRAIN_DATE_TO}" \
  "--oos-date-from=${EFFECTIVE_OOS_DATE_FROM}" \
  "--oos-date-to=${EFFECTIVE_OOS_DATE_TO}" \
  --skip-verify

variant_summary_entries=()
for ((i=0; i<VARIANT_COUNT; i+=1)); do
  variant_id_var="VARIANT_${i}_ID"
  variant_kind_var="VARIANT_${i}_KIND"
  variant_gate_var="VARIANT_${i}_GATE_ID"
  variant_dataset_var="VARIANT_${i}_DATASET_IDS"
  variant_id="${!variant_id_var}"
  variant_kind="${!variant_kind_var}"
  variant_gate="${!variant_gate_var}"
  variant_dataset_ids="${!variant_dataset_var}"

  control_dir="${control_root}/${variant_id}"
  control_pack_out="${control_dir}/decision_candidates_feature_pack_control.jsonl"
  control_label_out="${control_dir}/no_stop_label_rows.jsonl"
  control_summary_out="${control_dir}/control_summary.json"
  variant_manifest_path="${manifest_dir}/${variant_id}_requests.jsonl"
  variant_manifest_summary="${manifest_dir}/${variant_id}_manifest_support_summary.json"
  selected_manifest_path="${manifest_path}"

  if [[ "${variant_kind}" == "control" ]]; then
    bash tools/run_tp12_side_daily_control.sh \
      "--manifest-path=${selected_manifest_path}" \
      "--feature-pack-path=${feature_pack_path}" \
      "--out=${control_pack_out}" \
      "--label-out=${control_label_out}" \
      "--summary-out=${control_summary_out}" \
      "--contract-path=${contract_path}" \
      "--candle-path=${candle_path}" \
      "--decision-from=${EFFECTIVE_DECISION_FROM}" \
      "--decision-to=${EFFECTIVE_DECISION_TO}" \
      --skip-verify
    variant_summary_entries+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' "${variant_id}" "${variant_kind}" "${variant_gate}" "${variant_dataset_ids}" "" "" "" "${control_pack_out}" "${control_label_out}" "${control_summary_out}")")
    continue
  fi

  node --input-type=module - "${manifest_path}" "${variant_manifest_path}" "${variant_manifest_summary}" "${variant_dataset_ids}" "${investor_daily_path}" "${program_daily_path}" "${trade_strength_daily_path}" <<'NODE'
import { normalizeDateKey } from "./src/lib/date.mjs"
import { iterateJsonl, writeJson, writeJsonl } from "./src/lib/io.mjs"

const [
  manifestPath,
  outPath,
  summaryPath,
  datasetIdCsv,
  investorDailyPath,
  programDailyPath,
  tradeStrengthDailyPath,
] = process.argv.slice(2)

const datasetIds = Array.from(
  new Set(
    String(datasetIdCsv ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ),
).sort((left, right) => left.localeCompare(right))
if (datasetIds.length < 1) {
  throw new Error(`Variant manifest support filter requires at least one datasetId: ${datasetIdCsv}`)
}

const datasetPathById = new Map([
  ["investor_daily", investorDailyPath],
  ["program_daily", programDailyPath],
  ["trade_strength_daily", tradeStrengthDailyPath],
])

const pairKey = (symbol, dateKey) => `${String(symbol ?? "").trim()}::${normalizeDateKey(dateKey)}`

const manifestRows = []
const requestedPairsByDataset = new Map(datasetIds.map((datasetId) => [datasetId, new Set()]))
await iterateJsonl(manifestPath, {
  strict: true,
  onRow: async (row) => {
    const symbol = String(row?.symbol ?? "").trim()
    const decisionDateKey = normalizeDateKey(row?.decisionDateKey)
    const prevDateKey = normalizeDateKey(row?.prevDateKey)
    if (!symbol || !decisionDateKey || !prevDateKey) {
      throw new Error(`Malformed manifest row while filtering side support: ${JSON.stringify(row)}`)
    }
    manifestRows.push(row)
    for (const datasetId of datasetIds) {
      const requestedPairs = requestedPairsByDataset.get(datasetId)
      requestedPairs.add(pairKey(symbol, prevDateKey))
      requestedPairs.add(pairKey(symbol, decisionDateKey))
    }
  },
})
if (manifestRows.length < 1) {
  throw new Error(`Variant manifest support filter received empty manifest: ${manifestPath}`)
}

const coverageByDataset = new Map()
for (const datasetId of datasetIds) {
  const datasetPath = datasetPathById.get(datasetId)
  if (!datasetPath) {
    throw new Error(`Unsupported side dataset for variant manifest support filter: ${datasetId}`)
  }
  const requestedPairs = requestedPairsByDataset.get(datasetId)
  const coveredPairs = new Set()
  await iterateJsonl(datasetPath, {
    strict: true,
    onRow: async (row) => {
      const symbol = String(row?.symbol ?? "").trim()
      const dateKey = normalizeDateKey(row?.dateKey)
      if (!symbol || !dateKey) return
      const key = pairKey(symbol, dateKey)
      if (!requestedPairs.has(key)) return
      coveredPairs.add(key)
    },
  })
  coverageByDataset.set(datasetId, coveredPairs)
}

const droppedByDatasetId = Object.fromEntries(datasetIds.map((datasetId) => [datasetId, 0]))
const filteredRows = manifestRows.filter((row) => {
  const symbol = String(row?.symbol ?? "").trim()
  const decisionDateKey = normalizeDateKey(row?.decisionDateKey)
  const prevDateKey = normalizeDateKey(row?.prevDateKey)
  for (const datasetId of datasetIds) {
    const coverage = coverageByDataset.get(datasetId)
    const prevKey = pairKey(symbol, prevDateKey)
    const decisionKey = pairKey(symbol, decisionDateKey)
    if (!coverage.has(prevKey) || !coverage.has(decisionKey)) {
      droppedByDatasetId[datasetId] += 1
      return false
    }
  }
  return true
})
if (filteredRows.length < 1) {
  throw new Error(
    `Variant manifest became empty after side-support filter: datasets=${datasetIds.join(",")} manifest=${manifestPath}`,
  )
}

await writeJsonl(outPath, filteredRows)
await writeJson(summaryPath, {
  kind: "tp12_side_daily_variant_manifest_support_v1",
  status: "ok",
  manifestPath,
  outPath,
  rowCount: filteredRows.length,
  requestedRowCount: manifestRows.length,
  trimmedBySideSupport: manifestRows.length - filteredRows.length,
  decisionDateFrom: filteredRows[0]?.decisionDateKey ?? null,
  decisionDateTo: filteredRows[filteredRows.length - 1]?.decisionDateKey ?? null,
  datasetIds,
  droppedByDatasetId,
})
NODE
  selected_manifest_path="${variant_manifest_path}"

  feature_dir="${feature_root}/${variant_id}"
  side_feature_out="${feature_dir}/feature_rows.jsonl"
  side_feature_summary="${feature_dir}/feature_summary.json"
  bridged_dir="${bridge_root}/${variant_id}"
  bridged_base_feature_pack="${bridged_dir}/base_feature_pack.jsonl"
  bridged_base_feature_pack_summary="${bridged_dir}/base_feature_pack_summary.json"
  bridged_out="${bridged_dir}/decision_candidates_feature_pack_side_${variant_gate}.jsonl"
  bridged_meta_out="${bridged_out}.meta.json"

  bash tools/run_tp12_side_daily_feature_dataset.sh \
    "--manifest-path=${selected_manifest_path}" \
    "--out=${side_feature_out}" \
    "--summary-out=${side_feature_summary}" \
    "--candle-path=${candle_path}" \
    "--investor-daily-path=${investor_daily_path}" \
    "--program-daily-path=${program_daily_path}" \
    "--trade-strength-daily-path=${trade_strength_daily_path}" \
    "--dataset-ids=${variant_dataset_ids}" \
    "--gate-ids=${variant_gate}" \
    "--decision-from=${EFFECTIVE_DECISION_FROM}" \
    "--decision-to=${EFFECTIVE_DECISION_TO}" \
    --skip-verify

  node --input-type=module - "${selected_manifest_path}" "${feature_pack_path}" "${bridged_base_feature_pack}" "${bridged_base_feature_pack_summary}" <<'NODE'
import { normalizeDateKey } from "./src/lib/date.mjs"
import { iterateJsonl, writeJson, writeJsonl } from "./src/lib/io.mjs"

const [manifestPath, featurePackPath, outPath, summaryPath] = process.argv.slice(2)

const pairKey = (symbol, decisionDateKey) => `${String(symbol ?? "").trim()}::${normalizeDateKey(decisionDateKey)}`

const manifestPairs = new Set()
await iterateJsonl(manifestPath, {
  strict: true,
  onRow: async (row) => {
    const symbol = String(row?.symbol ?? "").trim()
    const decisionDateKey = normalizeDateKey(row?.decisionDateKey)
    if (!symbol || !decisionDateKey) {
      throw new Error(`Malformed manifest row while slicing base feature pack: ${JSON.stringify(row)}`)
    }
    manifestPairs.add(pairKey(symbol, decisionDateKey))
  },
})
if (manifestPairs.size < 1) {
  throw new Error(`Cannot slice base feature pack with empty manifest pair set: ${manifestPath}`)
}

const slicedRows = []
const matchedPairs = new Set()
await iterateJsonl(featurePackPath, {
  strict: true,
  onRow: async (row) => {
    const symbol = String(row?.symbol ?? "").trim()
    const decisionDateKey = normalizeDateKey(row?.decisionDateKey)
    if (!symbol || !decisionDateKey) return
    const joinKey = pairKey(symbol, decisionDateKey)
    if (!manifestPairs.has(joinKey)) return
    if (matchedPairs.has(joinKey)) {
      throw new Error(`Duplicate base feature pack row while slicing scientific variant support: ${joinKey}`)
    }
    matchedPairs.add(joinKey)
    slicedRows.push(row)
  },
})
if (slicedRows.length !== manifestPairs.size) {
  throw new Error(
    `Base feature pack slice mismatch: manifestPairs=${manifestPairs.size} matchedFeatureRows=${slicedRows.length} featurePack=${featurePackPath}`,
  )
}

await writeJsonl(outPath, slicedRows)
await writeJson(summaryPath, {
  kind: "tp12_side_daily_variant_base_feature_pack_v1",
  status: "ok",
  manifestPath,
  featurePackPath,
  outPath,
  rowCount: slicedRows.length,
  decisionDateFrom: slicedRows[0]?.decisionDateKey ?? null,
  decisionDateTo: slicedRows[slicedRows.length - 1]?.decisionDateKey ?? null,
})
NODE

  bash tools/run_tp12_side_daily_feature_pack_bridge.sh \
    "--feature-pack-path=${bridged_base_feature_pack}" \
    "--side-feature-path=${side_feature_out}" \
    "--gate-id=${variant_gate}" \
    "--out=${bridged_out}" \
    "--meta-out=${bridged_meta_out}" \
    "--decision-from=${EFFECTIVE_DECISION_FROM}" \
    "--decision-to=${EFFECTIVE_DECISION_TO}" \
    --skip-verify

  bash tools/run_tp12_side_daily_control.sh \
    "--manifest-path=${selected_manifest_path}" \
    "--feature-pack-path=${bridged_out}" \
    "--out=${control_pack_out}" \
    "--label-out=${control_label_out}" \
      "--summary-out=${control_summary_out}" \
      "--contract-path=${contract_path}" \
      "--candle-path=${candle_path}" \
      "--decision-from=${EFFECTIVE_DECISION_FROM}" \
      "--decision-to=${EFFECTIVE_DECISION_TO}" \
      --skip-verify

  variant_summary_entries+=("$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' "${variant_id}" "${variant_kind}" "${variant_gate}" "${variant_dataset_ids}" "${side_feature_out}" "${side_feature_summary}" "${bridged_out}" "${control_pack_out}" "${control_label_out}" "${control_summary_out}")")
done

node --input-type=module - "${pipeline_summary}" "${run_id}" "${contract_path}" "${CONTRACT_ID}" "${downstream_run_dir}" "${train_run_dir}" "${oos_run_dir}" "${feature_pack_path}" "${control_input_summary_path}" "${allowlist_path}" "${manifest_path}" "${manifest_summary}" "${REQUESTED_DECISION_FROM}" "${REQUESTED_DECISION_TO}" "${REQUESTED_TRAIN_DATE_FROM}" "${REQUESTED_TRAIN_DATE_TO}" "${REQUESTED_OOS_DATE_FROM}" "${REQUESTED_OOS_DATE_TO}" "${EFFECTIVE_DECISION_FROM}" "${EFFECTIVE_DECISION_TO}" "${EFFECTIVE_TRAIN_DATE_FROM}" "${EFFECTIVE_TRAIN_DATE_TO}" "${EFFECTIVE_OOS_DATE_FROM}" "${EFFECTIVE_OOS_DATE_TO}" "${FEATURE_PACK_DECISION_FROM}" "${FEATURE_PACK_DECISION_TO}" "${FEATURE_PACK_TRAIN_DATE_FROM}" "${FEATURE_PACK_TRAIN_DATE_TO}" "${FEATURE_PACK_OOS_DATE_FROM}" "${FEATURE_PACK_OOS_DATE_TO}" "${PIPELINE_ALLOWED_LANES}" "${gate_id}" "${variant_summary_entries[@]}" <<'NODE'
import fs from "node:fs/promises"
import path from "node:path"

const [
  summaryOutPath,
  runId,
  contractPath,
  contractId,
  downstreamRunDir,
  trainRunDir,
  oosRunDir,
  featurePackPath,
  controlInputSummaryPath,
  allowlistPath,
  manifestPath,
  manifestSummaryPath,
  requestedDecisionFrom,
  requestedDecisionTo,
  requestedTrainDateFrom,
  requestedTrainDateTo,
  requestedOosDateFrom,
  requestedOosDateTo,
  decisionFrom,
  decisionTo,
  trainDateFrom,
  trainDateTo,
  oosDateFrom,
  oosDateTo,
  featurePackDecisionFrom,
  featurePackDecisionTo,
  featurePackTrainDateFrom,
  featurePackTrainDateTo,
  featurePackOosDateFrom,
  featurePackOosDateTo,
  allowedLanes,
  gateId,
  ...variantEntries
] = process.argv.slice(2)

const variants = variantEntries.map((entry) => {
  const [
    variantId,
    kind,
    resolvedGateId,
    datasetIdCsv,
    sideFeaturePath,
    sideFeatureSummaryPath,
    bridgedFeaturePackPath,
    controlPackPath,
    controlLabelPath,
    controlSummaryPath,
  ] = String(entry).split("\t")
  return {
    variantId,
    kind,
    gateId: resolvedGateId || null,
    datasetIds: String(datasetIdCsv || "").split(",").map((value) => value.trim()).filter(Boolean),
    sideFeaturePath: sideFeaturePath || null,
    sideFeatureSummaryPath: sideFeatureSummaryPath || null,
    bridgedFeaturePackPath: bridgedFeaturePackPath || null,
    controlPackPath: controlPackPath || null,
    controlLabelPath: controlLabelPath || null,
    controlSummaryPath: controlSummaryPath || null,
  }
})

const summary = {
  kind: "tp12_side_daily_scientific_control_pipeline_v1",
  status: "artifact_ready",
  runId,
  contract: {
    contractId,
    contractPath,
  },
  requestedDecisionWindow: {
    from: requestedDecisionFrom,
    to: requestedDecisionTo,
  },
  decisionWindow: {
    from: decisionFrom,
    to: decisionTo,
  },
  requestedSplit: {
    trainDateFrom: requestedTrainDateFrom,
    trainDateTo: requestedTrainDateTo,
    oosDateFrom: requestedOosDateFrom,
    oosDateTo: requestedOosDateTo,
  },
  split: {
    trainDateFrom,
    trainDateTo,
    oosDateFrom,
    oosDateTo,
  },
  allowedLanes: String(allowedLanes).split(",").map((value) => value.trim()).filter(Boolean),
  defaultGateId: gateId,
  upstream: {
    downstreamRunDir,
    trainRunDir,
    oosRunDir,
    featurePackPath,
    controlInputSummaryPath,
    allowlistPath,
    manifestPath,
    manifestSummaryPath,
  },
  effectiveCoverage: {
    featurePack: {
      decisionDateFrom: featurePackDecisionFrom,
      decisionDateTo: featurePackDecisionTo,
      train: {
        decisionDateFrom: featurePackTrainDateFrom,
        decisionDateTo: featurePackTrainDateTo,
      },
      oos: {
        decisionDateFrom: featurePackOosDateFrom,
        decisionDateTo: featurePackOosDateTo,
      },
    },
  },
  variants,
  scoringPending: true,
}
await fs.mkdir(path.dirname(summaryOutPath), { recursive: true })
await fs.writeFile(summaryOutPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
NODE

if (( skip_verify == 0 )); then
  npm run verify
fi

echo "DONE run_tp12_side_daily_scientific_control_pipeline run_id=${run_id} summary=${pipeline_summary}"
