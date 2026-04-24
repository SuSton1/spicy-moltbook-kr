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
  String(row?.dateKey ?? row?.eventDate ?? row?.decisionDateKey ?? "").trim()

const toSymbol = (row) => String(row?.symbol ?? "").trim()

const resolveEventValue = (row, featureKey, rawKey) => {
  const direct = num(row?.[rawKey])
  if (Number.isFinite(direct)) return direct
  const featureValue = num(row?.eventFeatureVec?.[featureKey])
  if (Number.isFinite(featureValue)) return featureValue
  const metaValue = num(row?.eventMeta?.[rawKey])
  if (Number.isFinite(metaValue)) return metaValue
  return null
}

const resolveEventCore = (row) => ({
  dateKey: toDateKey(row),
  symbol: toSymbol(row),
  jumpPct: resolveEventValue(row, "jumpPct", "jumpPct"),
  jumpPctFromPrevClose: resolveEventValue(row, "jumpPctFromPrevClose", "jumpPctFromPrevClose"),
  jumpPctFromOpen: resolveEventValue(row, "jumpPctFromOpen", "jumpPctFromOpen"),
  closeRetPct: resolveEventValue(row, "closeRetPct", "closeRetPct"),
  gapOpenPct: resolveEventValue(row, "gapOpenPct", "gapOpenPct"),
})

const buildMarketContextVec = ({ cores, uniqueSymbolCount }) => {
  const jumpValues = sortNumericAsc(cores.map((row) => row.jumpPct))
  const closeValues = sortNumericAsc(cores.map((row) => row.closeRetPct))
  const gapValues = sortNumericAsc(cores.map((row) => row.gapOpenPct))
  const absGapValues = sortNumericAsc(gapValues.map((value) => Math.abs(value)))
  return {
    eventCount: cores.length,
    uniqueSymbolCount,
    jumpMedian: quantile(jumpValues, 0.5),
    jumpP75: quantile(jumpValues, 0.75),
    jumpP90: quantile(jumpValues, 0.9),
    closeMedian: quantile(closeValues, 0.5),
    closeP75: quantile(closeValues, 0.75),
    gapMedian: quantile(gapValues, 0.5),
    absGapMedian: quantile(absGapValues, 0.5),
    positiveCloseShare: shareWhere(closeValues, (value) => value > 0),
    strongCloseShare: shareWhere(closeValues, (value) => value >= 0.04),
    gapUpShare: shareWhere(gapValues, (value) => value > 0),
    wideGapShare: shareWhere(absGapValues, (value) => value >= 0.03),
  }
}

export const PERFECT_PROTOTYPE_CONTEXTUAL_SURFACE = "v3_contextual"
export const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_SURFACE = "v3_contextual_plus_lite"
export const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_TP12_SURFACE = "v7_contextual_plus_lite_tp12"
export const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE =
  "v4_contextual_plus_lite_lane_local"
export const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE =
  "v5_contextual_plus_lite_lane_local_pool8"
export const PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE =
  "v6_contextual_plus_lite_recent_only_lane_local_pool8"

export const PERFECT_PROTOTYPE_LANE_LOCAL_THIN_POOL_MIN_COUNT = 8

export const isPerfectPrototypeLaneLocalContextSurface = (surfaceName) => {
  const normalizedSurfaceName = String(surfaceName ?? "").trim().toLowerCase()
  return (
    normalizedSurfaceName === PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_SURFACE ||
    normalizedSurfaceName === PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE ||
    normalizedSurfaceName === PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE
  )
}

export const isPerfectPrototypeLaneLocalFailFastSurface = (surfaceName) =>
  [
    PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_LANE_LOCAL_POOL8_SURFACE,
    PERFECT_PROTOTYPE_CONTEXTUAL_PLUS_LITE_RECENT_ONLY_LANE_LOCAL_POOL8_SURFACE,
  ].includes(String(surfaceName ?? "").trim().toLowerCase())

const buildLaneReferenceKey = (dateKey, stepALaneId) => {
  const normalizedDateKey = String(dateKey ?? "").trim()
  const normalizedStepALaneId = String(stepALaneId ?? "").trim()
  if (!normalizedDateKey || !normalizedStepALaneId) return null
  return `${normalizedDateKey}::${normalizedStepALaneId}`
}

