import crypto from "node:crypto"

import {
  buildPerfectPrototypeSupportSignatureTokenizerConfig,
  buildPerfectPrototypeTokenizerSpec,
  normalizePerfectPrototypeRow,
  normalizePerfectPrototypeTokenizerOptions,
  tokenizePerfectPrototypeRow,
} from "./perfect_prototype_tokenizer.mjs"
import {
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  normalizePerfectPrototypeSupportCases,
} from "./perfect_prototype_support_case.mjs"
import { countPerfectPrototypeAtomTypes } from "./perfect_prototype_support_anchor_cohort.mjs"
import { buildPerfectPrototypeSupportSignatureMetrics } from "./perfect_prototype_support_manifold_signature.mjs"
import { buildPerfectPrototypeSupportMetricFeatures } from "./perfect_prototype_support_metric_features.mjs"
import { buildPerfectPrototypeAdaptiveThresholdAtoms } from "./perfect_prototype_adaptive_threshold_atom_bank.mjs"

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const uniqueSorted = (values) =>
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
  toText(row?.sourceId) ??
  [
    toText(row?.dateKey) ?? "?",
    toText(row?.symbol) ?? "?",
    String(Boolean(row?.outcomeHitTarget)),
  ].join("::")

const buildSortedDates = (rows) =>
  uniqueSorted((Array.isArray(rows) ? rows : []).map((row) => row?.dateKey).filter(Boolean))

const buildDateBucketMap = (sortedDates, bucketCount) => {
  const out = new Map()
  const count = Math.max(1, Math.floor(Number(bucketCount) || 1))
  const safeDates = Array.isArray(sortedDates) ? sortedDates : []
  for (let index = 0; index < safeDates.length; index += 1) {
    const bucket = Math.min(count - 1, Math.floor((index * count) / Math.max(1, safeDates.length)))
    out.set(String(safeDates[index]), bucket + 1)
  }
  return out
}

const resolveClauseTokenAxis = (token) => {
  const normalized = toText(token)
  if (!normalized) return null
  const lastColon = normalized.lastIndexOf(":")
  if (lastColon <= 0) return normalized
  return normalized.slice(0, lastColon)
}

const isSupportMetricClauseToken = (token) => {
  const normalized = toText(token) ?? ""
  if (!normalized) return false
  if (normalized.includes(":MISSING")) return false
  return (
    normalized.startsWith("sig:") ||
    normalized.startsWith("num:sig.") ||
    normalized.startsWith("ival:") ||
    normalized.startsWith("macro:lowGapTop:") ||
    normalized.startsWith("tag:lowGapTop.") ||
    normalized.startsWith("tag:event.") ||
    normalized.startsWith("tag:xsec.") ||
    normalized.startsWith("tag:market.")
  )
}

const atomTypeBonus = (token) => {
  const counts = countPerfectPrototypeAtomTypes([token])
  if (counts.support_signature > 0) return 28
  if (counts.adaptive_threshold > 0) return 24
  if (counts.support_anchor > 0) return 18
  if (counts.macro > 0) return 12
  if (counts.interval > 0) return 8
  if (counts.atomic > 0) return 4
  return 0
}

const buildClauseId = (tokens) =>
  `CLAUSE_${crypto
    .createHash("sha1")
    .update(JSON.stringify(uniqueSorted(tokens)))
    .digest("hex")
    .slice(0, 12)}`

const buildTokenPostings = (rows) => {
  const postings = new Map()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    for (const token of row.tokens) {
      const bucket = postings.get(token) ?? []
      bucket.push(index)
      postings.set(token, bucket)
    }
  }
  return postings
}

const intersectSortedArrays = (left, right) => {
  const out = []
  let l = 0
  let r = 0
  while (l < left.length && r < right.length) {
    if (left[l] === right[r]) {
      out.push(left[l])
      l += 1
      r += 1
    } else if (left[l] < right[r]) {
      l += 1
    } else {
      r += 1
    }
  }
  return out
}

const resolveMatchedIndexes = (tokens, postings) => {
  const normalizedTokens = uniqueSorted(tokens)
  if (normalizedTokens.length < 1) return []
  const postingLists = normalizedTokens
    .map((token) => postings.get(token) ?? [])
    .sort((left, right) => left.length - right.length)
  if (postingLists[0].length < 1) return []
  let current = postingLists[0]
  for (let index = 1; index < postingLists.length; index += 1) {
    current = intersectSortedArrays(current, postingLists[index])
    if (current.length < 1) break
  }
  return current
}

