import path from "node:path"

import { normalizeDateKey } from "./date.mjs"
import { readJson, writeJson } from "./io.mjs"
import {
  buildTp12NoStopRollingWindowSlug,
  normalizeTp12NoStopRollingWindowId,
  selectTp12NoStopRollingWindows,
  sortTp12NoStopRollingWindows,
  TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM,
  TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN,
} from "./tp12_no_stop_rolling_windows.mjs"

export const TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND = "tp12_no_stop_rolling_research_contract_v1"
export const DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH = "meta/tp12_no_stop_rolling_research_contract.json"
export const TP12_NO_STOP_ROLLING_CONTRACT_MODE_STANDARD = "standard_v1"
export const TP12_NO_STOP_ROLLING_CONTRACT_MODE_FIXED_CARRIER = "carrier_fixed_window_v1"

const toText = (value) => String(value ?? "").trim()

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
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

const validateWindow = (window, index, decisionWindow) => {
  const windowId = assertNonEmpty(window?.windowId, `windows[${index}].windowId`)
  const kind = assertNonEmpty(window?.kind, `windows[${index}].kind`)
  if (kind !== TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN && kind !== TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM) {
    throw new Error(`Unsupported rolling window kind=${kind} for windowId=${windowId}`)
  }
  const trainDateFrom = assertDateKey(window?.trainDateFrom, `windows[${index}].trainDateFrom`)
  const trainDateTo = assertDateKey(window?.trainDateTo, `windows[${index}].trainDateTo`)
  const oosDateFrom = assertDateKey(window?.oosDateFrom, `windows[${index}].oosDateFrom`)
  const oosDateTo = assertDateKey(window?.oosDateTo, `windows[${index}].oosDateTo`)
  if (trainDateFrom > trainDateTo) {
    throw new Error(`Invalid rolling train window for ${windowId}: ${trainDateFrom} > ${trainDateTo}`)
  }
  if (oosDateFrom > oosDateTo) {
    throw new Error(`Invalid rolling OOS window for ${windowId}: ${oosDateFrom} > ${oosDateTo}`)
  }
  if (!(trainDateTo < oosDateFrom)) {
    throw new Error(`Rolling train/oos overlap for ${windowId}: trainEnd=${trainDateTo} oosStart=${oosDateFrom}`)
  }
  if (trainDateFrom < decisionWindow.from || oosDateTo > decisionWindow.to) {
    throw new Error(
      `Rolling window ${windowId} escapes decisionWindow ${decisionWindow.from}:${decisionWindow.to}: ` +
        `${trainDateFrom}:${oosDateTo}`,
    )
  }
  return {
    windowId,
    kind,
    trainDateFrom,
    trainDateTo,
    oosDateFrom,
    oosDateTo,
    ordinal: index,
  }
}

