import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { readJson } from "./io.mjs"

export const TP12_NO_STOP_LB5_YEAR2X7_RESEARCH_CONTRACT_KIND = "tp12_no_stop_lb5_year2x7_research_contract_v1"
export const DEFAULT_TP12_NO_STOP_LB5_YEAR2X7_RESEARCH_CONTRACT_PATH =
  "meta/tp12_no_stop_lb5_year2x7_research_contract.json"

const toText = (value) => String(value ?? "").trim()

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const assertPositiveInteger = (value, label) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${label} must be a positive integer: ${value ?? "<null>"}`)
  }
  return numeric
}

const assertFiniteNumber = (value, label) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be finite: ${value ?? "<null>"}`)
  }
  return numeric
}

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value)),
    ),
  ).sort((left, right) => left - right)

export const loadTp12NoStopLb5Year2x7ResearchContract = async ({
  contractPath = DEFAULT_TP12_NO_STOP_LB5_YEAR2X7_RESEARCH_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_NO_STOP_LB5_YEAR2X7_RESEARCH_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-stop lb5 year2x7 contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_STOP_LB5_YEAR2X7_RESEARCH_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-stop lb5 year2x7 contract kind=${kind}`)
  }
  const trainWindow = {
    from: assertDateKey(raw?.trainWindow?.from, "trainWindow.from"),
    to: assertDateKey(raw?.trainWindow?.to, "trainWindow.to"),
  }
  const oosWindow = {
    from: assertDateKey(raw?.oosWindow?.from, "oosWindow.from"),
    to: assertDateKey(raw?.oosWindow?.to, "oosWindow.to"),
  }
  if (trainWindow.from > trainWindow.to) {
    throw new Error(`Invalid train window ${trainWindow.from}:${trainWindow.to}`)
  }
  if (oosWindow.from > oosWindow.to) {
    throw new Error(`Invalid oos window ${oosWindow.from}:${oosWindow.to}`)
  }
  if (!(trainWindow.to < oosWindow.from)) {
    throw new Error(`train/oos overlap: trainEnd=${trainWindow.to} oosStart=${oosWindow.from}`)
  }
  const coreYears = uniqueSortedNumbers(raw?.yearCoverage?.coreYears)
  if (coreYears.length < 1) {
    throw new Error("yearCoverage.coreYears must contain at least one year")
  }
  const excludedBoundaryYears = uniqueSortedNumbers(raw?.yearCoverage?.excludedBoundaryYears)
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    scopeId: assertNonEmpty(raw.scopeId, "contract.scopeId"),
    baseCandidateId: assertNonEmpty(raw.baseCandidateId, "contract.baseCandidateId"),
    lookbackTradingDays: assertPositiveInteger(raw.lookbackTradingDays, "contract.lookbackTradingDays"),
    baseRollingContractPath: path.resolve(
      cwd,
      assertNonEmpty(raw.baseRollingContractPath, "contract.baseRollingContractPath"),
    ),
    trainWindow,
    oosWindow,
    labelContract: {
      primaryLabelId: assertNonEmpty(raw?.labelContract?.primaryLabelId, "labelContract.primaryLabelId"),
      secondaryLabelId: assertNonEmpty(raw?.labelContract?.secondaryLabelId, "labelContract.secondaryLabelId"),
    },
    yearCoverage: {
      coreYears,
      minHitsPerCoreYear: assertPositiveInteger(raw?.yearCoverage?.minHitsPerCoreYear, "yearCoverage.minHitsPerCoreYear"),
      excludedBoundaryYears,
    },
    baselineRunIds: {
      baseRunId: assertNonEmpty(raw?.baselineRunIds?.baseRunId, "baselineRunIds.baseRunId"),
      sourceRunId: assertNonEmpty(raw?.baselineRunIds?.sourceRunId, "baselineRunIds.sourceRunId"),
      scopeRunId: assertNonEmpty(raw?.baselineRunIds?.scopeRunId, "baselineRunIds.scopeRunId"),
    },
    baselineMetrics: {
      curatedRuleCount: assertPositiveInteger(raw?.baselineMetrics?.curatedRuleCount, "baselineMetrics.curatedRuleCount"),
      trainSelectedRows: assertPositiveInteger(raw?.baselineMetrics?.trainSelectedRows, "baselineMetrics.trainSelectedRows"),
      trainHitRows: assertPositiveInteger(raw?.baselineMetrics?.trainHitRows, "baselineMetrics.trainHitRows"),
      trainHitRate: assertFiniteNumber(raw?.baselineMetrics?.trainHitRate, "baselineMetrics.trainHitRate"),
      oosCandidateRows: assertPositiveInteger(raw?.baselineMetrics?.oosCandidateRows, "baselineMetrics.oosCandidateRows"),
      oosSelectedRows: assertPositiveInteger(raw?.baselineMetrics?.oosSelectedRows, "baselineMetrics.oosSelectedRows"),
      oosHitRows: assertPositiveInteger(raw?.baselineMetrics?.oosHitRows, "baselineMetrics.oosHitRows"),
      oosHitRate: assertFiniteNumber(raw?.baselineMetrics?.oosHitRate, "baselineMetrics.oosHitRate"),
      oosUniqueMatchedDates: assertPositiveInteger(
        raw?.baselineMetrics?.oosUniqueMatchedDates,
        "baselineMetrics.oosUniqueMatchedDates",
      ),
      oosUniqueMatchedSymbols: assertPositiveInteger(
        raw?.baselineMetrics?.oosUniqueMatchedSymbols,
        "baselineMetrics.oosUniqueMatchedSymbols",
      ),
      oosTop1DateShare: assertFiniteNumber(raw?.baselineMetrics?.oosTop1DateShare, "baselineMetrics.oosTop1DateShare"),
    },
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}
