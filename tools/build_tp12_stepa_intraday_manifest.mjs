import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { compareDateKey, normalizeDateKey } from "../src/lib/date.mjs"
import { ensureDir, iterateJsonl, pathExists, readJson, writeJson, writeJsonl } from "../src/lib/io.mjs"

const TAIL_POLICY_REQUIRE_FULL_WINDOW = "require_full_window"
const TAIL_POLICY_ALLOW_PARTIAL = "allow_partial"

const toText = (value) => String(value ?? "").trim()

const toNumber = (value, fallback = null) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const uniqueSortedStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  )

const parseCsv = (value) => uniqueSortedStrings(String(value ?? "").split(","))

const buildAllowlistPairKey = ({ symbol, decisionDateKey }) => `${decisionDateKey}::${symbol}`

const buildAllowlistExactKey = ({ symbol, decisionDateKey, stepALaneId }) =>
  `${decisionDateKey}::${symbol}::${stepALaneId}`

const resolveTailPolicy = (value) => {
  const policy = toText(value || TAIL_POLICY_REQUIRE_FULL_WINDOW).toLowerCase()
  if (policy === TAIL_POLICY_REQUIRE_FULL_WINDOW || policy === TAIL_POLICY_ALLOW_PARTIAL) return policy
  throw new Error(
    `Unsupported --tail-policy=${value}. Expected ${TAIL_POLICY_REQUIRE_FULL_WINDOW} or ${TAIL_POLICY_ALLOW_PARTIAL}`,
  )
}

const resolveSourcePaths = ({ cwd, runDir, eventsPath, summaryPath }) => {
  const normalizedRunDir = toText(runDir)
  if (normalizedRunDir) {
    const resolvedRunDir = path.resolve(cwd, normalizedRunDir)
    return {
      runDir: resolvedRunDir,
      eventsPath: path.join(resolvedRunDir, "step-a", "events_high8_lite.jsonl"),
      summaryPath: path.join(resolvedRunDir, "step-a", "step_a_summary.json"),
      runId: path.basename(resolvedRunDir),
    }
  }
  const resolvedEventsPath = path.resolve(cwd, toText(eventsPath))
  const resolvedSummaryPath = path.resolve(cwd, toText(summaryPath))
  const resolvedRunDir = path.dirname(path.dirname(resolvedEventsPath))
  return {
    runDir: resolvedRunDir,
    eventsPath: resolvedEventsPath,
    summaryPath: resolvedSummaryPath,
    runId: path.basename(resolvedRunDir),
  }
}

const resolveArgs = (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const cli = parseCliArgs(argv)
  const flags = cli.flags ?? {}
  const runDir = getFlag(flags, "run-dir", null)
  const eventsPath = getFlag(flags, "events-path", null)
  const summaryPath = getFlag(flags, "summary-path", null)
  if (!toText(runDir) && (!toText(eventsPath) || !toText(summaryPath))) {
    throw new Error("build_tp12_stepa_intraday_manifest requires --run-dir or both --events-path and --summary-path")
  }
  const sources = resolveSourcePaths({ cwd, runDir, eventsPath, summaryPath })
  const outText = toText(getFlag(flags, "out", null))
  if (!outText) {
    throw new Error("build_tp12_stepa_intraday_manifest requires --out")
  }
  const outPath = path.resolve(cwd, outText)
  const summaryOutPath = path.resolve(
    cwd,
    toText(getFlag(flags, "summary-out", path.join(path.dirname(outPath), "manifest_summary.json"))),
  )
  const candlePath = path.resolve(cwd, toText(getFlag(flags, "candle-path", "data/candle_daily.jsonl")))
  const allowlistPath = toText(getFlag(flags, "allowlist-path", ""))
  const decisionFrom = normalizeDateKey(getFlag(flags, "decision-from", null))
  const decisionTo = normalizeDateKey(getFlag(flags, "decision-to", null))
  const allowedLanes = parseCsv(getFlag(flags, "allowed-lanes", ""))
  const tailPolicy = resolveTailPolicy(getFlag(flags, "tail-policy", TAIL_POLICY_REQUIRE_FULL_WINDOW))
  return {
    cwd,
    outPath,
    summaryOutPath,
    candlePath,
    allowlistPath: allowlistPath ? path.resolve(cwd, allowlistPath) : null,
    decisionFrom,
    decisionTo,
    allowedLanes,
    tailPolicy,
    ...sources,
  }
}

