import {
  buildPerfectPrototypeRecentOnlyFamilyScopeSpec,
  buildPerfectPrototypeRuleFamilyRootTokens,
} from "./perfect_prototype_rule_family_spec.mjs"

const EPISODE_TOKEN_PREFIX = "sig:episode:"

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const uniqueStrings = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const buildRowKey = (row) =>
  toText(row?.rowKey) ??
  toText(row?.sourceId) ??
  [toText(row?.symbol) ?? "?", toText(row?.dateKey) ?? "?", toText(row?.targetDateKey) ?? "?"].join("::")

const cloneTokenSet = (row) =>
  row?.tokenSet instanceof Set
    ? new Set(Array.from(row.tokenSet))
    : new Set(uniqueStrings([...(row?.categoricalTokens ?? []), ...(row?.contextualTokens ?? [])]))

const cloneCategoricalTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...(row?.contextualTokens ?? [])])

const average = (values = []) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => toNumber(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const FEATURE_CANDIDATES = Object.freeze({
  rangePct: ["feature.candle.rangePct", "candle.rangePct", "rangePct"],
  bodyPct: ["feature.candle.bodyPct", "candle.bodyPct", "bodyPct"],
  closePos: ["feature.candle.closePos", "candle.closePos", "closePos"],
  gapPct: ["feature.gap.pct", "gap.pct", "event.gapPct", "feature.gap.openPct", "gap.openPct"],
  valueRatio20: [
    "feature.volume.ratio5over20",
    "feature.volume.valueRatio20",
    "volume.valueRatio20",
    "valueRatio20",
  ],
  breakoutDistance20: [
    "feature.shape.breakoutDistance20",
    "shape.breakoutDistance20",
    "breakoutDistance20",
  ],
  closeNearHigh20: [
    "feature.level.closeNearHigh20",
    "level.closeNearHigh20",
    "closeNearHigh20",
  ],
})

const readFeature = (row, aliases = []) => {
  for (const featureKey of Array.isArray(aliases) ? aliases : []) {
    const value = toNumber(row?.numericFeatureMap?.[featureKey])
    if (value != null) return value
  }
  return null
}

const summarizeRows = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const positives = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    rowCount: safeRows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    matchedDateCount: new Set(positives.map((row) => row?.dateKey).filter(Boolean)).size,
    matchedMonthCount: new Set(positives.map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
    matchedFoldCount: new Set(positives.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
  }
}

const matchesFamilyScope = (row, familyId) => {
  const tokenSet = cloneTokenSet(row)
  const rootTokens = buildPerfectPrototypeRuleFamilyRootTokens(familyId)
  const scopeSpec = buildPerfectPrototypeRecentOnlyFamilyScopeSpec(familyId)
  if (rootTokens.length < 1) return false
  if (!rootTokens.every((token) => tokenSet.has(token))) return false
  if ((scopeSpec.excludedPositiveTokens ?? []).some((token) => tokenSet.has(token))) return false
  return true
}

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = toText(row?.dateKey)
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const buildFeatureMeans = (rows = []) => ({
  rangePct: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.rangePct))),
  bodyPct: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.bodyPct))),
  closePos: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.closePos))),
  gapPct: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.gapPct))),
  valueRatio20: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.valueRatio20))),
  breakoutDistance20: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.breakoutDistance20))),
  closeNearHigh20: average(rows.map((row) => readFeature(row, FEATURE_CANDIDATES.closeNearHigh20))),
})

