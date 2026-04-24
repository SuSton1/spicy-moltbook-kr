import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

import { ensureDir, readJson, writeJson } from "./io.mjs"
import {
  assertDateKey,
  dateYear,
  incrementMap,
  iterateJsonlMaybeGzip,
  mapToSortedObject,
  toBool,
  toNumber,
  toText,
  validDateKey,
  writeJsonlRow,
} from "./tp12_year2hit_foundation_io.mjs"
import {
  buildTp12OperationalHitFields,
  TP12_EXECUTION_POLICY_ID,
  TP12_OPERATIONAL_HIT_DEFINITION,
} from "./tp12_operational_hit_contract.mjs"

const KNOWN_ENTRY_RULES = new Set(["NEXT_DAY_OPEN"])
const KNOWN_STOP_POLICIES = new Set(["no_stop", "target_before_stop"])
const KNOWN_SAME_BAR_POLICIES = new Set(["fail", "target_first", "stop_first"])
const KNOWN_HORIZON_BOUNDARY_POLICIES = new Set(["skip_cross_boundary", "fail_cross_boundary"])
const KNOWN_TERMINAL_FORWARD_POLICIES = new Set(["fail_invalid", "skip_terminal_incomplete_forward"])
const ENTRY_CALENDAR_POLICY = "global_next_session"

const stableId = (parts) =>
  createHash("sha256")
    .update(parts.map((part) => toText(part)).join("|"))
    .digest("hex")
    .slice(0, 16)