const collectSymbolTradingDatesFromCandles = async (candlePath, requiredSymbols = []) => {
  if (!pathExists(candlePath)) {
    throw new Error(`Minute manifest candle path not found: ${candlePath}`)
  }
  const requiredSymbolSet = new Set((Array.isArray(requiredSymbols) ? requiredSymbols : []).map((value) => toText(value)).filter(Boolean))
  const limitToRequiredSymbols = requiredSymbolSet.size > 0
  const symbolDateSets = new Map()
  await iterateJsonl(candlePath, {
    strict: true,
    onRow: async (row) => {
      const symbol = toText(row?.symbol)
      const dateKey = normalizeDateKey(row?.dateKey ?? row?.tradingDateKey)
      if (!symbol || !dateKey) return
      if (limitToRequiredSymbols && !requiredSymbolSet.has(symbol)) return
      let dateSet = symbolDateSets.get(symbol)
      if (!dateSet) {
        dateSet = new Set()
        symbolDateSets.set(symbol, dateSet)
      }
      dateSet.add(dateKey)
    },
  })
  const symbolTradingDates = new Map()
  const symbolTradingDateIndexByKey = new Map()
  for (const [symbol, dateSet] of symbolDateSets.entries()) {
    const tradingDates = Array.from(dateSet).sort(compareDateKey)
    symbolTradingDates.set(symbol, tradingDates)
    symbolTradingDateIndexByKey.set(symbol, new Map(tradingDates.map((dateKey, index) => [String(dateKey), index])))
  }
  if (limitToRequiredSymbols) {
    const missingSymbols = Array.from(requiredSymbolSet).filter((symbol) => !symbolTradingDates.has(symbol))
    if (missingSymbols.length > 0) {
      throw new Error(`Minute manifest candle path missing required symbols: ${missingSymbols.slice(0, 10).join(", ")}`)
    }
  }
  return {
    symbolTradingDates,
    symbolTradingDateIndexByKey,
  }
}

const readAndValidateSummary = async (summaryPath) => {
  if (!pathExists(summaryPath)) {
    throw new Error(`Step A summary path not found: ${summaryPath}`)
  }
  const summary = await readJson(summaryPath, null)
  const eventLabel = toText(summary?.eventLabel)
  const highJumpMode = toText(summary?.highJumpMode)
  const highJumpThreshold = toNumber(summary?.highJumpThreshold, null)
  const recentImpulseLookbackTradingDays = Math.trunc(
    toNumber(summary?.recentImpulseDiscovery?.lookbackTradingDays, 0) ?? 0,
  )
  if (!eventLabel) {
    throw new Error(`Step A summary missing eventLabel: ${summaryPath}`)
  }
  if (!highJumpMode) {
    throw new Error(`Step A summary missing highJumpMode: ${summaryPath}`)
  }
  if (!Number.isFinite(highJumpThreshold)) {
    throw new Error(`Step A summary missing highJumpThreshold: ${summaryPath}`)
  }
  if (!Number.isInteger(recentImpulseLookbackTradingDays) || recentImpulseLookbackTradingDays < 0) {
    throw new Error(`Step A summary missing valid recentImpulseDiscovery.lookbackTradingDays: ${summaryPath}`)
  }
  return {
    eventLabel,
    highJumpMode,
    highJumpThreshold,
    recentImpulseLookbackTradingDays,
  }
}

const normalizeEventRow = (row) => {
  const symbol = toText(row?.symbol)
  const decisionDateKey = normalizeDateKey(row?.dateKey)
  const prevDateKey = normalizeDateKey(row?.prevDateKey)
  const asOfDateKey = normalizeDateKey(row?.asOfDateKey ?? row?.prevDateKey)
  const stepALaneId = toText(row?.stepALaneId)
  const impulseSourceDateKey = normalizeDateKey(row?.impulseSourceDateKey)
  const impulseLookbackDays = Math.trunc(toNumber(row?.impulseLookbackDays, NaN))
  if (!symbol || !decisionDateKey || !prevDateKey || !asOfDateKey || !stepALaneId || !impulseSourceDateKey) {
    throw new Error(`Malformed Step A event row for symbol=${symbol || "unknown"} date=${row?.dateKey ?? "null"}`)
  }
  if (!Number.isInteger(impulseLookbackDays) || impulseLookbackDays < 0) {
    throw new Error(`Malformed Step A impulseLookbackDays for ${symbol}:${decisionDateKey}`)
  }
  return {
    symbol,
    decisionDateKey,
    prevDateKey,
    asOfDateKey,
    stepALaneId,
    impulseSourceDateKey,
    impulseLookbackDays,
  }
}