const cloneMatchedRow = (row) => ({
  rowKey: row.rowKey,
  sourceId: row.sourceId,
  dateKey: row.dateKey,
  monthKey: row.monthKey,
  symbol: row.symbol,
  outcomeHitTarget: row.outcomeHitTarget === true,
  foldId: toNumber(row.foldId, 0),
  windowId: toNumber(row.windowId, 0),
})

const buildSupportCaseRowView = ({
  supportCase,
  spec,
  tokenizerOptions,
  supportSignatureConfig,
} = {}) => {
  const baseCategoricalTokens = uniqueSorted([
    ...(Array.isArray(supportCase?.categoricalTokens) ? supportCase.categoricalTokens : []),
    ...(Array.isArray(supportCase?.tokens)
      ? supportCase.tokens.filter((token) => {
          const normalized = toText(token) ?? ""
          return (
            normalized.startsWith("tag:") ||
            normalized.startsWith("sig:") ||
            normalized.startsWith("macro:")
          )
        })
      : []),
  ])
  const signatureMetrics = supportSignatureConfig
    ? buildPerfectPrototypeSupportSignatureMetrics({
        normalizedRow: {
          symbol: supportCase.symbol,
          dateKey: supportCase.dateKey,
          numericFeatureMap: supportCase.numericFeatureMap ?? {},
          categoricalTokens: baseCategoricalTokens,
        },
        supportSignatureConfig,
      })
    : { numericFeatureMap: {}, categoricalTokens: [] }
  const supportMetricFeatures = buildPerfectPrototypeSupportMetricFeatures({
    signatureMetrics,
  })
  const adaptiveThresholdAtoms = buildPerfectPrototypeAdaptiveThresholdAtoms({
    signatureMetrics,
  })
  const pseudoRow = {
    symbol: supportCase.symbol,
    dateKey: supportCase.dateKey,
    numericFeatureMap: {
      ...(supportCase.numericFeatureMap ?? {}),
      ...(signatureMetrics?.numericFeatureMap ?? {}),
      ...(supportMetricFeatures?.numericFeatureMap ?? {}),
    },
    categoricalTokens: uniqueSorted([
      ...baseCategoricalTokens,
      ...(signatureMetrics?.categoricalTokens ?? []),
      ...(supportMetricFeatures?.categoricalTokens ?? []),
      ...adaptiveThresholdAtoms,
    ]),
  }
  const tokens = tokenizePerfectPrototypeRow(pseudoRow, spec, tokenizerOptions)
  return {
    caseId: supportCase.caseId,
    symbol: supportCase.symbol,
    dateKey: supportCase.dateKey,
    tokens,
    tokenSet: new Set(tokens),
  }
}

const buildTokenizedRows = ({
  rows = [],
  spec,
  tokenizerOptions,
  supportSignatureConfig,
  foldMap = new Map(),
  windowMap = new Map(),
} = {}) =>
  (Array.isArray(rows) ? rows : [])
    .map((rawRow) => {
      const normalizedRow = normalizePerfectPrototypeRow(rawRow, {
        ...tokenizerOptions,
        supportSignatureConfig,
      })
      const tokens = tokenizePerfectPrototypeRow(normalizedRow, spec, tokenizerOptions)
      const dateKey = toText(normalizedRow?.dateKey)
      const symbol = toText(normalizedRow?.symbol)
      const hitTarget =
        typeof normalizedRow?.outcomeHitTarget === "boolean"
          ? normalizedRow.outcomeHitTarget
          : typeof rawRow?.outcomeHitTarget === "boolean"
            ? rawRow.outcomeHitTarget
            : typeof rawRow?.eventOutcome?.hitTarget === "boolean"
              ? rawRow.eventOutcome.hitTarget
              : null
      if (!dateKey || !symbol || typeof hitTarget !== "boolean") return null
      return {
        rowKey: buildRowKey({ ...rawRow, dateKey, symbol, outcomeHitTarget: hitTarget }),
        sourceId: toText(rawRow?.sourceId) ?? `${symbol}:${dateKey}`,
        dateKey,
        monthKey: buildMonthKey(dateKey),
        symbol,
        outcomeHitTarget: hitTarget,
        foldId: toNumber(foldMap.get(dateKey), 0),
        windowId: toNumber(windowMap.get(dateKey), 0),
        tokens,
      }
    })
    .filter(Boolean)

