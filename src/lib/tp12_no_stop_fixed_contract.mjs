import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { readJson, writeJson } from "./io.mjs"
import {
  TP12_NO_STOP_ROLLING_CONTRACT_MODE_FIXED_CARRIER,
  TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND,
} from "./tp12_no_stop_rolling_contract.mjs"

export const TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_KIND = "tp12_no_stop_fixed_research_contract_v1"
export const DEFAULT_TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_PATH = "meta/tp12_no_stop_fixed_year2hit_research_contract.json"

export const TP12_NO_STOP_FIXED_SPLIT_KIND_SCREEN = "screen"
export const TP12_NO_STOP_FIXED_SPLIT_KIND_CONFIRM = "confirm"
export const TP12_NO_STOP_FIXED_SPLIT_KIND_PROMOTION_HOLDOUT = "promotion_holdout"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const uniqueSortedNumbers = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value)),
    ),
  ).sort((left, right) => left - right)

const assertDateKey = (value, label) => {
  const normalized = normalizeDateKey(value)
  if (!normalized) {
    throw new Error(`${label} is missing or invalid: ${value ?? "<null>"}`)
  }
  return normalized
}

const assertNonEmpty = (value, label) => {
  const text = toText(value)
  if (!text) {
    throw new Error(`${label} is required`)
  }
  return text
}

