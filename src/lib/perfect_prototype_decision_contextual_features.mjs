import {
  PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
  PREJUMP_PREDICTIVE_STRATEGY_MODE,
  assertNoPrejumpLeakageRow,
} from "./perfect_prototype_prejump_contract.mjs"

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const safeDiv = (left, right) => {
  const l = num(left)
  const r = num(right)
  if (!Number.isFinite(l) || !Number.isFinite(r) || r === 0) return null
  return l / r
}

const uniqueSortedStrings = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const sortNumericAsc = (values) =>
  (Array.isArray(values) ? values : [])
    .map((value) => num(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

const quantile = (sortedValues, q) => {
  if (!Array.isArray(sortedValues) || sortedValues.length < 1) return null
  const qq = Math.max(0, Math.min(1, Number(q) || 0))
  const idx = (sortedValues.length - 1) * qq
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedValues[lo]
  const weight = idx - lo
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight
}

const shareWhere = (values, predicate) => {
  const list = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (list.length < 1) return null
  const matched = list.filter((value) => predicate(value)).length
  return matched / list.length
}

const percentileRank = (sortedValues, value) => {
  const n = Array.isArray(sortedValues) ? sortedValues.length : 0
  const target = num(value)
  if (n < 1 || !Number.isFinite(target)) return null
  let count = 0
  while (count < n && Number(sortedValues[count]) <= target) {
    count += 1
  }
  return count / n
}

const toDateKey = (row) =>
  String(row?.dateKey ?? row?.decisionDateKey ?? row?.asOfDateKey ?? "").trim()

const toSymbol = (row) => String(row?.symbol ?? "").trim()

export const extractPerfectPrototypeDecisionContextCore = (row) => {
  const featureVec = row?.featureVec ?? {}
  const globalFeatureVec = row?.globalFeatureVec ?? {}
  return {
    dateKey: toDateKey(row),
    symbol: toSymbol(row),
    bodyPct: num(featureVec?.["candle.bodyPct"]),
    rangePct: num(featureVec?.["candle.rangePct"]),
    volumeRatio20: num(featureVec?.["volume.ratio20"]),
    valueRatio20: num(featureVec?.["volume.valueRatio20"]),
    runUp10: num(featureVec?.["trend.runUp10"]),
    closeOverMa20: num(featureVec?.["trend.closeOverMa20"]),
    closeOverMa120: num(featureVec?.["trend.closeOverMa120"]),
    ret40: num(globalFeatureVec?.["ret40"]),
  }
}

const resolveDecisionCore = (row) => extractPerfectPrototypeDecisionContextCore(row)

const buildMarketContextVec = ({ cores, uniqueSymbolCount }) => {
  const bodyValues = sortNumericAsc(cores.map((row) => row.bodyPct))
  const rangeValues = sortNumericAsc(cores.map((row) => row.rangePct))
  const volumeValues = sortNumericAsc(cores.map((row) => row.volumeRatio20))
  const valueRatioValues = sortNumericAsc(cores.map((row) => row.valueRatio20))
  const runUpValues = sortNumericAsc(cores.map((row) => row.runUp10))
  const ret40Values = sortNumericAsc(cores.map((row) => row.ret40))
  const closeOverMa20Values = sortNumericAsc(cores.map((row) => row.closeOverMa20))
  const closeOverMa120Values = sortNumericAsc(cores.map((row) => row.closeOverMa120))
  return {
    candidateCount: cores.length,
    uniqueSymbolCount,
    bodyPctMedian: quantile(bodyValues, 0.5),
    rangePctMedian: quantile(rangeValues, 0.5),
    volumeRatio20Median: quantile(volumeValues, 0.5),
    valueRatio20Median: quantile(valueRatioValues, 0.5),
    runUp10Median: quantile(runUpValues, 0.5),
    ret40Median: quantile(ret40Values, 0.5),
    positiveBodyShare: shareWhere(bodyValues, (value) => value > 0),
    wideRangeShare: shareWhere(rangeValues, (value) => value >= 0.08),
    elevatedVolumeShare: shareWhere(volumeValues, (value) => value >= 1.5),
    closeOverMa20Share: shareWhere(closeOverMa20Values, (value) => value > 0),
    closeOverMa120Share: shareWhere(closeOverMa120Values, (value) => value > 0),
  }
}

const classifyCrowding = (candidateCount) => {
  const count = Math.max(0, Math.floor(Number(candidateCount) || 0))
  if (count <= 0) return "NONE"
  if (count <= 8) return "THIN"
  if (count <= 20) return "MID"
  return "BROAD"
}

const classifyVolumeRegime = (elevatedVolumeShare) => {
  const value = num(elevatedVolumeShare)
  if (!Number.isFinite(value)) return "UNKNOWN"
  if (value >= 0.6) return "HOT"
  if (value >= 0.25) return "ACTIVE"
  return "QUIET"
}

const classifyBreadth = (positiveBodyShare) => {
  const value = num(positiveBodyShare)
  if (!Number.isFinite(value)) return "UNKNOWN"
  if (value >= 0.7) return "BROAD"
  if (value >= 0.45) return "MIXED"
  return "NARROW"
}

const classifyRankPct = (rankPct) => {
  const value = num(rankPct)
  if (!Number.isFinite(value)) return "UNKNOWN"
  if (value >= 0.9) return "TOP"
  if (value >= 0.67) return "HIGH"
  if (value >= 0.34) return "MID"
  return "LOW"
}

const classifyRelativeMove = (value, strongThreshold) => {
  const v = num(value)
  if (!Number.isFinite(v)) return "UNKNOWN"
  if (v >= Math.abs(Number(strongThreshold) || 0)) return "ABOVE"
  if (v <= -Math.abs(Number(strongThreshold) || 0)) return "BELOW"
  return "NEUTRAL"
}

export const buildPerfectPrototypeDecisionContextualTagTokens = ({
  marketContextVec,
  xsecEventVec,
}) =>
  uniqueSortedStrings([
    `tag:market.snapshotCrowding:${classifyCrowding(marketContextVec?.candidateCount)}`,
    `tag:market.snapshotBreadth:${classifyBreadth(marketContextVec?.positiveBodyShare)}`,
    `tag:market.volumeRegime:${classifyVolumeRegime(marketContextVec?.elevatedVolumeShare)}`,
    `tag:xsec.snapshotVolumeRank:${classifyRankPct(xsecEventVec?.volumeRankPct)}`,
    `tag:xsec.snapshotBodyRank:${classifyRankPct(xsecEventVec?.bodyRankPct)}`,
    `tag:xsec.snapshotRunUpRank:${classifyRankPct(xsecEventVec?.runUp10RankPct)}`,
    `tag:xsec.snapshotVolumeVsMedian:${classifyRelativeMove(xsecEventVec?.volumeVsMedian, 0.2)}`,
    `tag:xsec.snapshotRunUpVsMedian:${classifyRelativeMove(xsecEventVec?.runUp10VsMedian, 0.03)}`,
  ])

export const buildPerfectPrototypeDecisionContextReferenceMapFromGroupedCores = (grouped) => {
  const out = new Map()
  for (const [dateKey, cores] of grouped.entries()) {
    const filteredCores = cores.filter((core) =>
      [
        core.bodyPct,
        core.rangePct,
        core.volumeRatio20,
        core.valueRatio20,
        core.runUp10,
        core.closeOverMa20,
        core.closeOverMa120,
        core.ret40,
      ]
        .map((value) => num(value))
        .some(Number.isFinite),
    )
    const uniqueSymbolCount = new Set(filteredCores.map((row) => row.symbol).filter(Boolean)).size
    out.set(dateKey, {
      dateKey,
      cores: filteredCores,
      bodyValues: sortNumericAsc(filteredCores.map((row) => row.bodyPct)),
      rangeValues: sortNumericAsc(filteredCores.map((row) => row.rangePct)),
      volumeValues: sortNumericAsc(filteredCores.map((row) => row.volumeRatio20)),
      valueRatioValues: sortNumericAsc(filteredCores.map((row) => row.valueRatio20)),
      runUpValues: sortNumericAsc(filteredCores.map((row) => row.runUp10)),
      ret40Values: sortNumericAsc(filteredCores.map((row) => row.ret40)),
      marketContextVec: buildMarketContextVec({
        cores: filteredCores,
        uniqueSymbolCount,
      }),
    })
  }
  return out
}

export const buildPerfectPrototypeDecisionContextReferenceMap = (rows) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const core = resolveDecisionCore(row)
    if (!core.dateKey) continue
    const list = grouped.get(core.dateKey) ?? []
    list.push(core)
    grouped.set(core.dateKey, list)
  }
  return buildPerfectPrototypeDecisionContextReferenceMapFromGroupedCores(grouped)
}