const buildWindowStats = (matchedRows, minWindowSupport) => {
  const positiveByWindow = new Map()
  const negativeByWindow = new Set()
  for (const row of Array.isArray(matchedRows) ? matchedRows : []) {
    const windowId = toNumber(row?.windowId, 0)
    if (windowId < 1) continue
    if (row?.outcomeHitTarget === true) {
      positiveByWindow.set(windowId, Number(positiveByWindow.get(windowId) ?? 0) + 1)
    } else {
      negativeByWindow.add(windowId)
    }
  }
  const minSupport = Math.max(1, Math.floor(Number(minWindowSupport) || 1))
  let matchedPositiveWindowCount = 0
  for (const count of positiveByWindow.values()) {
    if (count >= minSupport) matchedPositiveWindowCount += 1
  }
  return {
    crossfitWindowCount: new Set([
      ...positiveByWindow.keys(),
      ...negativeByWindow.values(),
    ]).size,
    crossfitMatchedWindowCount: matchedPositiveWindowCount,
    crossfitNegativeWindowCount: negativeByWindow.size,
  }
}

const buildClauseScore = (entry) =>
  (entry.haesungSupport === true ? 300 : 0) +
  toNumber(entry.openOosHitCount, 0) * 90 +
  toNumber(entry.trainMatchedDateCount, 0) * 8 +
  toNumber(entry.trainMatchedMonthCount, 0) * 6 +
  toNumber(entry.crossfitMatchedWindowCount, 0) * 18 +
  Math.max(0, 3 - toNumber(entry.ruleSize, 0)) * 4 +
  toNumber(entry.supportSignatureAtomCount, 0) * 10 +
  toNumber(entry.adaptiveThresholdAtomCount, 0) * 8 +
  toNumber(entry.macroAtomCount, 0) * 6 +
  toNumber(entry.intervalAtomCount, 0) * 3 -
  toNumber(entry.openOosNegativeCount, 0) * 200 -
  toNumber(entry.crossfitNegativeWindowCount, 0) * 150

const compareClauses = (left, right) => {
  if (toNumber(right.clauseScore, 0) !== toNumber(left.clauseScore, 0)) {
    return toNumber(right.clauseScore, 0) - toNumber(left.clauseScore, 0)
  }
  if (toNumber(right.openOosHitCount, 0) !== toNumber(left.openOosHitCount, 0)) {
    return toNumber(right.openOosHitCount, 0) - toNumber(left.openOosHitCount, 0)
  }
  if (toNumber(right.trainMatchedDateCount, 0) !== toNumber(left.trainMatchedDateCount, 0)) {
    return toNumber(right.trainMatchedDateCount, 0) - toNumber(left.trainMatchedDateCount, 0)
  }
  if (toNumber(left.ruleSize, 0) !== toNumber(right.ruleSize, 0)) {
    return toNumber(left.ruleSize, 0) - toNumber(right.ruleSize, 0)
  }
  return String(left.ruleId ?? "").localeCompare(String(right.ruleId ?? ""))
}