const assertPositiveInteger = (value, label) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${label} must be a positive integer: ${value ?? "<null>"}`)
  }
  return numeric
}

const assertNonNegativeInteger = (value, label) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`${label} must be a non-negative integer: ${value ?? "<null>"}`)
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

const normalizeYearHitMetric = (value, label) => {
  const metric = toText(value || "hit_rows").toLowerCase()
  if (metric !== "hit_rows" && metric !== "unique_decision_dates") {
    throw new Error(`${label} must be one of: hit_rows, unique_decision_dates`)
  }
  return metric
}

const resolveDateKeyYear = (value, label) => {
  const dateKey = assertDateKey(value, label)
  const year = Number(dateKey.slice(0, 4))
  if (!Number.isInteger(year)) {
    throw new Error(`${label} year is missing or invalid: ${value ?? "<null>"}`)
  }
  return year
}

const compareSplit = (left, right) => {
  const leftTrainStart = toText(left?.trainDateFrom)
  const rightTrainStart = toText(right?.trainDateFrom)
  if (leftTrainStart !== rightTrainStart) return leftTrainStart.localeCompare(rightTrainStart)
  const leftOosStart = toText(left?.oosDateFrom)
  const rightOosStart = toText(right?.oosDateFrom)
  if (leftOosStart !== rightOosStart) return leftOosStart.localeCompare(rightOosStart)
  return String(left?.splitId ?? "").localeCompare(String(right?.splitId ?? ""))
}

const validateSplit = (split, index, decisionWindow) => {
  const splitId = assertNonEmpty(split?.splitId, `splits[${index}].splitId`)
  const kind = assertNonEmpty(split?.kind, `splits[${index}].kind`)
  if (
    kind !== TP12_NO_STOP_FIXED_SPLIT_KIND_SCREEN &&
    kind !== TP12_NO_STOP_FIXED_SPLIT_KIND_CONFIRM &&
    kind !== TP12_NO_STOP_FIXED_SPLIT_KIND_PROMOTION_HOLDOUT
  ) {
    throw new Error(`Unsupported fixed split kind=${kind} for splitId=${splitId}`)
  }
  const trainDateFrom = assertDateKey(split?.trainDateFrom, `splits[${index}].trainDateFrom`)
  const trainDateTo = assertDateKey(split?.trainDateTo, `splits[${index}].trainDateTo`)
  const oosDateFrom = assertDateKey(split?.oosDateFrom, `splits[${index}].oosDateFrom`)
  const oosDateTo = assertDateKey(split?.oosDateTo, `splits[${index}].oosDateTo`)
  if (trainDateFrom > trainDateTo) {
    throw new Error(`Invalid fixed train split for ${splitId}: ${trainDateFrom} > ${trainDateTo}`)
  }
  if (oosDateFrom > oosDateTo) {
    throw new Error(`Invalid fixed OOS split for ${splitId}: ${oosDateFrom} > ${oosDateTo}`)
  }
  if (!(trainDateTo < oosDateFrom)) {
    throw new Error(`Fixed train/oos overlap for ${splitId}: trainEnd=${trainDateTo} oosStart=${oosDateFrom}`)
  }
  if (trainDateFrom < decisionWindow.from || oosDateTo > decisionWindow.to) {
    throw new Error(
      `Fixed split ${splitId} escapes decisionWindow ${decisionWindow.from}:${decisionWindow.to}: ${trainDateFrom}:${oosDateTo}`,
    )
  }
  return {
    splitId,
    kind,
    trainDateFrom,
    trainDateTo,
    oosDateFrom,
    oosDateTo,
  }
}

export const loadTp12NoStopFixedResearchContract = async ({
  contractPath = DEFAULT_TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-stop fixed contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_STOP_FIXED_RESEARCH_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-stop fixed contract kind=${kind}`)
  }
  const decisionWindow = {
    from: assertDateKey(raw?.decisionWindow?.from, "decisionWindow.from"),
    to: assertDateKey(raw?.decisionWindow?.to, "decisionWindow.to"),
  }
  if (decisionWindow.from > decisionWindow.to) {
    throw new Error(`Invalid fixed decisionWindow ${decisionWindow.from}:${decisionWindow.to}`)
  }
  const inputContract = raw?.inputContract ?? {}
  const labelContract = raw?.labelContract ?? {}
  const searchContract = raw?.searchContract ?? {}
  const screenAcceptance = raw?.screenAcceptance ?? {}
  const stepALaneSet = uniqueSorted(inputContract?.stepALaneSet)
  const secondaryLabelIds = uniqueSorted(labelContract?.secondaryLabelIds)
  const targetLabelIds = uniqueSorted(labelContract?.targetLabelIds)
  const primaryLabelId = assertNonEmpty(labelContract?.primaryLabelId, "labelContract.primaryLabelId")
  if (stepALaneSet.length < 1) {
    throw new Error("inputContract.stepALaneSet is required")
  }
  if (!targetLabelIds.includes(primaryLabelId)) {
    throw new Error(`labelContract.targetLabelIds must include primaryLabelId=${primaryLabelId}`)
  }
  for (const labelId of secondaryLabelIds) {
    if (!targetLabelIds.includes(labelId)) {
      throw new Error(`secondaryLabelId must be present in targetLabelIds: ${labelId}`)
    }
  }
  const splits = (Array.isArray(raw?.splits) ? raw.splits : [])
    .map((split, index) => validateSplit(split, index, decisionWindow))
    .sort(compareSplit)
  if (splits.length < 1) {
    throw new Error("fixed contract requires at least one split")
  }
  const byId = new Map()
  for (const split of splits) {
    if (byId.has(split.splitId)) {
      throw new Error(`Duplicate fixed splitId=${split.splitId}`)
    }
    byId.set(split.splitId, split)
  }
  const screenSplits = splits.filter((split) => split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_SCREEN)
  const confirmSplits = splits.filter((split) => split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_CONFIRM)
  const holdoutSplits = splits.filter((split) => split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_PROMOTION_HOLDOUT)
  if (screenSplits.length < 1) {
    throw new Error("fixed contract requires at least one screen split")
  }
  if (confirmSplits.length > 1) {
    throw new Error(`fixed contract supports at most one confirm split, got ${confirmSplits.length}`)
  }
  if (holdoutSplits.length > 1) {
    throw new Error(`fixed contract supports at most one promotion_holdout split, got ${holdoutSplits.length}`)
  }
  return {
    kind,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    scopeId: assertNonEmpty(raw.scopeId, "contract.scopeId"),
    controlContractPath: path.resolve(
      cwd,
      assertNonEmpty(raw.controlContractPath ?? "meta/tp12_side_daily_research_contract.json", "contract.controlContractPath"),
    ),
    decisionWindow,
    yearHitMetric: normalizeYearHitMetric(raw?.yearHitMetric, "contract.yearHitMetric"),
    coreYears: uniqueSortedNumbers(raw?.coreYears),
    excludedBoundaryYears: uniqueSortedNumbers(raw?.excludedBoundaryYears),
    inputContract: {
      discoveryUniverseId: assertNonEmpty(inputContract?.discoveryUniverseId, "inputContract.discoveryUniverseId"),
      requestedLookbackTradingDays: assertNonNegativeInteger(
        inputContract?.requestedLookbackTradingDays,
        "inputContract.requestedLookbackTradingDays",
      ),
      stepALaneSet,
      allowlistPolicy: assertNonEmpty(inputContract?.allowlistPolicy, "inputContract.allowlistPolicy"),
      commonSupportPolicy: assertNonEmpty(inputContract?.commonSupportPolicy, "inputContract.commonSupportPolicy"),
    },
    labelContract: {
      targetPct: assertFiniteNumber(labelContract?.targetPct, "labelContract.targetPct"),
      stopLossPct: assertFiniteNumber(labelContract?.stopLossPct, "labelContract.stopLossPct"),
      primaryHoldDays: assertPositiveInteger(labelContract?.primaryHoldDays, "labelContract.primaryHoldDays"),
      secondaryHoldDays: assertPositiveInteger(labelContract?.secondaryHoldDays, "labelContract.secondaryHoldDays"),
      primaryLabelId,
      secondaryLabelIds,
      targetLabelIds,
    },
    searchContract: {
      configPath: path.resolve(cwd, assertNonEmpty(searchContract?.configPath, "searchContract.configPath")),
      lineId: assertNonEmpty(searchContract?.lineId, "searchContract.lineId"),
      contextSurface: assertNonEmpty(searchContract?.contextSurface, "searchContract.contextSurface"),
      splitPolicy: assertNonEmpty(searchContract?.splitPolicy, "searchContract.splitPolicy"),
      selectionMode: assertNonEmpty(searchContract?.selectionMode, "searchContract.selectionMode"),
      foldScheme: assertNonEmpty(searchContract?.foldScheme, "searchContract.foldScheme"),
      maxGapTradingDays: assertNonNegativeInteger(searchContract?.maxGapTradingDays, "searchContract.maxGapTradingDays"),
      minHitCount: assertPositiveInteger(searchContract?.minHitCount, "searchContract.minHitCount"),
      minTrainMatchedDates: assertPositiveInteger(
        searchContract?.minTrainMatchedDates,
        "searchContract.minTrainMatchedDates",
      ),
      minTrainMatchedMonths: assertPositiveInteger(
        searchContract?.minTrainMatchedMonths,
        "searchContract.minTrainMatchedMonths",
      ),
      minTrainMatchedFolds: assertPositiveInteger(
        searchContract?.minTrainMatchedFolds,
        "searchContract.minTrainMatchedFolds",
      ),
      maxRuleSize: assertPositiveInteger(searchContract?.maxRuleSize, "searchContract.maxRuleSize"),
      maxSeedTokens: assertPositiveInteger(searchContract?.maxSeedTokens, "searchContract.maxSeedTokens"),
      maxRules: assertPositiveInteger(searchContract?.maxRules, "searchContract.maxRules"),
      screenMaxSearchStates: assertPositiveInteger(
        searchContract?.screenMaxSearchStates,
        "searchContract.screenMaxSearchStates",
      ),
      finalMaxSearchStates: assertPositiveInteger(
        searchContract?.finalMaxSearchStates,
        "searchContract.finalMaxSearchStates",
      ),
      enableYearHitUpperBoundPrune: searchContract?.enableYearHitUpperBoundPrune === true,
      coreYears: uniqueSortedNumbers(searchContract?.coreYears),
      excludedBoundaryYears: uniqueSortedNumbers(searchContract?.excludedBoundaryYears),
      minTrainHitsPerCoreYear:
        searchContract?.minTrainHitsPerCoreYear === null || searchContract?.minTrainHitsPerCoreYear === undefined
          ? null
          : assertPositiveInteger(searchContract?.minTrainHitsPerCoreYear, "searchContract.minTrainHitsPerCoreYear"),
    },
    screenAcceptance: {
      minUsableScreenWindows: assertPositiveInteger(
        screenAcceptance?.minUsableScreenWindows,
        "screenAcceptance.minUsableScreenWindows",
      ),
      earlyStopIfFirstTwoWindowsHaveZeroOosSelections:
        screenAcceptance?.earlyStopIfFirstTwoWindowsHaveZeroOosSelections === true,
    },
    splits,
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}