const assertPositiveNumber = (value, label) => {
  const numeric = toNumber(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be positive: ${value}`)
  return numeric
}

const assertNonNegativeNumber = (value, label) => {
  const numeric = toNumber(value)
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`${label} must be non-negative: ${value}`)
  return numeric
}

const parseHoldDays = (value) => {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1) throw new Error(`holdDays must be a positive integer: ${value}`)
  return numeric
}

const normalizeSymbol = (value) => toText(value).toUpperCase()

const normalizeCandleRow = (row, { lineNumber, filePath }) => {
  const symbol = normalizeSymbol(row?.symbol)
  const dateKey = toText(row?.dateKey ?? row?.tradingDateKey)
  if (!symbol) throw new Error(`missing candle symbol at ${filePath}:${lineNumber}`)
  if (!validDateKey(dateKey)) throw new Error(`invalid candle dateKey at ${filePath}:${lineNumber}: ${dateKey}`)
  const open = assertPositiveNumber(row?.open, `open at ${symbol}/${dateKey}`)
  const high = assertPositiveNumber(row?.high, `high at ${symbol}/${dateKey}`)
  const low = assertPositiveNumber(row?.low, `low at ${symbol}/${dateKey}`)
  const close = assertPositiveNumber(row?.close, `close at ${symbol}/${dateKey}`)
  const volume = assertNonNegativeNumber(row?.volume ?? 0, `volume at ${symbol}/${dateKey}`)
  if (high < low) throw new Error(`invalid candle high<low at ${symbol}/${dateKey}`)
  if (high < Math.max(open, close) || low > Math.min(open, close)) {
    throw new Error(`invalid candle OHLC envelope at ${symbol}/${dateKey}`)
  }
  return { symbol, dateKey, open, high, low, close, volume }
}

export const loadTp12CandlesBySymbol = async ({ candlePath }) => {
  const candlesBySymbol = new Map()
  await iterateJsonlMaybeGzip(candlePath, {
    strict: true,
    onRow: async (row, context) => {
      const candle = normalizeCandleRow(row, context)
      const rows = candlesBySymbol.get(candle.symbol) ?? []
      rows.push(candle)
      candlesBySymbol.set(candle.symbol, rows)
    },
  })
  for (const [symbol, rows] of candlesBySymbol.entries()) {
    rows.sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    let previousDateKey = ""
    for (const row of rows) {
      if (row.dateKey === previousDateKey) throw new Error(`duplicate candle row for ${symbol}/${row.dateKey}`)
      previousDateKey = row.dateKey
    }
  }
  return candlesBySymbol
}

const buildGlobalCalendar = (candlesBySymbol) => {
  const dates = new Set()
  for (const series of candlesBySymbol.values()) {
    for (const row of series) dates.add(row.dateKey)
  }
  const sorted = [...dates].sort()
  const nextByDate = new Map()
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    nextByDate.set(sorted[index], sorted[index + 1])
  }
  return { dates: sorted, nextByDate }
}

export const loadTp12Contract = async (contractPath) => {
  const resolvedPath = toText(contractPath)
  if (!resolvedPath) return null
  const contract = await readJson(resolvedPath, null)
  if (!contract) throw new Error(`contract file not found: ${resolvedPath}`)
  return contract
}

export const deriveTp12LabelEventOptionsFromContract = (contract = {}) => {
  const label = contract.labelEvent ?? contract.targetLabel ?? {}
  const rangeKey = toText(label.defaultRangeKey ?? label.rangeKey ?? "trainDateRange")
  const dateRange =
    rangeKey === "trainDateRange"
      ? contract.trainDateRange
      : rangeKey === "oosDateRange"
        ? contract.oosDateRange
        : rangeKey === "decisionWindow"
          ? contract.decisionWindow
          : label.decisionDateRange
  return {
    labelConfigId: label.labelConfigId,
    entryRule: label.entryRule,
    targetPct: label.targetPct,
    holdDays: label.holdDays,
    stopLossPct: label.stopLossPct,
    stopPolicy: label.stopPolicy,
    sameBarPolicy: label.sameBarPolicy,
    labelHorizonDateTo: label.labelHorizonDateTo ?? label.horizonDateTo,
    horizonBoundaryPolicy: label.horizonBoundaryPolicy,
    terminalForwardPolicy: label.terminalForwardPolicy,
    decisionDateFrom: dateRange?.from,
    decisionDateTo: dateRange?.to,
    failOnInvalidLabels: label.failOnInvalidLabels,
  }
}

const resolveLabelOptions = ({
  contract = null,
  labelConfigId,
  entryRule,
  targetPct,
  holdDays,
  stopLossPct,
  stopPolicy,
  sameBarPolicy,
  labelHorizonDateTo,
  horizonBoundaryPolicy,
  terminalForwardPolicy,
  decisionDateFrom,
  decisionDateTo,
  failOnInvalidLabels,
}) => {
  const contractOptions = contract ? deriveTp12LabelEventOptionsFromContract(contract) : {}
  const resolvedEntryRule = toText(entryRule ?? contractOptions.entryRule)
  const resolvedStopPolicy = toText(stopPolicy ?? contractOptions.stopPolicy)
  const resolvedSameBarPolicy = toText(sameBarPolicy ?? contractOptions.sameBarPolicy)
  if (!KNOWN_ENTRY_RULES.has(resolvedEntryRule)) {
    throw new Error(`unsupported or missing label entryRule: ${resolvedEntryRule || "missing"}`)
  }
  if (!KNOWN_STOP_POLICIES.has(resolvedStopPolicy)) {
    throw new Error(`unsupported or missing label stopPolicy: ${resolvedStopPolicy || "missing"}`)
  }
  if (!KNOWN_SAME_BAR_POLICIES.has(resolvedSameBarPolicy)) {
    throw new Error(`unsupported or missing label sameBarPolicy: ${resolvedSameBarPolicy || "missing"}`)
  }
  const resolvedLabelHorizonDateTo = toText(labelHorizonDateTo ?? contractOptions.labelHorizonDateTo)
  if (resolvedLabelHorizonDateTo && !validDateKey(resolvedLabelHorizonDateTo)) {
    throw new Error(`invalid labelHorizonDateTo: ${resolvedLabelHorizonDateTo}`)
  }
  const resolvedHorizonBoundaryPolicy = toText(
    horizonBoundaryPolicy ?? contractOptions.horizonBoundaryPolicy ?? (resolvedLabelHorizonDateTo ? "fail_cross_boundary" : ""),
  )
  if (resolvedHorizonBoundaryPolicy && !KNOWN_HORIZON_BOUNDARY_POLICIES.has(resolvedHorizonBoundaryPolicy)) {
    throw new Error(`unsupported label horizonBoundaryPolicy: ${resolvedHorizonBoundaryPolicy}`)
  }
  const resolvedTerminalForwardPolicy = toText(
    terminalForwardPolicy ?? contractOptions.terminalForwardPolicy ?? "fail_invalid",
  )
  if (!KNOWN_TERMINAL_FORWARD_POLICIES.has(resolvedTerminalForwardPolicy)) {
    throw new Error(`unsupported label terminalForwardPolicy: ${resolvedTerminalForwardPolicy}`)
  }
  const resolvedTargetPct = assertPositiveNumber(targetPct ?? contractOptions.targetPct, "targetPct")
  const resolvedHoldDays = parseHoldDays(holdDays ?? contractOptions.holdDays)
  const resolvedStopLossPct = assertNonNegativeNumber(stopLossPct ?? contractOptions.stopLossPct, "stopLossPct")
  if (resolvedStopPolicy === "no_stop" && resolvedStopLossPct !== 0) {
    throw new Error("stopPolicy=no_stop requires stopLossPct=0")
  }
  if (resolvedStopPolicy === "target_before_stop" && resolvedStopLossPct <= 0) {
    throw new Error("stopPolicy=target_before_stop requires stopLossPct>0")
  }
  const from = assertDateKey(decisionDateFrom ?? contractOptions.decisionDateFrom, "decisionDateFrom")
  const to = assertDateKey(decisionDateTo ?? contractOptions.decisionDateTo, "decisionDateTo")
  if (from > to) throw new Error(`invalid decision date range: ${from}..${to}`)
  const resolvedLabelConfigId = toText(labelConfigId ?? contractOptions.labelConfigId)
  if (!resolvedLabelConfigId) throw new Error("labelConfigId is required")
  return {
    labelConfigId: resolvedLabelConfigId,
    entryRule: resolvedEntryRule,
    targetPct: resolvedTargetPct,
    holdDays: resolvedHoldDays,
    stopLossPct: resolvedStopLossPct,
    stopPolicy: resolvedStopPolicy,
    sameBarPolicy: resolvedSameBarPolicy,
    labelHorizonDateTo: resolvedLabelHorizonDateTo,
    horizonBoundaryPolicy: resolvedHorizonBoundaryPolicy,
    terminalForwardPolicy: resolvedTerminalForwardPolicy,
    decisionDateFrom: from,
    decisionDateTo: to,
    failOnInvalidLabels: toBool(failOnInvalidLabels ?? contractOptions.failOnInvalidLabels, true),
  }
}

const buildGlobalForwardSchedule = ({ decisionDateKey, holdDays, globalNextByDate }) => {
  const forwardDateKeys = []
  let cursor = decisionDateKey
  for (let offset = 0; offset < holdDays; offset += 1) {
    const next = globalNextByDate.get(cursor)
    if (!next) {
      return {
        missingForward: true,
        reason: offset === 0 ? "missing_global_next_session" : "insufficient_global_forward_sessions",
        forwardDateKeys,
        missingAfterDateKey: cursor,
      }
    }
    forwardDateKeys.push(next)
    cursor = next
  }
  return { missingForward: false, forwardDateKeys }
}

const checkTerminalForwardAvailability = ({ series, decisionIndex, options, globalNextByDate }) => {
  const decision = series[decisionIndex]
  const schedule = buildGlobalForwardSchedule({
    decisionDateKey: decision.dateKey,
    holdDays: options.holdDays,
    globalNextByDate,
  })
  if (schedule.missingForward) return schedule
  for (let offset = 0; offset < schedule.forwardDateKeys.length; offset += 1) {
    const expectedDateKey = schedule.forwardDateKeys[offset]
    const row = series[decisionIndex + 1 + offset]
    if (!row) {
      return {
        missingForward: true,
        reason: offset === 0 ? "missing_entry_bar" : "insufficient_forward_bars",
        expectedDateKey,
        forwardDateKeys: schedule.forwardDateKeys,
      }
    }
    if (row.dateKey !== expectedDateKey) {
      return {
        missingForward: true,
        reason: offset === 0 ? "entry_not_global_next_session" : "forward_not_global_next_session",
        expectedDateKey,
        observedDateKey: row.dateKey,
        forwardDateKeys: schedule.forwardDateKeys,
      }
    }
  }
  return { missingForward: false, forwardDateKeys: schedule.forwardDateKeys }
}

const checkForwardHorizonBoundary = ({ options, forwardDateKeys }) => {
  if (!options.labelHorizonDateTo) return { crossesBoundary: false }
  const entryDateKey = forwardDateKeys?.[0] ?? null
  const lastForwardDateKey = forwardDateKeys?.[forwardDateKeys.length - 1] ?? null
  if (!lastForwardDateKey) return { crossesBoundary: false }
  if (lastForwardDateKey <= options.labelHorizonDateTo) return { crossesBoundary: false }
  return {
    crossesBoundary: true,
    reason: "forward_horizon_crosses_label_boundary",
    entryDateKey,
    lastForwardDateKey,
    labelHorizonDateTo: options.labelHorizonDateTo,
  }
}

const summarizeLabelRow = ({ row, yearlyStats }) => {
  const year = String(dateYear(row.decisionDateKey))
  const stats = yearlyStats.get(year) ?? {
    decisionRowCount: 0,
    hitRowCount: 0,
    operationalHitRowCount: 0,
    entryExecutableRowCount: 0,
    invalidRowCount: 0,
  }
  stats.decisionRowCount += 1
  if (row.hitTarget) stats.hitRowCount += 1
  if (row.entryExecutable) stats.entryExecutableRowCount += 1
  if (row.operationalHitTarget) stats.operationalHitRowCount += 1
  if (row.labelStatus !== "valid") stats.invalidRowCount += 1
  yearlyStats.set(year, stats)
}

const buildInvalidLabelRow = ({ candle, reason, options, details = {} }) => ({
  kind: "tp12_label_event_v1",
  labelConfigId: options.labelConfigId,
  eventId: `tp12evt_${stableId([options.labelConfigId, candle.symbol, candle.dateKey])}`,
  symbol: candle.symbol,
  decisionDateKey: candle.dateKey,
  asOfFeatureDateKey: candle.dateKey,
  entryRule: options.entryRule,
  targetPct: options.targetPct,
  holdDays: options.holdDays,
  stopLossPct: options.stopLossPct,
  stopPolicy: options.stopPolicy,
  sameBarPolicy: options.sameBarPolicy,
  hitTarget: false,
  chartHitTarget: false,
  hitDefinition: TP12_OPERATIONAL_HIT_DEFINITION,
  executionPolicyId: TP12_EXECUTION_POLICY_ID,
  entryExecutable: false,
  operationalHitTarget: false,
  executableHitTarget: false,
  operationalMissReasons: [`invalid_label:${reason}`],
  operationalMissReason: `invalid_label:${reason}`,
  labelStatus: "invalid",
  invalidReason: reason,
  ...details,
})

const resolveSameBarAmbiguity = ({ policy }) => {
  if (policy === "target_first") return "target"
  if (policy === "stop_first") return "stop"
  throw new Error("same-bar target/stop ambiguity encountered; set sameBarPolicy explicitly if this label is intended")
}

const buildValidLabelRow = ({ series, decisionIndex, options, terminalForwardCheck }) => {
  const decision = series[decisionIndex]
  if (terminalForwardCheck?.missingForward) {
    return buildInvalidLabelRow({
      candle: decision,
      reason: terminalForwardCheck.reason,
      options,
      details: {
        expectedDateKey: terminalForwardCheck.expectedDateKey ?? null,
        observedDateKey: terminalForwardCheck.observedDateKey ?? null,
        expectedForwardDateKeys: terminalForwardCheck.forwardDateKeys ?? [],
      },
    })
  }
  const entryIndex = decisionIndex + 1
  const lastForwardIndex = decisionIndex + options.holdDays
  if (entryIndex >= series.length) {
    return buildInvalidLabelRow({ candle: decision, reason: "missing_entry_bar", options })
  }
  if (lastForwardIndex >= series.length) {
    return buildInvalidLabelRow({ candle: decision, reason: "insufficient_forward_bars", options })
  }
  const entry = series[entryIndex]
  const expectedEntryDateKey = terminalForwardCheck?.forwardDateKeys?.[0] ?? null
  if (expectedEntryDateKey && entry.dateKey !== expectedEntryDateKey) {
    return buildInvalidLabelRow({
      candle: decision,
      reason: "entry_not_global_next_session",
      options,
      details: {
        expectedDateKey: expectedEntryDateKey,
        observedDateKey: entry.dateKey,
        expectedForwardDateKeys: terminalForwardCheck.forwardDateKeys,
      },
    })
  }
  const entryPrice = entry.open
  const targetPrice = entryPrice * (1 + options.targetPct)
  const stopPrice = options.stopLossPct > 0 ? entryPrice * (1 - options.stopLossPct) : null
  let hitDateKey = null
  let stopDateKey = null
  let targetBeforeStop = false
  let stopBeforeTarget = false
  let sameBarAmbiguous = false
  let maxForwardHighPct = -Infinity
  let minForwardLowPct = Infinity
  for (let index = entryIndex; index <= lastForwardIndex; index += 1) {
    const row = series[index]
    const highPct = row.high / entryPrice - 1
    const lowPct = row.low / entryPrice - 1
    maxForwardHighPct = Math.max(maxForwardHighPct, highPct)
    minForwardLowPct = Math.min(minForwardLowPct, lowPct)
    const targetTouched = row.high >= targetPrice
    const stopTouched = stopPrice !== null && row.low <= stopPrice
    if (targetTouched && stopTouched && !hitDateKey && !stopDateKey) {
      sameBarAmbiguous = true
      const resolved = resolveSameBarAmbiguity({ policy: options.sameBarPolicy })
      if (resolved === "target") {
        hitDateKey = row.dateKey
        targetBeforeStop = true
      } else {
        stopDateKey = row.dateKey
        stopBeforeTarget = true
      }
      break
    }
    if (targetTouched && !hitDateKey && !stopDateKey) {
      hitDateKey = row.dateKey
      targetBeforeStop = true
      break
    }
    if (stopTouched && !hitDateKey && !stopDateKey) {
      stopDateKey = row.dateKey
      stopBeforeTarget = true
      if (options.stopPolicy === "target_before_stop") break
    }
  }
  const noStopHit = hitDateKey !== null
  const hitTarget = options.stopPolicy === "no_stop" ? noStopHit : targetBeforeStop
  const operational = buildTp12OperationalHitFields({
    chartHitTarget: hitTarget,
    decisionClose: decision.close,
    entryOpen: entry.open,
    entryVolume: entry.volume,
    entryDateKey: entry.dateKey,
  })
  return {
    kind: "tp12_label_event_v1",
    labelConfigId: options.labelConfigId,
    eventId: `tp12evt_${stableId([options.labelConfigId, decision.symbol, decision.dateKey])}`,
    symbol: decision.symbol,
    decisionDateKey: decision.dateKey,
    asOfFeatureDateKey: decision.dateKey,
    entryRule: options.entryRule,
    entryDateKey: entry.dateKey,
    entryPrice,
    targetPct: options.targetPct,
    targetPrice,
    holdDays: options.holdDays,
    stopLossPct: options.stopLossPct,
    stopPrice,
    stopPolicy: options.stopPolicy,
    sameBarPolicy: options.sameBarPolicy,
    hitTarget,
    ...operational,
    hitDateKey,
    stopHit: stopDateKey !== null,
    stopDateKey,
    targetBeforeStop,
    stopBeforeTarget,
    sameBarAmbiguous,
    maxForwardReturn: maxForwardHighPct,
    maxForwardHighPct,
    minForwardReturn: minForwardLowPct,
    minForwardLowPct,
    maxForwardDrawdown: Math.min(0, minForwardLowPct),
    availableForwardBars: options.holdDays,
    labelStatus: "valid",
    invalidReason: null,
  }
}

export const buildTp12LabelEvents = async ({
  candlePath,
  contractPath = null,
  outEventsPath,
  outSummaryPath,
  ...labelOptions
} = {}) => {
  if (!toText(candlePath)) throw new Error("candlePath is required")
  if (!toText(outEventsPath)) throw new Error("outEventsPath is required")
  const contract = await loadTp12Contract(contractPath)
  const options = resolveLabelOptions({ contract, ...labelOptions })
  const candlesBySymbol = await loadTp12CandlesBySymbol({ candlePath })
  const globalCalendar = buildGlobalCalendar(candlesBySymbol)
  await ensureDir(path.dirname(outEventsPath))
  const stream = fs.createWriteStream(outEventsPath, { encoding: "utf8" })
  const yearlyStats = new Map()
  const invalidReasonCounts = new Map()
  let inputSymbolCount = candlesBySymbol.size
  let candidateDecisionRowCount = 0
  let decisionRowCount = 0
  let outputRowCount = 0
  let validLabelCount = 0
  let hitRowCount = 0
  let entryExecutableRowCount = 0
  let operationalHitRowCount = 0
  let nonExecutableChartHitRowCount = 0
  let invalidLabelCount = 0
  let horizonSkippedRowCount = 0
  let terminalForwardSkippedRowCount = 0
  const horizonSkipReasonCounts = new Map()
  const terminalForwardSkipReasonCounts = new Map()
  try {
    for (const [, series] of [...candlesBySymbol.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (let index = 0; index < series.length; index += 1) {
        const candle = series[index]
        if (candle.dateKey < options.decisionDateFrom || candle.dateKey > options.decisionDateTo) continue
        candidateDecisionRowCount += 1
        const terminalForwardCheck = checkTerminalForwardAvailability({
          series,
          decisionIndex: index,
          options,
          globalNextByDate: globalCalendar.nextByDate,
        })
        if (terminalForwardCheck.missingForward && options.terminalForwardPolicy === "skip_terminal_incomplete_forward") {
          terminalForwardSkippedRowCount += 1
          incrementMap(terminalForwardSkipReasonCounts, terminalForwardCheck.reason)
          continue
        }
        const horizonCheck = checkForwardHorizonBoundary({
          options,
          forwardDateKeys: terminalForwardCheck.forwardDateKeys ?? [],
        })
        if (horizonCheck.crossesBoundary) {
          if (options.horizonBoundaryPolicy === "skip_cross_boundary") {
            horizonSkippedRowCount += 1
            incrementMap(horizonSkipReasonCounts, horizonCheck.reason)
            continue
          }
          throw new Error(
            [
              `${horizonCheck.reason} at ${candle.symbol}/${candle.dateKey}`,
              `entryDateKey=${horizonCheck.entryDateKey}`,
              `lastForwardDateKey=${horizonCheck.lastForwardDateKey}`,
              `labelHorizonDateTo=${horizonCheck.labelHorizonDateTo}`,
            ].join(" "),
          )
        }
        decisionRowCount += 1
        const row = buildValidLabelRow({ series, decisionIndex: index, options, terminalForwardCheck })
        outputRowCount += 1
        if (row.labelStatus === "valid") {
          validLabelCount += 1
          if (row.hitTarget) hitRowCount += 1
          if (row.entryExecutable) entryExecutableRowCount += 1
          if (row.operationalHitTarget) operationalHitRowCount += 1
          if (row.hitTarget && !row.entryExecutable) nonExecutableChartHitRowCount += 1
        } else {
          invalidLabelCount += 1
          incrementMap(invalidReasonCounts, row.invalidReason)
        }
        summarizeLabelRow({ row, yearlyStats })
        await writeJsonlRow(stream, row)
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.once("error", reject)
      stream.end(() => {
        stream.removeListener("error", reject)
        resolve()
      })
    })
  }
  const failures = []
  if (options.failOnInvalidLabels && invalidLabelCount > 0) failures.push(`invalid_labels:${invalidLabelCount}`)
  if (validLabelCount < 1) failures.push("zero_valid_labels")
  const summary = {
    kind: "tp12_label_event_build_summary_v1",
    generatedAt: new Date().toISOString(),
    status: failures.length > 0 ? "failed" : "passed",
    candlePath: path.resolve(candlePath),
    outEventsPath: path.resolve(outEventsPath),
    labelConfig: {
      labelConfigId: options.labelConfigId,
      entryRule: options.entryRule,
      targetPct: options.targetPct,
      holdDays: options.holdDays,
      stopLossPct: options.stopLossPct,
      stopPolicy: options.stopPolicy,
      sameBarPolicy: options.sameBarPolicy,
      labelHorizonDateTo: options.labelHorizonDateTo || null,
      horizonBoundaryPolicy: options.horizonBoundaryPolicy || null,
      terminalForwardPolicy: options.terminalForwardPolicy,
      entryCalendarPolicy: ENTRY_CALENDAR_POLICY,
      decisionDateRange: {
        from: options.decisionDateFrom,
        to: options.decisionDateTo,
      },
    },
    globalCalendarDateCount: globalCalendar.dates.length,
    inputSymbolCount,
    candidateDecisionRowCount,
    horizonSkippedRowCount,
    horizonSkipReasonCounts: mapToSortedObject(horizonSkipReasonCounts),
    terminalForwardSkippedRowCount,
    terminalForwardSkipReasonCounts: mapToSortedObject(terminalForwardSkipReasonCounts),
    decisionRowCount,
    outputRowCount,
    validLabelCount,
    hitRowCount,
    chartHitRowCount: hitRowCount,
    entryExecutableRowCount,
    operationalHitRowCount,
    nonExecutableChartHitRowCount,
    rowHitRate: validLabelCount > 0 ? hitRowCount / validLabelCount : 0,
    operationalHitRate: validLabelCount > 0 ? operationalHitRowCount / validLabelCount : 0,
    invalidLabelCount,
    invalidReasonCounts: mapToSortedObject(invalidReasonCounts),
    yearStats: Object.fromEntries(
      [...yearlyStats.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, stats]) => [
          year,
          {
            ...stats,
            rowHitRate: stats.decisionRowCount > 0 ? stats.hitRowCount / stats.decisionRowCount : 0,
          },
        ]),
    ),
    failures,
  }
  if (outSummaryPath) await writeJson(outSummaryPath, summary)
  if (failures.length > 0) throw new Error(`tp12 label event build failed: ${failures.join("; ")}`)
  return summary
}
