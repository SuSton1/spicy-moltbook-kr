import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { readJson } from "./io.mjs"


export const TP12_SIDE_DAILY_RESEARCH_CONTRACT_KIND = "tp12_side_daily_research_contract_v1"
export const DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH = "meta/tp12_side_daily_research_contract.json"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const uniqueInOrder = (values) => {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(values) ? values : []) {
    const value = toText(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const resolveDateKeyOverride = (overrideValue, fallbackValue, label) => {
  const normalizedOverride = normalizeDateKey(overrideValue)
  return normalizedOverride || assertDateKey(fallbackValue, label)
}

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

export const loadTp12SideDailyResearchContract = async ({
  contractPath = DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 side-daily research contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_SIDE_DAILY_RESEARCH_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 side-daily research contract kind=${kind}`)
  }
  const decisionWindow = raw.decisionWindow ?? {}
  const control = raw.control ?? {}
  const comparisonOrder = uniqueInOrder(raw.comparisonOrder)
  if (comparisonOrder.length < 1) {
    throw new Error("comparisonOrder is required")
  }
  const stepALaneSet = uniqueSorted(control.stepALaneSet)
  const targetLabelIds = uniqueSorted(control.targetLabelIds)
  if (stepALaneSet.length < 1) {
    throw new Error("control.stepALaneSet is required")
  }
  if (targetLabelIds.length < 1) {
    throw new Error("control.targetLabelIds is required")
  }
  const contract = {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    scopeId: assertNonEmpty(raw.scopeId, "contract.scopeId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    decisionWindow: {
      from: assertDateKey(decisionWindow.from, "decisionWindow.from"),
      to: assertDateKey(decisionWindow.to, "decisionWindow.to"),
    },
    control: {
      trainDateFrom: assertDateKey(control.trainDateFrom, "control.trainDateFrom"),
      trainDateTo: assertDateKey(control.trainDateTo, "control.trainDateTo"),
      oosDateFrom: assertDateKey(control.oosDateFrom, "control.oosDateFrom"),
      oosDateTo: assertDateKey(control.oosDateTo, "control.oosDateTo"),
      stepALaneSet,
      targetLabelIds,
      allowlistPolicy: assertNonEmpty(control.allowlistPolicy, "control.allowlistPolicy"),
      commonSupportPolicy: assertNonEmpty(control.commonSupportPolicy, "control.commonSupportPolicy"),
    },
    comparisonOrder,
    familyMatrix: raw.familyMatrix ?? {},
    deferExecutionLearning: raw.deferExecutionLearning !== false,
    hardStops: Array.isArray(raw.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
  if (contract.decisionWindow.from > contract.decisionWindow.to) {
    throw new Error(
      `Invalid decisionWindow ${contract.decisionWindow.from}:${contract.decisionWindow.to} in ${resolvedContractPath}`,
    )
  }
  if (contract.control.trainDateFrom > contract.control.trainDateTo) {
    throw new Error(
      `Invalid control train range ${contract.control.trainDateFrom}:${contract.control.trainDateTo} in ${resolvedContractPath}`,
    )
  }
  if (contract.control.oosDateFrom > contract.control.oosDateTo) {
    throw new Error(
      `Invalid control oos range ${contract.control.oosDateFrom}:${contract.control.oosDateTo} in ${resolvedContractPath}`,
    )
  }
  if (!(contract.control.trainDateTo < contract.control.oosDateFrom)) {
    throw new Error(
      `Frozen control split must not overlap in ${resolvedContractPath}: trainEnd=${contract.control.trainDateTo} oosStart=${contract.control.oosDateFrom}`,
    )
  }
  return contract
}

export const resolveTp12SideDailyControlArgsFromContract = async ({
  contractPath = DEFAULT_TP12_SIDE_DAILY_RESEARCH_CONTRACT_PATH,
  cwd = process.cwd(),
  decisionFrom = null,
  decisionTo = null,
  trainDateFrom = null,
  trainDateTo = null,
  oosDateFrom = null,
  oosDateTo = null,
  stepALaneSet = [],
  targetLabelIds = [],
  allowlistPolicy = "",
  commonSupportPolicy = "",
} = {}) => {
  const contract = await loadTp12SideDailyResearchContract({ contractPath, cwd })
  const resolved = {
    contract,
    decisionFrom: resolveDateKeyOverride(decisionFrom, contract.decisionWindow.from, "decisionFrom"),
    decisionTo: resolveDateKeyOverride(decisionTo, contract.decisionWindow.to, "decisionTo"),
    trainDateFrom: resolveDateKeyOverride(trainDateFrom, contract.control.trainDateFrom, "trainDateFrom"),
    trainDateTo: resolveDateKeyOverride(trainDateTo, contract.control.trainDateTo, "trainDateTo"),
    oosDateFrom: resolveDateKeyOverride(oosDateFrom, contract.control.oosDateFrom, "oosDateFrom"),
    oosDateTo: resolveDateKeyOverride(oosDateTo, contract.control.oosDateTo, "oosDateTo"),
    stepALaneSet: uniqueSorted(stepALaneSet.length > 0 ? stepALaneSet : contract.control.stepALaneSet),
    targetLabelIds: uniqueSorted(targetLabelIds.length > 0 ? targetLabelIds : contract.control.targetLabelIds),
    allowlistPolicy: toText(allowlistPolicy) || contract.control.allowlistPolicy,
    commonSupportPolicy: toText(commonSupportPolicy) || contract.control.commonSupportPolicy,
  }
  if (resolved.decisionFrom > resolved.decisionTo) {
    throw new Error(`Invalid decision window ${resolved.decisionFrom}:${resolved.decisionTo}`)
  }
  return resolved
}