export const buildPerfectPrototypeContextReferenceMap = (rows) => {
  const grouped = new Map()
  const laneGrouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const core = resolveEventCore(row)
    if (!core.dateKey) continue
    const list = grouped.get(core.dateKey) ?? []
    list.push(core)
    grouped.set(core.dateKey, list)
    const laneKey = buildLaneReferenceKey(core.dateKey, row?.stepALaneId)
    if (!laneKey) continue
    const laneList = laneGrouped.get(laneKey) ?? []
    laneList.push(core)
    laneGrouped.set(laneKey, laneList)
  }
  const out = new Map()
  for (const [dateKey, cores] of grouped.entries()) {
    const filteredCores = cores.filter(
      (core) =>
        core.symbol &&
        [core.jumpPct, core.jumpPctFromPrevClose, core.jumpPctFromOpen, core.closeRetPct, core.gapOpenPct]
          .map((value) => num(value))
          .some(Number.isFinite),
    )
    const uniqueSymbolCount = new Set(filteredCores.map((row) => row.symbol).filter(Boolean)).size
    const jumpValues = sortNumericAsc(filteredCores.map((row) => row.jumpPct))
    const closeValues = sortNumericAsc(filteredCores.map((row) => row.closeRetPct))
    const gapValues = sortNumericAsc(filteredCores.map((row) => row.gapOpenPct))
    const absGapValues = sortNumericAsc(gapValues.map((value) => Math.abs(value)))
    out.set(dateKey, {
      dateKey,
      cores: filteredCores,
      jumpValues,
      closeValues,
      gapValues,
      absGapValues,
      marketContextVec: buildMarketContextVec({
        cores: filteredCores,
        uniqueSymbolCount,
      }),
      laneReferencesByLaneId: new Map(),
    })
  }
  for (const [laneKey, cores] of laneGrouped.entries()) {
    const [dateKey = "", stepALaneId = ""] = String(laneKey).split("::")
    const reference = out.get(dateKey)
    if (!reference || !stepALaneId) continue
    const filteredCores = cores.filter(
      (core) =>
        core.symbol &&
        [core.jumpPct, core.jumpPctFromPrevClose, core.jumpPctFromOpen, core.closeRetPct, core.gapOpenPct]
          .map((value) => num(value))
          .some(Number.isFinite),
    )
    const jumpValues = sortNumericAsc(filteredCores.map((row) => row.jumpPct))
    const closeValues = sortNumericAsc(filteredCores.map((row) => row.closeRetPct))
    const gapValues = sortNumericAsc(filteredCores.map((row) => row.gapOpenPct))
    const absGapValues = sortNumericAsc(gapValues.map((value) => Math.abs(value)))
    reference.laneReferencesByLaneId.set(stepALaneId, {
      dateKey,
      stepALaneId,
      eventCount: filteredCores.length,
      jumpValues,
      closeValues,
      gapValues,
      absGapValues,
    })
  }
  return out
}

const classifyCrowding = (eventCount) => {
  const count = Math.max(0, Math.floor(Number(eventCount) || 0))
  if (count <= 0) return "NONE"
  if (count <= 2) return "SOLO"
  if (count <= 6) return "LOW"
  if (count <= 15) return "MID"
  return "HIGH"
}

const classifyJumpRegime = (jumpP90) => {
  const value = num(jumpP90)
  if (!Number.isFinite(value)) return "UNKNOWN"
  if (value >= 0.18) return "EXTREME"
  if (value >= 0.14) return "HOT"
  if (value >= 0.1) return "ACTIVE"
  return "QUIET"
}