export const resolveTp12NoStopFixedSplits = ({
  contract,
  splitGroup = "screen",
  splitIds = [],
} = {}) => {
  if (!contract || typeof contract !== "object") {
    throw new Error("contract is required")
  }
  const requestedSplitIds = uniqueSorted(splitIds)
  const safeSplits = Array.isArray(contract.splits) ? contract.splits.slice() : []
  const knownIds = new Set(safeSplits.map((split) => toText(split.splitId)))
  for (const splitId of requestedSplitIds) {
    if (!knownIds.has(splitId)) {
      throw new Error(`Requested fixed splitId is not present in contract: ${splitId}`)
    }
  }
  const normalizedGroup = toText(splitGroup || "screen").toLowerCase()
  const byGroup = safeSplits.filter((split) => {
    if (requestedSplitIds.length > 0) return requestedSplitIds.includes(split.splitId)
    if (normalizedGroup === "all") return true
    if (normalizedGroup === "screen") return split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_SCREEN
    if (normalizedGroup === "confirm") return split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_CONFIRM
    if (normalizedGroup === "holdout") return split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_PROMOTION_HOLDOUT
    throw new Error(`Unsupported fixed splitGroup=${splitGroup}`)
  })
  if (byGroup.length < 1) {
    throw new Error(`No fixed splits resolved for splitGroup=${splitGroup}`)
  }
  return byGroup.sort(compareSplit)
}