const evaluateClauseTokens = ({
  tokens = [],
  trainRows = [],
  trainPostings = new Map(),
  oosRows = [],
  oosPostings = new Map(),
  supportCaseViews = [],
  crossfitMinWindowSupport = 2,
  sourceMode = "general",
} = {}) => {
  const normalizedTokens = uniqueSorted(tokens)
  if (normalizedTokens.length < 1) return null
  const trainMatchedRows = resolveMatchedIndexes(normalizedTokens, trainPostings).map((index) =>
    cloneMatchedRow(trainRows[index]),
  )
  const oosMatchedRows = resolveMatchedIndexes(normalizedTokens, oosPostings).map((index) =>
    cloneMatchedRow(oosRows[index]),
  )
  const trainDateKeys = new Set()
  const trainMonthKeys = new Set()
  const trainFoldIds = new Set()
  let trainHitCount = 0
  let trainNegativeCount = 0
  for (const row of trainMatchedRows) {
    if (row.dateKey) trainDateKeys.add(row.dateKey)
    if (row.monthKey) trainMonthKeys.add(row.monthKey)
    if (row.foldId > 0) trainFoldIds.add(row.foldId)
    if (row.outcomeHitTarget === true) trainHitCount += 1
    else trainNegativeCount += 1
  }
  const oosDateKeys = new Set()
  let oosHitCount = 0
  let oosNegativeCount = 0
  for (const row of oosMatchedRows) {
    if (row.dateKey) oosDateKeys.add(row.dateKey)
    if (row.outcomeHitTarget === true) oosHitCount += 1
    else oosNegativeCount += 1
  }
  const supportCaseIds = supportCaseViews
    .filter((view) => normalizedTokens.every((token) => view.tokenSet.has(token)))
    .map((view) => view.caseId)
  const candidateAtomTypeCounts = countPerfectPrototypeAtomTypes(normalizedTokens)
  const windowStats = buildWindowStats(trainMatchedRows, crossfitMinWindowSupport)
  const clause = {
    ruleId: buildClauseId(normalizedTokens),
    sourceMode,
    tokens: normalizedTokens,
    ruleSize: normalizedTokens.length,
    trainMatchedRows,
    oosMatchedRows,
    trainMatchCount: trainMatchedRows.length,
    trainHitCount,
    trainNegativeCount,
    trainPrecision: trainMatchedRows.length > 0 ? trainHitCount / trainMatchedRows.length : 0,
    trainMatchedDateCount: trainDateKeys.size,
    trainMatchedMonthCount: trainMonthKeys.size,
    trainMatchedFoldCount: trainFoldIds.size,
    openOosMatchCount: oosMatchedRows.length,
    openOosHitCount: oosHitCount,
    openOosNegativeCount: oosNegativeCount,
    openOosPrecision: oosMatchedRows.length > 0 ? oosHitCount / oosMatchedRows.length : 0,
    openOosUniqueMatchedDates: oosDateKeys.size,
    supportCaseIds,
    supportCaseCount: supportCaseIds.length,
    haesungSupport: supportCaseIds.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID),
    candidateAtomTypeCounts,
    supportSignatureAtomCount: toNumber(candidateAtomTypeCounts.support_signature, 0),
    adaptiveThresholdAtomCount: toNumber(candidateAtomTypeCounts.adaptive_threshold, 0),
    intervalAtomCount: toNumber(candidateAtomTypeCounts.interval, 0),
    macroAtomCount: toNumber(candidateAtomTypeCounts.macro, 0),
    supportAnchorAtomCount: toNumber(candidateAtomTypeCounts.support_anchor, 0),
    ...windowStats,
    jointCrossfitRetainedPositiveWindowCount: windowStats.crossfitMatchedWindowCount,
    selectionFrequency:
      windowStats.crossfitWindowCount > 0
        ? windowStats.crossfitMatchedWindowCount / windowStats.crossfitWindowCount
        : 0,
  }
  clause.clauseScore = buildClauseScore(clause)
  return clause
}

const shortlistTokenPool = ({
  tokenPool = [],
  trainRows = [],
  trainPostings = new Map(),
  oosRows = [],
  oosPostings = new Map(),
  supportCaseViews = [],
  crossfitMinWindowSupport = 2,
  requireSupportCoverage = false,
  totalLimit = 16,
  perTypeLimit = 5,
  minTrainHitCount = 1,
} = {}) => {
  const candidates = []
  for (const token of uniqueSorted(tokenPool)) {
    const clause = evaluateClauseTokens({
      tokens: [token],
      trainRows,
      trainPostings,
      oosRows,
      oosPostings,
      supportCaseViews,
      crossfitMinWindowSupport,
      sourceMode: requireSupportCoverage ? "support_seed" : "general_seed",
    })
    if (!clause || clause.trainHitCount < minTrainHitCount) continue
    if (requireSupportCoverage && clause.haesungSupport !== true) continue
    if (!requireSupportCoverage && clause.openOosNegativeCount > 0 && clause.trainNegativeCount > 2) continue
    clause.tokenScore =
      clause.clauseScore +
      (requireSupportCoverage ? 50 : 0) +
      atomTypeBonus(token)
    candidates.push(clause)
  }
  candidates.sort((left, right) => toNumber(right.tokenScore, 0) - toNumber(left.tokenScore, 0))
  const accepted = []
  const typeUsage = {
    support_signature: 0,
    adaptive_threshold: 0,
    support_anchor: 0,
    macro: 0,
    interval: 0,
    atomic: 0,
    other: 0,
  }
  for (const entry of candidates) {
    const typeCounts = entry.candidateAtomTypeCounts ?? {}
    const type =
      Object.keys(typeCounts).find((key) => Number(typeCounts[key] ?? 0) > 0) ?? "other"
    if (Number(typeUsage[type] ?? 0) >= perTypeLimit) continue
    accepted.push(entry.tokens[0])
    typeUsage[type] = Number(typeUsage[type] ?? 0) + 1
    if (accepted.length >= totalLimit) break
  }
  return accepted
}