const normalizeAllowlistRow = (row) => {
  const symbol = toText(row?.symbol)
  const decisionDateKey = normalizeDateKey(row?.decisionDateKey ?? row?.dateKey)
  const stepALaneId = toText(row?.stepALaneId) || null
  const sourceType = toText(row?.sourceType) || null
  if (!symbol || !decisionDateKey) {
    throw new Error(
      `Malformed intraday allowlist row for symbol=${symbol || "unknown"} decisionDateKey=${row?.decisionDateKey ?? row?.dateKey ?? "null"}`,
    )
  }
  return {
    symbol,
    decisionDateKey,
    stepALaneId,
    sourceType,
  }
}

const readAllowlistContract = async (allowlistPath) => {
  if (!allowlistPath) return null
  if (!pathExists(allowlistPath)) {
    throw new Error(`Intraday allowlist path not found: ${allowlistPath}`)
  }
  const pairRows = new Map()
  const exactRows = new Map()
  const laneCounts = new Map()
  const sourceTypeCounts = new Map()
  let inputRowCount = 0
  await iterateJsonl(allowlistPath, {
    strict: true,
    onRow: async (row) => {
      inputRowCount += 1
      const normalized = normalizeAllowlistRow(row)
      if (normalized.stepALaneId) {
        const exactKey = buildAllowlistExactKey(normalized)
        if (!exactRows.has(exactKey)) {
          exactRows.set(exactKey, normalized)
        }
        laneCounts.set(normalized.stepALaneId, Number(laneCounts.get(normalized.stepALaneId) ?? 0) + 1)
      } else {
        const pairKey = buildAllowlistPairKey(normalized)
        if (!pairRows.has(pairKey)) {
          pairRows.set(pairKey, normalized)
        }
      }
      if (normalized.sourceType) {
        sourceTypeCounts.set(normalized.sourceType, Number(sourceTypeCounts.get(normalized.sourceType) ?? 0) + 1)
      }
    },
  })
  const uniqueRowCount = pairRows.size + exactRows.size
  if (uniqueRowCount < 1) {
    throw new Error(`Intraday allowlist produced zero usable rows: ${allowlistPath}`)
  }
  return {
    allowlistPath,
    inputRowCount,
    uniqueRowCount,
    pairRows,
    exactRows,
    laneCounts: Object.fromEntries(Array.from(laneCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
    sourceTypeCounts: Object.fromEntries(
      Array.from(sourceTypeCounts.entries()).sort((left, right) => left[0].localeCompare(right[0])),
    ),
  }
}

const matchAllowlistKey = (allowlistContract, eventRow) => {
  if (!allowlistContract) return null
  const exactKey = buildAllowlistExactKey(eventRow)
  if (allowlistContract.exactRows.has(exactKey)) return exactKey
  const pairKey = buildAllowlistPairKey(eventRow)
  if (allowlistContract.pairRows.has(pairKey)) return pairKey
  return null
}

const buildWindowDateKeys = ({
  symbol,
  decisionDateKey,
  prevDateKey,
  symbolTradingDates,
  symbolTradingDateIndexByKey,
  tailPolicy,
}) => {
  const tradingDates = symbolTradingDates.get(symbol)
  const tradingDateIndexByKey = symbolTradingDateIndexByKey.get(symbol)
  if (!Array.isArray(tradingDates) || !tradingDateIndexByKey) {
    throw new Error(`Symbol-local trading calendar is missing for ${symbol}`)
  }
  const decisionIndex = tradingDateIndexByKey.get(decisionDateKey)
  const prevIndex = tradingDateIndexByKey.get(prevDateKey)
  if (!Number.isInteger(decisionIndex)) {
    throw new Error(`Decision date ${decisionDateKey} is not present in ${symbol} candle trading dates`)
  }
  if (!Number.isInteger(prevIndex)) {
    throw new Error(`Prev date ${prevDateKey} is not present in ${symbol} candle trading dates`)
  }
  if (prevIndex !== decisionIndex - 1) {
    throw new Error(`Prev date contract mismatch for symbol=${symbol} decision=${decisionDateKey}: prev=${prevDateKey}`)
  }
  const requestedIndexes = [decisionIndex - 1, decisionIndex, decisionIndex + 1, decisionIndex + 2, decisionIndex + 3, decisionIndex + 4]
  const missingIndexes = requestedIndexes.filter((index) => index < 0 || index >= tradingDates.length)
  if (missingIndexes.length > 0 && tailPolicy === TAIL_POLICY_REQUIRE_FULL_WINDOW) {
    throw new Error(`Incomplete D-1..D+4 window for symbol=${symbol} decision=${decisionDateKey}`)
  }
  return requestedIndexes
    .filter((index) => index >= 0 && index < tradingDates.length)
    .map((index) => tradingDates[index])
}

export const buildTp12StepAIntradayManifest = async ({
  cwd = process.cwd(),
  runDir = null,
  eventsPath = null,
  summaryPath = null,
  candlePath = path.resolve(cwd, "data/candle_daily.jsonl"),
  allowlistPath = null,
  outPath,
  summaryOutPath = null,
  decisionFrom = null,
  decisionTo = null,
  allowedLanes = [],
  tailPolicy = TAIL_POLICY_REQUIRE_FULL_WINDOW,
} = {}) => {
  const resolved = resolveArgs(
    [
      ...(runDir ? [`--run-dir=${runDir}`] : []),
      ...(eventsPath ? [`--events-path=${eventsPath}`] : []),
      ...(summaryPath ? [`--summary-path=${summaryPath}`] : []),
      `--out=${outPath}`,
      `--summary-out=${summaryOutPath ?? path.join(path.dirname(outPath), "manifest_summary.json")}`,
      `--candle-path=${candlePath}`,
      ...(allowlistPath ? [`--allowlist-path=${allowlistPath}`] : []),
      ...(decisionFrom ? [`--decision-from=${decisionFrom}`] : []),
      ...(decisionTo ? [`--decision-to=${decisionTo}`] : []),
      ...(allowedLanes.length > 0 ? [`--allowed-lanes=${allowedLanes.join(",")}`] : []),
      `--tail-policy=${tailPolicy}`,
    ],
    { cwd },
  )
  const summaryMeta = await readAndValidateSummary(resolved.summaryPath)
  const allowlistContract = await readAllowlistContract(resolved.allowlistPath)
  if (!pathExists(resolved.eventsPath)) {
    throw new Error(`Step A events path not found: ${resolved.eventsPath}`)
  }

  const allowedLaneSet = resolved.allowedLanes.length > 0 ? new Set(resolved.allowedLanes) : null
  const filteredEventRows = []
  const manifestRows = []
  const laneCounts = new Map()
  let skippedByDecisionRange = 0
  let skippedByLane = 0
  let skippedByAllowlist = 0
  const matchedAllowlistKeys = new Set()
  const requiredSymbols = new Set()

  await iterateJsonl(resolved.eventsPath, {
    strict: true,
    onRow: async (row) => {
      const normalized = normalizeEventRow(row)
      if (resolved.decisionFrom && normalized.decisionDateKey < resolved.decisionFrom) {
        skippedByDecisionRange += 1
        return
      }
      if (resolved.decisionTo && normalized.decisionDateKey > resolved.decisionTo) {
        skippedByDecisionRange += 1
        return
      }
      if (allowedLaneSet && !allowedLaneSet.has(normalized.stepALaneId)) {
        skippedByLane += 1
        return
      }
      const allowlistMatchKey = matchAllowlistKey(allowlistContract, normalized)
      if (allowlistContract && !allowlistMatchKey) {
        skippedByAllowlist += 1
        return
      }
      if (allowlistMatchKey) {
        matchedAllowlistKeys.add(allowlistMatchKey)
      }
      filteredEventRows.push(normalized)
      requiredSymbols.add(normalized.symbol)
    },
  })

  if (filteredEventRows.length < 1) {
    throw new Error(`No Step A intraday manifest rows produced from ${resolved.eventsPath}`)
  }
  if (allowlistContract) {
    const unmatchedAllowlistKeys = [
      ...Array.from(allowlistContract.exactRows.keys()),
      ...Array.from(allowlistContract.pairRows.keys()),
    ].filter((key) => !matchedAllowlistKeys.has(key))
    if (unmatchedAllowlistKeys.length > 0) {
      const sample = unmatchedAllowlistKeys.slice(0, 5).join(", ")
      throw new Error(
        `Intraday allowlist rows missing from Step A source: unmatched=${unmatchedAllowlistKeys.length} sample=${sample}`,
      )
    }
  }
  const { symbolTradingDates, symbolTradingDateIndexByKey } = await collectSymbolTradingDatesFromCandles(
    resolved.candlePath,
    Array.from(requiredSymbols),
  )
  for (const normalized of filteredEventRows) {
    const windowDateKeys = buildWindowDateKeys({
      symbol: normalized.symbol,
      decisionDateKey: normalized.decisionDateKey,
      prevDateKey: normalized.prevDateKey,
      symbolTradingDates,
      symbolTradingDateIndexByKey,
      tailPolicy: resolved.tailPolicy,
    })
    if (windowDateKeys.length < 2) {
      throw new Error(`Window date keys too short for ${normalized.symbol}:${normalized.decisionDateKey}`)
    }
    const manifestRow = {
      requestId: `${normalized.decisionDateKey}::${normalized.symbol}::${normalized.stepALaneId}`,
      symbol: normalized.symbol,
      decisionDateKey: normalized.decisionDateKey,
      prevDateKey: normalized.prevDateKey,
      asOfDateKey: normalized.asOfDateKey,
      stepALaneId: normalized.stepALaneId,
      impulseSourceDateKey: normalized.impulseSourceDateKey,
      impulseLookbackDays: normalized.impulseLookbackDays,
      eventLabel: summaryMeta.eventLabel,
      highJumpThreshold: summaryMeta.highJumpThreshold,
      highJumpMode: summaryMeta.highJumpMode,
      recentImpulseLookbackTradingDays: summaryMeta.recentImpulseLookbackTradingDays,
      windowStartDateKey: windowDateKeys[0],
      windowEndDateKey: windowDateKeys[windowDateKeys.length - 1],
      windowDateKeys,
      sourceEventsPath: resolved.eventsPath,
      sourceSummaryPath: resolved.summaryPath,
      runId: resolved.runId,
    }
    manifestRows.push(manifestRow)
    laneCounts.set(manifestRow.stepALaneId, Number(laneCounts.get(manifestRow.stepALaneId) ?? 0) + 1)
  }

  manifestRows.sort((left, right) => {
    const dateCmp = left.decisionDateKey.localeCompare(right.decisionDateKey)
    if (dateCmp !== 0) return dateCmp
    const symbolCmp = left.symbol.localeCompare(right.symbol)
    if (symbolCmp !== 0) return symbolCmp
    return left.stepALaneId.localeCompare(right.stepALaneId)
  })

  const summary = {
    status: "ok",
    runId: resolved.runId,
    sourceRunDir: resolved.runDir,
    sourceEventsPath: resolved.eventsPath,
    sourceSummaryPath: resolved.summaryPath,
    candlePath: resolved.candlePath,
    allowlistPath: resolved.allowlistPath,
    outPath: resolved.outPath,
    tailPolicy: resolved.tailPolicy,
    rowCount: manifestRows.length,
    decisionDateFrom: manifestRows[0]?.decisionDateKey ?? null,
    decisionDateTo: manifestRows[manifestRows.length - 1]?.decisionDateKey ?? null,
    laneCounts: Object.fromEntries(Array.from(laneCounts.entries()).sort((left, right) => left[0].localeCompare(right[0]))),
    skippedByDecisionRange,
    skippedByLane,
    skippedByAllowlist,
    allowlistRowCount: allowlistContract?.uniqueRowCount ?? 0,
    allowlistMatchedRowCount: matchedAllowlistKeys.size,
    allowlistLaneCounts: allowlistContract?.laneCounts ?? {},
    allowlistSourceTypeCounts: allowlistContract?.sourceTypeCounts ?? {},
    windowSpec: "D-1..D+4",
    eventLabel: summaryMeta.eventLabel,
    highJumpThreshold: summaryMeta.highJumpThreshold,
    highJumpMode: summaryMeta.highJumpMode,
    recentImpulseLookbackTradingDays: summaryMeta.recentImpulseLookbackTradingDays,
  }

  await ensureDir(path.dirname(resolved.outPath))
  await writeJsonl(resolved.outPath, manifestRows)
  await writeJson(resolved.summaryOutPath, summary)

  return {
    outPath: resolved.outPath,
    summaryOutPath: resolved.summaryOutPath,
    rows: manifestRows,
    summary,
  }
}

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const args = resolveArgs(argv, { cwd })
  const result = await buildTp12StepAIntradayManifest({
    cwd: args.cwd,
    runDir: args.runDir,
    eventsPath: args.eventsPath,
    summaryPath: args.summaryPath,
    candlePath: args.candlePath,
    allowlistPath: args.allowlistPath,
    outPath: args.outPath,
    summaryOutPath: args.summaryOutPath,
    decisionFrom: args.decisionFrom,
    decisionTo: args.decisionTo,
    allowedLanes: args.allowedLanes,
    tailPolicy: args.tailPolicy,
  })
  console.log(
    JSON.stringify(
      {
        outPath: result.outPath,
        summaryOutPath: result.summaryOutPath,
        rowCount: result.summary.rowCount,
        decisionDateFrom: result.summary.decisionDateFrom,
        decisionDateTo: result.summary.decisionDateTo,
        laneCounts: result.summary.laneCounts,
        allowlistRowCount: result.summary.allowlistRowCount,
        allowlistMatchedRowCount: result.summary.allowlistMatchedRowCount,
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