export const resolvePerfectPrototypeDecisionContextForRow = ({
  row,
  reference,
}) => {
  const marketContextVec = reference?.marketContextVec ?? {
    candidateCount: 0,
    uniqueSymbolCount: 0,
    bodyPctMedian: null,
    rangePctMedian: null,
    volumeRatio20Median: null,
    valueRatio20Median: null,
    runUp10Median: null,
    ret40Median: null,
    positiveBodyShare: null,
    wideRangeShare: null,
    elevatedVolumeShare: null,
    closeOverMa20Share: null,
    closeOverMa120Share: null,
  }
  const core = resolveDecisionCore(row)
  const xsecEventVec = {
    bodyRankPct: percentileRank(reference?.bodyValues, core.bodyPct),
    rangeRankPct: percentileRank(reference?.rangeValues, core.rangePct),
    volumeRankPct: percentileRank(reference?.volumeValues, core.volumeRatio20),
    valueRatioRankPct: percentileRank(reference?.valueRatioValues, core.valueRatio20),
    runUp10RankPct: percentileRank(reference?.runUpValues, core.runUp10),
    ret40RankPct: percentileRank(reference?.ret40Values, core.ret40),
    bodyVsMedian:
      Number.isFinite(num(core.bodyPct)) && Number.isFinite(num(marketContextVec?.bodyPctMedian))
        ? num(core.bodyPct) - num(marketContextVec.bodyPctMedian)
        : null,
    rangeVsMedian:
      Number.isFinite(num(core.rangePct)) && Number.isFinite(num(marketContextVec?.rangePctMedian))
        ? num(core.rangePct) - num(marketContextVec.rangePctMedian)
        : null,
    volumeVsMedian:
      Number.isFinite(num(core.volumeRatio20)) && Number.isFinite(num(marketContextVec?.volumeRatio20Median))
        ? num(core.volumeRatio20) - num(marketContextVec.volumeRatio20Median)
        : null,
    valueRatioVsMedian:
      Number.isFinite(num(core.valueRatio20)) && Number.isFinite(num(marketContextVec?.valueRatio20Median))
        ? num(core.valueRatio20) - num(marketContextVec.valueRatio20Median)
        : null,
    runUp10VsMedian:
      Number.isFinite(num(core.runUp10)) && Number.isFinite(num(marketContextVec?.runUp10Median))
        ? num(core.runUp10) - num(marketContextVec.runUp10Median)
        : null,
    ret40VsMedian:
      Number.isFinite(num(core.ret40)) && Number.isFinite(num(marketContextVec?.ret40Median))
        ? num(core.ret40) - num(marketContextVec.ret40Median)
        : null,
    isolationScore:
      Number.isFinite(num(marketContextVec?.candidateCount)) && Number(marketContextVec.candidateCount) > 0
        ? safeDiv(1, marketContextVec.candidateCount)
        : null,
  }
  return {
    marketContextVec,
    xsecEventVec,
    contextualTokens: buildPerfectPrototypeDecisionContextualTagTokens({
      marketContextVec,
      xsecEventVec,
    }),
  }
}