const deriveEpisodeTokensForRow = ({
  row,
  priorMeans,
  priorRowCountMean,
  currentDateRowCount,
} = {}) => {
  const rangePct = readFeature(row, FEATURE_CANDIDATES.rangePct)
  const bodyPct = readFeature(row, FEATURE_CANDIDATES.bodyPct)
  const closePos = readFeature(row, FEATURE_CANDIDATES.closePos)
  const gapPct = readFeature(row, FEATURE_CANDIDATES.gapPct)
  const valueRatio20 = readFeature(row, FEATURE_CANDIDATES.valueRatio20)
  const breakoutDistance20 = readFeature(row, FEATURE_CANDIDATES.breakoutDistance20)
  const closeNearHigh20 = readFeature(row, FEATURE_CANDIDATES.closeNearHigh20)

  const squeeze =
    Number.isFinite(rangePct) &&
    Number.isFinite(bodyPct) &&
    Number.isFinite(priorMeans?.rangePct) &&
    Number.isFinite(priorMeans?.bodyPct) &&
    (rangePct <= Number(priorMeans.rangePct) * 0.85 &&
      bodyPct <= Number(priorMeans.bodyPct) * 0.9)
  const sparseSqueeze =
    Number.isFinite(priorRowCountMean) &&
    Number.isFinite(currentDateRowCount) &&
    Number.isFinite(bodyPct) &&
    Number.isFinite(priorMeans?.bodyPct) &&
    currentDateRowCount <= Number(priorRowCountMean) * 0.85 &&
    bodyPct <= Number(priorMeans.bodyPct)
  const dryup =
    Number.isFinite(valueRatio20) &&
    Number.isFinite(priorMeans?.valueRatio20) &&
    valueRatio20 <= Number(priorMeans.valueRatio20) * 0.85
  const release =
    (Number.isFinite(gapPct) &&
      Number.isFinite(priorMeans?.gapPct) &&
      gapPct >= Number(priorMeans.gapPct) + 0.02) ||
    (Number.isFinite(breakoutDistance20) &&
      Number.isFinite(priorMeans?.breakoutDistance20) &&
      breakoutDistance20 >= Number(priorMeans.breakoutDistance20) + 0.02)
  const accept =
    (Number.isFinite(closePos) &&
      Number.isFinite(priorMeans?.closePos) &&
      closePos >= Number(priorMeans.closePos) + 0.05) ||
    (Number.isFinite(closeNearHigh20) &&
      Number.isFinite(priorMeans?.closeNearHigh20) &&
      closeNearHigh20 >= Number(priorMeans.closeNearHigh20) + 0.05)
  const reject =
    Number.isFinite(closePos) &&
    Number.isFinite(priorMeans?.closePos) &&
    closePos <= Number(priorMeans.closePos) - 0.05
  const sponsor =
    Number.isFinite(closeNearHigh20) &&
    Number.isFinite(priorMeans?.closeNearHigh20) &&
    Number.isFinite(valueRatio20) &&
    Number.isFinite(priorMeans?.valueRatio20) &&
    closeNearHigh20 >= Number(priorMeans.closeNearHigh20) &&
    valueRatio20 >= Number(priorMeans.valueRatio20)
  const falseRelease = Boolean(release && reject)

  return uniqueStrings([
    squeeze || sparseSqueeze ? `${EPISODE_TOKEN_PREFIX}squeeze` : null,
    dryup ? `${EPISODE_TOKEN_PREFIX}dryup` : null,
    release ? `${EPISODE_TOKEN_PREFIX}release` : null,
    accept ? `${EPISODE_TOKEN_PREFIX}accept` : null,
    reject ? `${EPISODE_TOKEN_PREFIX}reject` : null,
    sponsor ? `${EPISODE_TOKEN_PREFIX}sponsor` : null,
    falseRelease ? `${EPISODE_TOKEN_PREFIX}false_release` : null,
  ])
}