const buildTokenCombinationSets = (tokens, maxClauseSize) => {
  const out = []
  const normalizedTokens = uniqueSorted(tokens)
  const recurse = (start, remaining, picked, usedAxes) => {
    if (picked.length > 0) out.push(picked.slice())
    if (remaining === 0) return
    for (let index = start; index < normalizedTokens.length; index += 1) {
      const token = normalizedTokens[index]
      const axis = resolveClauseTokenAxis(token)
      if (axis && usedAxes.has(axis)) continue
      picked.push(token)
      if (axis) usedAxes.add(axis)
      recurse(index + 1, remaining - 1, picked, usedAxes)
      picked.pop()
      if (axis) usedAxes.delete(axis)
    }
  }
  recurse(0, Math.max(1, Math.floor(Number(maxClauseSize) || 1)), [], new Set())
  return out
}

const filterAcceptedClauses = ({
  clauses = [],
  candidateLimit = 48,
  minTrainMatchedDates = 3,
  minTrainMatchedMonths = 3,
  minTrainMatchedFolds = 1,
  maxCrossfitNegativeWindows = 0,
  minCrossfitPositiveWindows = 1,
} = {}) => {
  const deduped = new Map()
  for (const clause of Array.isArray(clauses) ? clauses : []) {
    if (!clause) continue
    if (clause.trainMatchCount < 1) continue
    if (clause.trainNegativeCount !== 0) continue
    if (clause.openOosNegativeCount !== 0) continue
    if (clause.trainMatchedDateCount < minTrainMatchedDates) continue
    if (clause.trainMatchedMonthCount < minTrainMatchedMonths) continue
    if (clause.trainMatchedFoldCount < minTrainMatchedFolds) continue
    if (clause.crossfitNegativeWindowCount > maxCrossfitNegativeWindows) continue
    if (
      clause.haesungSupport !== true &&
      clause.openOosMatchCount < 1 &&
      clause.crossfitMatchedWindowCount < minCrossfitPositiveWindows
    ) {
      continue
    }
    const key = JSON.stringify(clause.tokens)
    const current = deduped.get(key)
    if (!current || compareClauses(clause, current) < 0) {
      deduped.set(key, clause)
    }
  }
  return Array.from(deduped.values())
    .sort(compareClauses)
    .slice(0, Math.max(1, Math.floor(Number(candidateLimit) || 48)))
}