const classifyBreadth = (positiveCloseShare) => {
  const value = num(positiveCloseShare)
  if (!Number.isFinite(value)) return "UNKNOWN"
  if (value >= 0.75) return "BROAD"
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

export const buildPerfectPrototypeContextualTagTokens = ({
  marketContextVec,
  xsecEventVec,
  surfaceName = null,
  stepALaneId = null,
}) => {
  const normalizedSurfaceName = String(surfaceName ?? "").trim().toLowerCase()
  const isLaneLocalSurface = isPerfectPrototypeLaneLocalContextSurface(normalizedSurfaceName)
  return uniqueSortedStrings([
      `tag:market.crowding:${classifyCrowding(marketContextVec?.eventCount)}`,
      `tag:market.jumpRegime:${classifyJumpRegime(marketContextVec?.jumpP90)}`,
      `tag:market.closeBreadth:${classifyBreadth(marketContextVec?.positiveCloseShare)}`,
      `tag:xsec.jumpRank:${classifyRankPct(xsecEventVec?.jumpRankPct)}`,
      `tag:xsec.closeRank:${classifyRankPct(xsecEventVec?.closeRankPct)}`,
      `tag:xsec.gapRank:${classifyRankPct(xsecEventVec?.absGapRankPct)}`,
      `tag:xsec.jumpVsMedian:${classifyRelativeMove(xsecEventVec?.jumpVsMedian, 0.02)}`,
      `tag:xsec.closeVsMedian:${classifyRelativeMove(xsecEventVec?.closeVsMedian, 0.02)}`,
    ...(isLaneLocalSurface
      ? [
          `tag:stepa.lane:${String(stepALaneId ?? "").trim() || "UNKNOWN"}`,
          `tag:xsecLane.pool:${
            Number.isFinite(num(xsecEventVec?.laneEventCount))
              ? Number(xsecEventVec.laneEventCount) < PERFECT_PROTOTYPE_LANE_LOCAL_THIN_POOL_MIN_COUNT
                ? "THIN_POOL"
                : "STABLE_POOL"
              : "UNKNOWN"
          }`,
          `tag:xsecLane.jumpRank:${
            Number.isFinite(num(xsecEventVec?.laneJumpRankPct))
              ? classifyRankPct(xsecEventVec?.laneJumpRankPct)
              : Number.isFinite(num(xsecEventVec?.laneEventCount)) &&
                Number(xsecEventVec.laneEventCount) < PERFECT_PROTOTYPE_LANE_LOCAL_THIN_POOL_MIN_COUNT
              ? "THIN_POOL"
              : "UNKNOWN"
          }`,
          `tag:xsecLane.closeRank:${
            Number.isFinite(num(xsecEventVec?.laneCloseRankPct))
              ? classifyRankPct(xsecEventVec?.laneCloseRankPct)
              : Number.isFinite(num(xsecEventVec?.laneEventCount)) &&
                Number(xsecEventVec.laneEventCount) < PERFECT_PROTOTYPE_LANE_LOCAL_THIN_POOL_MIN_COUNT
              ? "THIN_POOL"
              : "UNKNOWN"
          }`,
        ]
      : []),
  ])
}

export const resolvePerfectPrototypeContextForRow = ({
  row,
  reference,
  surfaceName = null,
}) => {
  const marketContextVec = reference?.marketContextVec ?? {
    eventCount: 0,
    uniqueSymbolCount: 0,
    jumpMedian: null,
    jumpP75: null,
    jumpP90: null,
    closeMedian: null,
    closeP75: null,
    gapMedian: null,
    absGapMedian: null,
    positiveCloseShare: null,
    strongCloseShare: null,
    gapUpShare: null,
    wideGapShare: null,
  }
  const core = resolveEventCore(row)
  const normalizedSurfaceName = String(surfaceName ?? "").trim().toLowerCase()
  const normalizedStepALaneId = String(row?.stepALaneId ?? "").trim()
  const isLaneLocalSurface = isPerfectPrototypeLaneLocalContextSurface(normalizedSurfaceName)
  const isFailFastLaneLocalSurface = isPerfectPrototypeLaneLocalFailFastSurface(normalizedSurfaceName)
  if (isFailFastLaneLocalSurface && !normalizedStepALaneId) {
    throw new Error(
      `Lane-local contextual surface requires stepALaneId: surface=${normalizedSurfaceName} dateKey=${core.dateKey || "unknown"} symbol=${core.symbol || "unknown"}`,
    )
  }
  const laneReference =
    isLaneLocalSurface && normalizedStepALaneId ? reference?.laneReferencesByLaneId?.get(normalizedStepALaneId) ?? null : null
  if (isFailFastLaneLocalSurface && !laneReference) {
    throw new Error(
      `Lane-local contextual surface missing lane reference: surface=${normalizedSurfaceName} dateKey=${core.dateKey || "unknown"} lane=${normalizedStepALaneId || "unknown"} symbol=${core.symbol || "unknown"}`,
    )
  }
  const laneEventCount = Number(laneReference?.eventCount ?? 0)
  if (isFailFastLaneLocalSurface && (!Number.isFinite(laneEventCount) || laneEventCount < 1)) {
    throw new Error(
      `Lane-local contextual surface requires positive laneEventCount: surface=${normalizedSurfaceName} dateKey=${core.dateKey || "unknown"} lane=${normalizedStepALaneId || "unknown"} symbol=${core.symbol || "unknown"}`,
    )
  }
  const laneThinPool =
    Number.isFinite(laneEventCount) &&
    laneEventCount > 0 &&
    laneEventCount < PERFECT_PROTOTYPE_LANE_LOCAL_THIN_POOL_MIN_COUNT
  const xsecEventVec = {
    jumpRankPct: percentileRank(reference?.jumpValues, core.jumpPct),
    closeRankPct: percentileRank(reference?.closeValues, core.closeRetPct),
    gapRankPct: percentileRank(reference?.gapValues, core.gapOpenPct),
    absGapRankPct: percentileRank(reference?.absGapValues, Math.abs(num(core.gapOpenPct) ?? 0)),
    jumpVsMedian:
      Number.isFinite(num(core.jumpPct)) && Number.isFinite(num(marketContextVec?.jumpMedian))
        ? num(core.jumpPct) - num(marketContextVec.jumpMedian)
        : null,
    closeVsMedian:
      Number.isFinite(num(core.closeRetPct)) && Number.isFinite(num(marketContextVec?.closeMedian))
        ? num(core.closeRetPct) - num(marketContextVec.closeMedian)
        : null,
    gapVsMedian:
      Number.isFinite(num(core.gapOpenPct)) && Number.isFinite(num(marketContextVec?.gapMedian))
        ? num(core.gapOpenPct) - num(marketContextVec.gapMedian)
        : null,
    jumpVsP90:
      Number.isFinite(num(core.jumpPct)) && Number.isFinite(num(marketContextVec?.jumpP90))
        ? num(core.jumpPct) - num(marketContextVec.jumpP90)
        : null,
    closeVsP75:
      Number.isFinite(num(core.closeRetPct)) && Number.isFinite(num(marketContextVec?.closeP75))
        ? num(core.closeRetPct) - num(marketContextVec.closeP75)
        : null,
    isolationScore:
      Number.isFinite(num(marketContextVec?.eventCount)) && Number(marketContextVec.eventCount) > 0
        ? safeDiv(1, marketContextVec.eventCount)
        : null,
    laneEventCount: isLaneLocalSurface ? laneEventCount || null : null,
    laneJumpRankPct: isLaneLocalSurface && !laneThinPool ? percentileRank(laneReference?.jumpValues, core.jumpPct) : null,
    laneCloseRankPct:
      isLaneLocalSurface && !laneThinPool ? percentileRank(laneReference?.closeValues, core.closeRetPct) : null,
  }
  return {
    marketContextVec,
    xsecEventVec,
    contextualTokens: buildPerfectPrototypeContextualTagTokens({
      marketContextVec,
      xsecEventVec,
      surfaceName: normalizedSurfaceName,
      stepALaneId: normalizedStepALaneId,
    }),
  }
}

export const enrichPerfectPrototypeRowsWithContext = (rows, options = {}) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  const referenceRows = Array.isArray(options?.referenceRows) ? options.referenceRows : sourceRows
  const referenceMap = buildPerfectPrototypeContextReferenceMap(referenceRows)
  const preserveExisting = options?.preserveExisting === true
  const replaceExistingContextualTokens = options?.replaceExistingContextualTokens === true
  const normalizedSurfaceName = String(options?.surfaceName ?? "").trim().toLowerCase() || null
  return sourceRows.map((row) => {
    const dateKey = toDateKey(row)
    const resolved = resolvePerfectPrototypeContextForRow({
      row,
      reference: referenceMap.get(dateKey) ?? null,
      surfaceName: normalizedSurfaceName,
    })
    const existingContextualTokens = Array.isArray(row?.contextualTokens) ? row.contextualTokens : []
    return {
      ...(row && typeof row === "object" ? row : {}),
      marketContextVec:
        preserveExisting && row?.marketContextVec && Object.keys(row.marketContextVec).length > 0
          ? row.marketContextVec
          : resolved.marketContextVec,
      xsecEventVec:
        preserveExisting && row?.xsecEventVec && Object.keys(row.xsecEventVec).length > 0
          ? row.xsecEventVec
          : resolved.xsecEventVec,
      contextualTokens: replaceExistingContextualTokens
        ? uniqueSortedStrings(resolved.contextualTokens ?? [])
        : uniqueSortedStrings([
            ...existingContextualTokens,
            ...(resolved.contextualTokens ?? []),
          ]),
    }
  })
}