const annotateFamilyRows = ({
  trainRows = [],
  oosRows = [],
  lookbackTradingDays = 4,
} = {}) => {
  const combined = [
    ...(Array.isArray(trainRows) ? trainRows.map((row) => ({ row, split: "train" })) : []),
    ...(Array.isArray(oosRows) ? oosRows.map((row) => ({ row, split: "oos" })) : []),
  ]
  const orderedDateGroups = Array.from(
    groupRowsByDate(combined.map((entry) => entry.row)).entries(),
  ).sort((left, right) => left[0].localeCompare(right[0]))
  const rowAnnotations = new Map()
  const dateSummaries = []

  for (let dateIndex = 0; dateIndex < orderedDateGroups.length; dateIndex += 1) {
    const [dateKey, dateRows] = orderedDateGroups[dateIndex]
    const priorDateGroups = orderedDateGroups
      .slice(Math.max(0, dateIndex - Math.max(1, Math.floor(Number(lookbackTradingDays) || 4))), dateIndex)
      .map((entry) => entry[1])
    const priorRows = priorDateGroups.flat()
    const priorMeans = buildFeatureMeans(priorRows)
    const priorRowCountMean = average(priorDateGroups.map((rows) => Number(rows.length ?? 0)))
    const episodeTokensForDate = new Set()
    for (const row of dateRows) {
      const episodeTokens = deriveEpisodeTokensForRow({
        row,
        priorMeans,
        priorRowCountMean,
        currentDateRowCount: dateRows.length,
      })
      episodeTokens.forEach((token) => episodeTokensForDate.add(token))
      rowAnnotations.set(buildRowKey(row), {
        dateKey,
        episodeTokens,
        priorMeans,
        priorRowCountMean: toNumber(priorRowCountMean),
      })
    }
    dateSummaries.push({
      dateKey,
      rowCount: dateRows.length,
      priorRowCountMean: toNumber(priorRowCountMean),
      episodeTokens: uniqueStrings(Array.from(episodeTokensForDate)),
    })
  }

  const annotateRows = (rows = []) =>
    (Array.isArray(rows) ? rows : []).map((rawRow) => {
      const rowKey = buildRowKey(rawRow)
      const annotation = rowAnnotations.get(rowKey) ?? {
        episodeTokens: [],
        priorMeans: {},
        priorRowCountMean: null,
      }
      const categoricalTokens = cloneCategoricalTokens(rawRow)
      const tokenSet = cloneTokenSet(rawRow)
      for (const episodeToken of annotation.episodeTokens ?? []) {
        if (!categoricalTokens.includes(episodeToken)) categoricalTokens.push(episodeToken)
        tokenSet.add(episodeToken)
      }
      const numericFeatureMap = {
        ...(rawRow?.numericFeatureMap ?? {}),
      }
      if (toNumber(annotation?.priorMeans?.rangePct) != null) {
        const currentRangePct = readFeature(rawRow, FEATURE_CANDIDATES.rangePct)
        numericFeatureMap["sig.temporalEpisode.delta.rangePct"] =
          Number(currentRangePct ?? 0) - Number(annotation.priorMeans.rangePct ?? 0)
      }
      if (toNumber(annotation?.priorMeans?.valueRatio20) != null) {
        const currentValueRatio20 = readFeature(rawRow, FEATURE_CANDIDATES.valueRatio20)
        numericFeatureMap["sig.temporalEpisode.delta.valueRatio20"] =
          Number(currentValueRatio20 ?? 0) - Number(annotation.priorMeans.valueRatio20 ?? 0)
      }
      if (toNumber(annotation?.priorMeans?.closePos) != null) {
        const currentClosePos = readFeature(rawRow, FEATURE_CANDIDATES.closePos)
        numericFeatureMap["sig.temporalEpisode.delta.closePos"] =
          Number(currentClosePos ?? 0) - Number(annotation.priorMeans.closePos ?? 0)
      }
      if (annotation?.priorRowCountMean != null) {
        numericFeatureMap["sig.temporalEpisode.priorDateRowCountMean"] = Number(annotation.priorRowCountMean)
      }
      return {
        ...rawRow,
        rowKey,
        monthKey: toText(rawRow?.monthKey) ?? buildMonthKey(rawRow?.dateKey),
        categoricalTokens: uniqueStrings(categoricalTokens),
        tokenSet,
        numericFeatureMap,
        episodeTokens: uniqueStrings(annotation.episodeTokens),
      }
    })

  return {
    trainRows: annotateRows(trainRows),
    oosRows: annotateRows(oosRows),
    dateSummaries,
  }
}