export const buildPerfectPrototypeStableRuleBank = ({
  trainRows = [],
  oosRows = [],
  supportCases = [],
  familyId = "low_gap_top_continuation",
  surfaceName = null,
  tokenizerOptions = {},
  candidateLimit = 48,
  minTrainMatchedDates = 3,
  minTrainMatchedMonths = 3,
  minTrainMatchedFolds = 1,
  maxCrossfitNegativeWindows = 0,
  minCrossfitPositiveWindows = 2,
  crossfitWindowCount = 6,
  crossfitFoldCount = 4,
  crossfitMinWindowSupport = 2,
  maxClauseSize = 3,
  supportTokenLimit = 14,
  generalTokenLimit = 20,
} = {}) => {
  const normalizedSupportCases = normalizePerfectPrototypeSupportCases(supportCases).filter((entry) => {
    const normalizedFamilyId = toText(familyId)
    if (!normalizedFamilyId || entry.familyIds.length < 1) return true
    return entry.familyIds.includes(normalizedFamilyId)
  })
  if (normalizedSupportCases.length < 1) {
    return []
  }

  const supportSignatureConfig = buildPerfectPrototypeSupportSignatureTokenizerConfig({
    familyId,
    supportCases: normalizedSupportCases,
  })
  const resolvedTokenizerOptions = normalizePerfectPrototypeTokenizerOptions({
    ...tokenizerOptions,
    surfaceName,
    enableIntervalAtoms: true,
    enableMacroAtoms: true,
    enableSupportAnchorAtoms: true,
    enableSupportManifoldSignature: supportSignatureConfig != null,
    enableSupportMetricFeatures: true,
    enableAdaptiveThresholdAtoms: true,
    supportSignatureConfig,
  })
  const spec = buildPerfectPrototypeTokenizerSpec(trainRows, resolvedTokenizerOptions)
  const trainDateMap = buildDateBucketMap(buildSortedDates(trainRows), crossfitFoldCount)
  const trainWindowMap = buildDateBucketMap(buildSortedDates(trainRows), crossfitWindowCount)
  const tokenizedTrainRows = buildTokenizedRows({
    rows: trainRows,
    spec,
    tokenizerOptions: resolvedTokenizerOptions,
    supportSignatureConfig,
    foldMap: trainDateMap,
    windowMap: trainWindowMap,
  })
  const tokenizedOosRows = buildTokenizedRows({
    rows: oosRows,
    spec,
    tokenizerOptions: resolvedTokenizerOptions,
    supportSignatureConfig,
    foldMap: new Map(),
    windowMap: new Map(),
  })
  if (tokenizedTrainRows.length < 1) {
    return []
  }

  const supportCaseViews = normalizedSupportCases.map((supportCase) =>
    buildSupportCaseRowView({
      supportCase,
      spec,
      tokenizerOptions: resolvedTokenizerOptions,
      supportSignatureConfig,
    }),
  )
  const supportTokenPool = uniqueSorted(
    supportCaseViews.flatMap((entry) => entry.tokens.filter(isSupportMetricClauseToken)),
  )
  const generalTokenPool = uniqueSorted(
    tokenizedTrainRows.flatMap((row) => row.tokens.filter(isSupportMetricClauseToken)),
  )
  const trainPostings = buildTokenPostings(tokenizedTrainRows)
  const oosPostings = buildTokenPostings(tokenizedOosRows)
  const shortlistedSupportTokens = shortlistTokenPool({
    tokenPool: supportTokenPool,
    trainRows: tokenizedTrainRows,
    trainPostings,
    oosRows: tokenizedOosRows,
    oosPostings,
    supportCaseViews,
    crossfitMinWindowSupport,
    requireSupportCoverage: true,
    totalLimit: supportTokenLimit,
    perTypeLimit: 5,
    minTrainHitCount: 1,
  })
  const shortlistedGeneralTokens = shortlistTokenPool({
    tokenPool: generalTokenPool,
    trainRows: tokenizedTrainRows,
    trainPostings,
    oosRows: tokenizedOosRows,
    oosPostings,
    supportCaseViews,
    crossfitMinWindowSupport,
    requireSupportCoverage: false,
    totalLimit: generalTokenLimit,
    perTypeLimit: 6,
    minTrainHitCount: 2,
  })

  const candidateClauses = []
  for (const combination of buildTokenCombinationSets(shortlistedSupportTokens, maxClauseSize)) {
    candidateClauses.push(
      evaluateClauseTokens({
        tokens: combination,
        trainRows: tokenizedTrainRows,
        trainPostings,
        oosRows: tokenizedOosRows,
        oosPostings,
        supportCaseViews,
        crossfitMinWindowSupport,
        sourceMode: "support",
      }),
    )
  }
  for (const combination of buildTokenCombinationSets(shortlistedGeneralTokens, maxClauseSize)) {
    candidateClauses.push(
      evaluateClauseTokens({
        tokens: combination,
        trainRows: tokenizedTrainRows,
        trainPostings,
        oosRows: tokenizedOosRows,
        oosPostings,
        supportCaseViews,
        crossfitMinWindowSupport,
        sourceMode: "general",
      }),
    )
  }

  return filterAcceptedClauses({
    clauses: candidateClauses,
    candidateLimit,
    minTrainMatchedDates,
    minTrainMatchedMonths,
    minTrainMatchedFolds,
    maxCrossfitNegativeWindows,
    minCrossfitPositiveWindows,
  })
}