const hasExistingDecisionContext = (row) =>
  row?.marketContextVec &&
  row?.xsecEventVec &&
  (Object.keys(row.marketContextVec).length > 0 || Object.keys(row.xsecEventVec).length > 0 || (Array.isArray(row?.contextualTokens) && row.contextualTokens.length > 0))

export const enrichPerfectPrototypeRowsWithDecisionContext = (rows, options = {}) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  const referenceRows = Array.isArray(options?.referenceRows) ? options.referenceRows : sourceRows
  const referenceMap = buildPerfectPrototypeDecisionContextReferenceMap(referenceRows)
  const preserveExisting = options?.preserveExisting === true
  return sourceRows.map((row) => {
    if (preserveExisting && hasExistingDecisionContext(row)) {
      assertNoPrejumpLeakageRow(row)
      return {
        ...(row && typeof row === "object" ? row : {}),
        contextualTokens: uniqueSortedStrings(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
      }
    }
    const dateKey = toDateKey(row)
    const resolved = resolvePerfectPrototypeDecisionContextForRow({
      row,
      reference: referenceMap.get(dateKey) ?? null,
    })
    const nextRow = {
      ...(row && typeof row === "object" ? row : {}),
      strategyMode: row?.strategyMode ?? PREJUMP_PREDICTIVE_STRATEGY_MODE,
      contextSurface: PERFECT_PROTOTYPE_PREJUMP_CONTEXTUAL_SURFACE,
      marketContextVec: resolved.marketContextVec,
      xsecEventVec: resolved.xsecEventVec,
      contextualTokens: uniqueSortedStrings([
        ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
        ...(resolved.contextualTokens ?? []),
      ]),
    }
    assertNoPrejumpLeakageRow(nextRow)
    return nextRow
  })
}