const buildEpisodeTokenStats = ({
  positiveRows = [],
  negativeRows = [],
} = {}) => {
  const episodeTokens = uniqueStrings([
    ...positiveRows.flatMap((row) => row?.episodeTokens ?? []),
    ...negativeRows.flatMap((row) => row?.episodeTokens ?? []),
  ])
  return episodeTokens
    .map((token) => {
      const positiveDateSupport = new Set(
        positiveRows.filter((row) => row?.episodeTokens?.includes(token)).map((row) => row?.dateKey).filter(Boolean),
      ).size
      const negativeDateSupport = new Set(
        negativeRows.filter((row) => row?.episodeTokens?.includes(token)).map((row) => row?.dateKey).filter(Boolean),
      ).size
      const totalSupport = positiveDateSupport + negativeDateSupport
      return {
        token,
        positiveDateSupport,
        negativeDateSupport,
        positiveShare: totalSupport > 0 ? positiveDateSupport / totalSupport : 0,
        lift: positiveDateSupport - negativeDateSupport,
      }
    })
    .sort(
      (left, right) =>
        Number(right.lift ?? 0) - Number(left.lift ?? 0) ||
        Number(right.positiveDateSupport ?? 0) - Number(left.positiveDateSupport ?? 0) ||
        String(left.token ?? "").localeCompare(String(right.token ?? "")),
    )
}

export const buildPerfectPrototypeLow1dRecentEpisodeDataset = ({
  trainRows = [],
  oosRows = [],
  familyIds = [],
  lookbackTradingDays = 4,
} = {}) => {
  const normalizedFamilyIds = uniqueStrings(familyIds)
  const familyDatasets = normalizedFamilyIds.map((familyId) => {
    const familyTrainRows = (Array.isArray(trainRows) ? trainRows : []).filter((row) => matchesFamilyScope(row, familyId))
    const familyOosRows = (Array.isArray(oosRows) ? oosRows : []).filter((row) => matchesFamilyScope(row, familyId))
    const annotated = annotateFamilyRows({
      trainRows: familyTrainRows,
      oosRows: familyOosRows,
      lookbackTradingDays,
    })
    const annotatedTrainRows = annotated.trainRows
    const annotatedOosRows = annotated.oosRows
    const trainPositiveRows = annotatedTrainRows.filter((row) => row?.outcomeHitTarget === true)
    const trainNegativeRows = annotatedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
    const episodeTokenStats = buildEpisodeTokenStats({
      positiveRows: trainPositiveRows,
      negativeRows: trainNegativeRows,
    })
    return {
      familyId,
      rootTokens: buildPerfectPrototypeRuleFamilyRootTokens(familyId),
      trainRows: annotatedTrainRows,
      oosRows: annotatedOosRows,
      trainPositiveRows,
      trainNegativeRows,
      episodeTokenStats,
      episodeFeatureKeys: uniqueStrings(
        [...annotatedTrainRows, ...annotatedOosRows].flatMap((row) => row?.episodeTokens ?? []),
      ),
      dateSummaries: annotated.dateSummaries,
      summary: {
        familyId,
        train: summarizeRows(annotatedTrainRows),
        oos: summarizeRows(annotatedOosRows),
        episodeTokenCount: episodeTokenStats.length,
        topEpisodeTokens: episodeTokenStats.slice(0, 8),
      },
    }
  })
  const readyFamilyCount = familyDatasets.filter((entry) => (entry?.trainRows?.length ?? 0) > 0).length
  return {
    ok: readyFamilyCount > 0,
    reason: readyFamilyCount > 0 ? null : "unsat_low_recent_episode_dataset_empty",
    lookbackTradingDays: Math.max(1, Math.floor(Number(lookbackTradingDays) || 4)),
    familyDatasets,
    summary: {
      familyCount: familyDatasets.length,
      readyFamilyCount,
      totalEpisodeTokenCount: new Set(
        familyDatasets.flatMap((entry) => entry?.episodeFeatureKeys ?? []).filter(Boolean),
      ).size,
      familySummaries: familyDatasets.map((entry) => entry.summary),
    },
  }
}