export const resolveTp12NoStopFixedSplit = ({
  contract,
  splitId,
} = {}) =>
  resolveTp12NoStopFixedSplits({
    contract,
    splitIds: [splitId],
  })[0]

export const buildTp12NoStopFixedSearchContractForSplit = ({
  fixedContract,
  split,
} = {}) => {
  if (!fixedContract || typeof fixedContract !== "object") {
    throw new Error("fixedContract is required")
  }
  if (!split || typeof split !== "object") {
    throw new Error("split is required")
  }
  const searchContract = JSON.parse(JSON.stringify(fixedContract.searchContract ?? {}))
  const baseCoreYears = uniqueSortedNumbers(
    Array.isArray(searchContract?.coreYears) && searchContract.coreYears.length > 0
      ? searchContract.coreYears
      : fixedContract.coreYears,
  )
  const baseExcludedBoundaryYears = uniqueSortedNumbers(
    Array.isArray(searchContract?.excludedBoundaryYears) && searchContract.excludedBoundaryYears.length > 0
      ? searchContract.excludedBoundaryYears
      : fixedContract.excludedBoundaryYears,
  )
  const trainStartYear = resolveDateKeyYear(split.trainDateFrom, `split ${toText(split.splitId) || "<unknown>"}.trainDateFrom`)
  const trainEndYear = resolveDateKeyYear(split.trainDateTo, `split ${toText(split.splitId) || "<unknown>"}.trainDateTo`)
  const coreYears = baseCoreYears.filter((year) => year >= trainStartYear && year <= trainEndYear)
  const excludedBoundaryYears = baseExcludedBoundaryYears.filter((year) => year >= trainStartYear && year <= trainEndYear)
  if (excludedBoundaryYears.some((year) => coreYears.includes(year))) {
    throw new Error(
      `Resolved fixed search contract has overlapping coreYears and excludedBoundaryYears for split=${toText(split.splitId) || "<unknown>"}`,
    )
  }
  if (searchContract?.minTrainHitsPerCoreYear !== null && searchContract?.minTrainHitsPerCoreYear !== undefined && coreYears.length < 1) {
    throw new Error(
      `Resolved fixed search contract has no in-range coreYears for split=${toText(split.splitId) || "<unknown>"} despite minTrainHitsPerCoreYear being set`,
    )
  }
  return {
    ...searchContract,
    coreYears,
    excludedBoundaryYears,
  }
}