export const loadTp12NoStopRollingResearchContract = async ({
  contractPath = DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH,
  cwd = process.cwd(),
} = {}) => {
  const resolvedContractPath = path.resolve(cwd, toText(contractPath) || DEFAULT_TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_PATH)
  const raw = await readJson(resolvedContractPath, null)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Missing TP12 no-stop rolling contract: ${resolvedContractPath}`)
  }
  const kind = assertNonEmpty(raw.kind, "contract.kind")
  if (kind !== TP12_NO_STOP_ROLLING_RESEARCH_CONTRACT_KIND) {
    throw new Error(`Unsupported TP12 no-stop rolling contract kind=${kind}`)
  }
  const contractMode = toText(raw?.contractMode || TP12_NO_STOP_ROLLING_CONTRACT_MODE_STANDARD)
  if (
    contractMode !== TP12_NO_STOP_ROLLING_CONTRACT_MODE_STANDARD &&
    contractMode !== TP12_NO_STOP_ROLLING_CONTRACT_MODE_FIXED_CARRIER
  ) {
    throw new Error(`Unsupported TP12 no-stop rolling contract mode=${contractMode}`)
  }
  const decisionWindow = {
    from: assertDateKey(raw?.decisionWindow?.from, "decisionWindow.from"),
    to: assertDateKey(raw?.decisionWindow?.to, "decisionWindow.to"),
  }
  if (decisionWindow.from > decisionWindow.to) {
    throw new Error(`Invalid rolling decisionWindow ${decisionWindow.from}:${decisionWindow.to}`)
  }
  const inputContract = raw?.inputContract ?? {}
  const labelContract = raw?.labelContract ?? {}
  const searchContract = raw?.searchContract ?? {}
  const coreYears = uniqueSortedNumbers(searchContract?.coreYears)
  const excludedBoundaryYears = uniqueSortedNumbers(searchContract?.excludedBoundaryYears)
  const enableYearHitUpperBoundPrune = searchContract?.enableYearHitUpperBoundPrune === true
  const minTrainHitsPerCoreYear =
    searchContract?.minTrainHitsPerCoreYear === null || searchContract?.minTrainHitsPerCoreYear === undefined
      ? null
      : assertPositiveInteger(searchContract?.minTrainHitsPerCoreYear, "searchContract.minTrainHitsPerCoreYear")
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
  const windows = sortTp12NoStopRollingWindows(
    (Array.isArray(raw?.windows) ? raw.windows : []).map((window, index) => validateWindow(window, index, decisionWindow)),
  )
  const byId = new Map()
  for (const window of windows) {
    const normalizedId = normalizeTp12NoStopRollingWindowId(window.windowId)
    if (byId.has(normalizedId)) {
      throw new Error(`Duplicate rolling windowId=${window.windowId}`)
    }
    byId.set(normalizedId, window)
  }
  const screenWindows = windows.filter((window) => window.kind === TP12_NO_STOP_ROLLING_WINDOW_KIND_SCREEN)
  const finalWindows = windows.filter((window) => window.kind === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM)
  if (contractMode === TP12_NO_STOP_ROLLING_CONTRACT_MODE_STANDARD) {
    if (windows.length < 2) {
      throw new Error("rolling contract requires at least one screen window and one final confirm window")
    }
    if (screenWindows.length < 1) {
      throw new Error("rolling contract requires at least one screen window")
    }
    if (finalWindows.length !== 1) {
      throw new Error(`rolling contract requires exactly one final_confirm window, got ${finalWindows.length}`)
    }
  } else {
    if (windows.length < 1) {
      throw new Error("carrier rolling contract requires at least one window")
    }
    if (finalWindows.length > 1) {
      throw new Error(`carrier rolling contract supports at most one final_confirm window, got ${finalWindows.length}`)
    }
    if (screenWindows.length < 1 && finalWindows.length < 1) {
      throw new Error("carrier rolling contract requires at least one screen or final_confirm window")
    }
  }
  if (enableYearHitUpperBoundPrune) {
    if (coreYears.length < 1) {
      throw new Error("searchContract.coreYears is required when enableYearHitUpperBoundPrune=true")
    }
    if (!Number.isInteger(minTrainHitsPerCoreYear) || minTrainHitsPerCoreYear < 1) {
      throw new Error(
        "searchContract.minTrainHitsPerCoreYear must be a positive integer when enableYearHitUpperBoundPrune=true",
      )
    }
    if (excludedBoundaryYears.some((year) => coreYears.includes(year))) {
      throw new Error("searchContract.excludedBoundaryYears must not overlap searchContract.coreYears")
    }
  }
  return {
    kind,
    contractMode,
    contractId: assertNonEmpty(raw.contractId, "contract.contractId"),
    contractPath: resolvedContractPath,
    updatedAt: assertNonEmpty(raw.updatedAt, "contract.updatedAt"),
    scopeId: assertNonEmpty(raw.scopeId, "contract.scopeId"),
    yearHitMetric: normalizeYearHitMetric(raw?.yearHitMetric, "contract.yearHitMetric"),
    decisionWindow,
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
      maxGapTradingDays: assertPositiveInteger(searchContract?.maxGapTradingDays, "searchContract.maxGapTradingDays"),
      minHitCount: assertPositiveInteger(searchContract?.minHitCount, "searchContract.minHitCount"),
      minTrainMatchedDates: assertPositiveInteger(searchContract?.minTrainMatchedDates, "searchContract.minTrainMatchedDates"),
      minTrainMatchedMonths: assertPositiveInteger(searchContract?.minTrainMatchedMonths, "searchContract.minTrainMatchedMonths"),
      minTrainMatchedFolds: assertPositiveInteger(searchContract?.minTrainMatchedFolds, "searchContract.minTrainMatchedFolds"),
      maxRuleSize: assertPositiveInteger(searchContract?.maxRuleSize, "searchContract.maxRuleSize"),
      maxSeedTokens: assertPositiveInteger(searchContract?.maxSeedTokens, "searchContract.maxSeedTokens"),
      maxRules: assertPositiveInteger(searchContract?.maxRules, "searchContract.maxRules"),
      screenMaxSearchStates: assertPositiveInteger(searchContract?.screenMaxSearchStates, "searchContract.screenMaxSearchStates"),
      finalMaxSearchStates: assertPositiveInteger(searchContract?.finalMaxSearchStates, "searchContract.finalMaxSearchStates"),
      enableYearHitUpperBoundPrune,
      coreYears,
      excludedBoundaryYears,
      minTrainHitsPerCoreYear,
    },
    screenAcceptance: {
      minUsableScreenWindows: assertPositiveInteger(
        raw?.screenAcceptance?.minUsableScreenWindows,
        "screenAcceptance.minUsableScreenWindows",
      ),
      earlyStopIfFirstTwoWindowsHaveZeroOosSelections:
        raw?.screenAcceptance?.earlyStopIfFirstTwoWindowsHaveZeroOosSelections === true,
    },
    windows,
    screenWindowIds: screenWindows.map((window) => window.windowId),
    finalConfirmWindowId: finalWindows[0]?.windowId ?? null,
    hardStops: Array.isArray(raw?.hardStops) ? raw.hardStops.map((value) => toText(value)).filter(Boolean) : [],
    notes: Array.isArray(raw?.notes) ? raw.notes.map((value) => toText(value)).filter(Boolean) : [],
  }
}

export const resolveTp12NoStopRollingWindow = ({ contract, windowId } = {}) => {
  const safeContract = contract ?? {}
  const windows = Array.isArray(safeContract?.windows) ? safeContract.windows : []
  const normalizedId = normalizeTp12NoStopRollingWindowId(windowId)
  const window = windows.find((entry) => normalizeTp12NoStopRollingWindowId(entry?.windowId) === normalizedId)
  if (!window) {
    throw new Error(`Unknown rolling windowId=${windowId}`)
  }
  return window
}

export const resolveTp12NoStopRollingWindows = ({ contract, windowGroup = "all", windowIds = [] } = {}) =>
  selectTp12NoStopRollingWindows({
    windows: Array.isArray(contract?.windows) ? contract.windows : [],
    windowGroup,
    windowIds,
  })

export const resolveTp12NoStopRollingSearchBudget = ({ contract, window } = {}) => {
  if (toText(window?.kind) === TP12_NO_STOP_ROLLING_WINDOW_KIND_FINAL_CONFIRM) {
    return Number(contract?.searchContract?.finalMaxSearchStates)
  }
  return Number(contract?.searchContract?.screenMaxSearchStates)
}

export const buildTp12NoStopRollingDerivedSideDailyContract = ({ rollingContract, windowId } = {}) => {
  const window = resolveTp12NoStopRollingWindow({ contract: rollingContract, windowId })
  return {
    kind: "tp12_side_daily_research_contract_v1",
    contractId: `${toText(rollingContract?.contractId)}_${buildTp12NoStopRollingWindowSlug(window.windowId)}`,
    scopeId: toText(rollingContract?.scopeId),
    updatedAt: toText(rollingContract?.updatedAt),
    decisionWindow: {
      from: window.trainDateFrom,
      to: window.oosDateTo,
    },
    control: {
      trainDateFrom: window.trainDateFrom,
      trainDateTo: window.trainDateTo,
      oosDateFrom: window.oosDateFrom,
      oosDateTo: window.oosDateTo,
      stepALaneSet: [...(rollingContract?.inputContract?.stepALaneSet ?? [])],
      targetLabelIds: [...(rollingContract?.labelContract?.targetLabelIds ?? [])],
      allowlistPolicy: toText(rollingContract?.inputContract?.allowlistPolicy),
      commonSupportPolicy: toText(rollingContract?.inputContract?.commonSupportPolicy),
    },
    comparisonOrder: ["daily_only_no_stop"],
    familyMatrix: {},
    deferExecutionLearning: true,
    hardStops: [
      "Derived rolling-window helper contract for TP12 no-stop source pack generation only.",
      ...((Array.isArray(rollingContract?.hardStops) ? rollingContract.hardStops : []).slice(0, 5)),
    ],
    notes: [
      `Derived from ${toText(rollingContract?.contractPath)}`,
      `windowId=${window.windowId}`,
      `kind=${window.kind}`,
      `scopeId=${toText(rollingContract?.scopeId)}`,
    ],
  }
}

export const writeTp12NoStopRollingDerivedSideDailyContract = async ({
  rollingContract,
  windowId,
  outPath,
} = {}) => {
  const payload = buildTp12NoStopRollingDerivedSideDailyContract({
    rollingContract,
    windowId,
  })
  const resolvedOutPath = path.resolve(outPath ?? "")
  if (!resolvedOutPath) {
    throw new Error("outPath is required for writeTp12NoStopRollingDerivedSideDailyContract")
  }
  await writeJson(resolvedOutPath, payload)
  return {
    outPath: resolvedOutPath,
    contract: payload,
  }
}