export const buildTp12NoStopFixedDerivedRollingContract = ({
  fixedContract,
  splitGroup = "screen",
  splitIds = [],
  contractIdSuffix = null,
} = {}) => {
  if (!fixedContract || typeof fixedContract !== "object") {
    throw new Error("fixedContract is required")
  }
  const selectedSplits = resolveTp12NoStopFixedSplits({
    contract: fixedContract,
    splitGroup,
    splitIds,
  })
  const nonScreenSplits = selectedSplits.filter((split) => split.kind !== TP12_NO_STOP_FIXED_SPLIT_KIND_SCREEN)
  if (nonScreenSplits.length > 1) {
    throw new Error(
      `Derived rolling contract can include at most one non-screen fixed split, got ${nonScreenSplits.length}`,
    )
  }
  const normalizedSuffix = toText(contractIdSuffix)
  const windows = selectedSplits.map((split) => ({
    windowId: split.splitId,
    kind: split.kind === TP12_NO_STOP_FIXED_SPLIT_KIND_SCREEN ? "screen" : "final_confirm",
    trainDateFrom: split.trainDateFrom,
    trainDateTo: split.trainDateTo,
    oosDateFrom: split.oosDateFrom,
    oosDateTo: split.oosDateTo,
  }))
  const resolvedSearchContract =
    selectedSplits.length === 1
      ? buildTp12NoStopFixedSearchContractForSplit({
          fixedContract,
          split: selectedSplits[0],
        })
      : JSON.parse(JSON.stringify(fixedContract.searchContract ?? {}))
  return {
    kind: TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND,
    contractMode: TP12_NO_STOP_ROLLING_CONTRACT_MODE_FIXED_CARRIER,
    contractId: normalizedSuffix ? `${fixedContract.contractId}_${normalizedSuffix}` : fixedContract.contractId,
    contractPath: fixedContract.contractPath,
    updatedAt: fixedContract.updatedAt,
    scopeId: fixedContract.scopeId,
    yearHitMetric: fixedContract.yearHitMetric,
    decisionWindow: {
      from: fixedContract.decisionWindow?.from,
      to: fixedContract.decisionWindow?.to,
    },
    inputContract: JSON.parse(JSON.stringify(fixedContract.inputContract ?? {})),
    labelContract: JSON.parse(JSON.stringify(fixedContract.labelContract ?? {})),
    searchContract: resolvedSearchContract,
    screenAcceptance: JSON.parse(JSON.stringify(fixedContract.screenAcceptance ?? {})),
    windows,
    hardStops: Array.isArray(fixedContract.hardStops)
      ? fixedContract.hardStops.slice()
      : [],
    notes: [
      ...(Array.isArray(fixedContract.notes) ? fixedContract.notes.slice() : []),
      `Derived rolling carrier for fixed splitGroup=${toText(splitGroup || "screen")}`,
      `selectedSplitIds=${selectedSplits.map((split) => split.splitId).join(",")}`,
      ...(selectedSplits.length === 1
        ? [`resolvedCoreYears=${resolvedSearchContract.coreYears.join(",") || "<none>"}`]
        : []),
    ],
  }
}

export const buildTp12NoStopFixedDerivedSideDailyContract = ({
  fixedContract,
  splitId,
} = {}) => {
  const split = resolveTp12NoStopFixedSplit({
    contract: fixedContract,
    splitId,
  })
  return {
    kind: "tp12_side_daily_research_contract_v1",
    contractId: `${toText(fixedContract?.contractId)}_${toText(split.splitId)}`,
    scopeId: toText(fixedContract?.scopeId),
    updatedAt: toText(fixedContract?.updatedAt),
    decisionWindow: {
      from: split.trainDateFrom,
      to: split.oosDateTo,
    },
    control: {
      trainDateFrom: split.trainDateFrom,
      trainDateTo: split.trainDateTo,
      oosDateFrom: split.oosDateFrom,
      oosDateTo: split.oosDateTo,
      stepALaneSet: [...(fixedContract?.inputContract?.stepALaneSet ?? [])],
      targetLabelIds: [...(fixedContract?.labelContract?.targetLabelIds ?? [])],
      allowlistPolicy: toText(fixedContract?.inputContract?.allowlistPolicy),
      commonSupportPolicy: toText(fixedContract?.inputContract?.commonSupportPolicy),
    },
    comparisonOrder: ["daily_only_no_stop"],
    familyMatrix: {},
    deferExecutionLearning: true,
    hardStops: [
      "Derived fixed-split helper contract for TP12 no-stop source pack generation only.",
      ...((Array.isArray(fixedContract?.hardStops) ? fixedContract.hardStops : []).slice(0, 5)),
    ],
    notes: [
      `Derived from ${toText(fixedContract?.contractPath)}`,
      `splitId=${split.splitId}`,
      `kind=${split.kind}`,
      `scopeId=${toText(fixedContract?.scopeId)}`,
    ],
  }
}

export const writeTp12NoStopFixedDerivedSideDailyContract = async ({
  fixedContract,
  splitId,
  outPath,
} = {}) => {
  const payload = buildTp12NoStopFixedDerivedSideDailyContract({
    fixedContract,
    splitId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTp12NoStopFixedDerivedSideDailyContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
