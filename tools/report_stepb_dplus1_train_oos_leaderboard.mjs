import fs from "node:fs/promises"
import path from "node:path"

import { parseCliArgs, getFlag } from "../src/lib/args.mjs"
import { ensureDir, readJson, readJsonl, writeJson, writeJsonl } from "../src/lib/io.mjs"
import { loadPerfectPrototypeCatalog } from "../src/lib/perfect_prototype_catalog.mjs"
import {
  PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION,
  PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS,
} from "../src/lib/perfect_prototype_rule_family_spec.mjs"
import {
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID,
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS,
  selectRecentLowShadowBundleCandidate,
} from "../src/lib/perfect_prototype_recent_low_bundle.mjs"
import { buildRecentImpulseUniverseId } from "../src/lib/perfect_prototype_multiline_contract.mjs"
import {
  PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID,
  PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
  evaluatePerfectPrototypeRuleSupportCases,
  normalizePerfectPrototypeSupportCases,
} from "../src/lib/perfect_prototype_support_case.mjs"

const STEPB_DPLUS1_NO_GAP_LINE_IDS = new Set([
  "stepb_dplus1_baseline",
  "stepb_dplus1_plus_lite",
  "stepb_dplus1_plus_lite_lane_local",
  "stepb_dplus1_plus_lite_recent_mid_low",
])

const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID = "stepb_dplus1_plus_lite_recent_mid_low"
const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE = "v6_contextual_plus_lite_recent_only_lane_local_pool8"
const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_CONTRACT_ID = "recent_only_mid_low_shadow_v1"
const PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_DISCOVERY_UNIVERSE_ID = buildRecentImpulseUniverseId(1)
const PERFECT_PROTOTYPE_RECENT_ONLY_ALLOWED_SELECTION_CONTRACT_IDS = new Set([
  PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_CONTRACT_ID,
  PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID,
  PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID,
])

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const normalizeSelectionMode = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const hasOwn = (value, key) =>
  !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key)

const resolveOutcomeHitTarget = (row) => {
  if (typeof row?.outcomeHitTarget === "boolean") return row.outcomeHitTarget
  if (typeof row?.eventOutcome?.hitTarget === "boolean") return row.eventOutcome.hitTarget
  return null
}

const readRequiredJson = async (filePath) => readJson(filePath, null)

const readOptionalJson = async (filePath) => readJson(filePath, null)

const readEvaluationBundle = async (dirPath) => ({
  summary: await readRequiredJson(path.join(dirPath, "oos_summary.json")),
  ruleReport: await readRequiredJson(path.join(dirPath, "oos_rule_report.json")),
  matches: await readJsonl(path.join(dirPath, "oos_matches.jsonl")),
  dedupedMatches: await readJsonl(path.join(dirPath, "oos_deduped_symbols.jsonl")),
})

const readApplyBundle = async (dirPath) => ({
  summary: await readRequiredJson(path.join(dirPath, "summary.json")),
  matches: await readJsonl(path.join(dirPath, "matches.jsonl")),
  dedupedMatches: await readJsonl(path.join(dirPath, "deduped_symbols.jsonl")),
})

const readStepBSummaryForInput = async (inputPath) =>
  readOptionalJson(path.join(path.dirname(inputPath), "step_b_summary.json"))

const assertBundleCountConsistency = ({ label, summary, matches, dedupedMatches }) => {
  const rawMatches = toNumber(summary?.rawMatches, NaN)
  const dedupedMatchCount = toNumber(summary?.dedupedMatches, NaN)
  const expectedRawMatches = Array.isArray(matches) ? matches.length : 0
  const expectedDedupedMatches = Array.isArray(dedupedMatches) ? dedupedMatches.length : 0
  if (Number.isFinite(rawMatches) && rawMatches !== expectedRawMatches) {
    throw new Error(
      `${label} summary rawMatches=${rawMatches} does not match ${expectedRawMatches} rows in the JSONL artifact`,
    )
  }
  if (Number.isFinite(dedupedMatchCount) && dedupedMatchCount !== expectedDedupedMatches) {
    throw new Error(
      `${label} summary dedupedMatches=${dedupedMatchCount} does not match ${expectedDedupedMatches} rows in the deduped JSONL artifact`,
    )
  }
  if (hasOwn(summary, "uniqueMatchedDates")) {
    const uniqueMatchedDates = uniqueSorted((dedupedMatches ?? []).map((row) => row?.dateKey)).length
    if (toNumber(summary?.uniqueMatchedDates, uniqueMatchedDates) !== uniqueMatchedDates) {
      throw new Error(
        `${label} summary uniqueMatchedDates=${summary?.uniqueMatchedDates} does not match ${uniqueMatchedDates} deduped rows`,
      )
    }
  }
  if (hasOwn(summary, "uniqueMatchedSymbols")) {
    const uniqueMatchedSymbols = uniqueSorted((dedupedMatches ?? []).map((row) => row?.symbol)).length
    if (toNumber(summary?.uniqueMatchedSymbols, uniqueMatchedSymbols) !== uniqueMatchedSymbols) {
      throw new Error(
        `${label} summary uniqueMatchedSymbols=${summary?.uniqueMatchedSymbols} does not match ${uniqueMatchedSymbols} deduped rows`,
      )
    }
  }
}

const assertArtifactHashConsistency = ({ label, summary, expectedCatalogSha256, expectedRuleIdsSha256 }) => {
  const observedCatalogSha256 = toText(summary?.catalogContentSha256)
  const observedRuleIdsSha256 = toText(summary?.ruleIdsSha256)
  if (!observedCatalogSha256 || !observedRuleIdsSha256) {
    throw new Error(`${label} summary is missing frozen catalog hash fields`)
  }
  if (observedCatalogSha256 !== expectedCatalogSha256 || observedRuleIdsSha256 !== expectedRuleIdsSha256) {
    throw new Error(
      `${label} summary hash mismatch: catalogContentSha256=${observedCatalogSha256}, ruleIdsSha256=${observedRuleIdsSha256}`,
    )
  }
}

const buildRuleReportLookup = (ruleReport) =>
  new Map(
    (Array.isArray(ruleReport) ? ruleReport : []).map((row) => [String(row?.ruleId ?? "").trim(), row]),
  )

const buildRuleMatchLookup = (matches) => {
  const lookup = new Map()
  for (const row of Array.isArray(matches) ? matches : []) {
    const matchedRuleIds = Array.isArray(row?.matchedRuleIds) ? row.matchedRuleIds : []
    const outcomeHitTarget = resolveOutcomeHitTarget(row)
    for (const rawRuleId of matchedRuleIds) {
      const ruleId = String(rawRuleId ?? "").trim()
      if (!ruleId) continue
      const current = lookup.get(ruleId) ?? {
        rawMatchCount: 0,
        positiveMatchCount: 0,
        negativeMatchCount: 0,
        uniqueDates: new Set(),
        uniqueSymbols: new Set(),
      }
      current.rawMatchCount += 1
      if (outcomeHitTarget === true) current.positiveMatchCount += 1
      if (outcomeHitTarget === false) current.negativeMatchCount += 1
      if (row?.dateKey) current.uniqueDates.add(String(row.dateKey))
      if (row?.symbol) current.uniqueSymbols.add(String(row.symbol))
      lookup.set(ruleId, current)
    }
  }
  return lookup
}

const resolveRowDateKey = (row) =>
  toText(row?.dateKey) ?? toText(row?.recommendationDateKey) ?? toText(row?.eventDate)

const resolveFamilyCoverageLookup = ({
  rows,
  familyByRuleId,
  primaryRuleOnly = false,
}) => {
  const coverage = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const rawRuleIds = primaryRuleOnly
      ? [row?.primaryRuleId]
      : Array.isArray(row?.matchedRuleIds)
        ? row.matchedRuleIds
        : []
    const familyIds = uniqueSorted(
      rawRuleIds
        .map((ruleId) => familyByRuleId.get(String(ruleId ?? "").trim()) ?? null)
        .filter(Boolean),
    )
    if (familyIds.length < 1) continue
    const symbol = toText(row?.symbol)
    const dateKey = resolveRowDateKey(row)
    const rowKey = toText(row?.sourceId) ?? `${dateKey ?? "null"}::${symbol ?? "null"}`
    const hit = resolveOutcomeHitTarget(row) === true
    for (const familyId of familyIds) {
      const current = coverage.get(familyId) ?? {
        familyId,
        rowKeys: new Set(),
        hitRowKeys: new Set(),
        uniqueDates: new Set(),
        uniqueSymbols: new Set(),
      }
      current.rowKeys.add(rowKey)
      if (hit) current.hitRowKeys.add(rowKey)
      if (dateKey) current.uniqueDates.add(dateKey)
      if (symbol) current.uniqueSymbols.add(symbol)
      coverage.set(familyId, current)
    }
  }
  return coverage
}

const buildInputStats = async (inputPath) => {
  const rows = await readJsonl(inputPath)
  const positiveRows = rows.filter((row) => resolveOutcomeHitTarget(row) === true)
  const negativeRows = rows.filter((row) => resolveOutcomeHitTarget(row) === false)
  return {
    rows,
    totalRows: rows.length,
    totalPositiveRows: positiveRows.length,
    totalNegativeRows: negativeRows.length,
    uniquePositiveDates: uniqueSorted(positiveRows.map((row) => row?.eventDate ?? row?.dateKey)).length,
    uniquePositiveSymbols: uniqueSorted(positiveRows.map((row) => row?.symbol)).length,
  }
}

const buildConcentrationRows = ({ rows, field, topN }) => {
  const counts = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.[field] ?? "").trim()
    if (!key) continue
    counts.set(key, Number(counts.get(key) ?? 0) + 1)
  }
  const total = Array.from(counts.values()).reduce((sum, value) => sum + Number(value ?? 0), 0)
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      [field]: key,
      matchedRows: count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((left, right) => {
      if (right.matchedRows !== left.matchedRows) return right.matchedRows - left.matchedRows
      return String(left[field]).localeCompare(String(right[field]))
    })
    .slice(0, topN)
}

const sumShares = (rows) =>
  (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + toNumber(row?.share, 0), 0)

const MAX_RECENT_IMPULSE_LOOKBACK_DAYS = 8

const buildRecentImpulseCountFields = ({ summary, prefix }) => {
  const result = {}
  for (let lookback = 1; lookback <= MAX_RECENT_IMPULSE_LOOKBACK_DAYS; lookback += 1) {
    const label = `${lookback}d`
    result[label] = toNumber(summary?.[`${prefix}RecentImpulse${lookback}dCount`], 0)
  }
  return result
}

const buildFlatRecentImpulseFields = ({ prefix, values }) =>
  Object.fromEntries(
    Object.entries(values ?? {}).map(([label, value]) => [
      `${prefix}${label}Count`,
      value,
    ]),
  )

const buildPrecisionBucketLabel = (precision) => {
  if (precision >= 1) return "1.00"
  if (precision >= 0.9) return "[0.90,1.00)"
  if (precision >= 0.8) return "[0.80,0.90)"
  if (precision >= 0.7) return "[0.70,0.80)"
  return "<0.70"
}

const buildPrecisionBucketSummary = (rows) => {
  const buckets = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = buildPrecisionBucketLabel(toNumber(row?.trainPrecision, 0))
    const current = buckets.get(label) ?? {
      bucket: label,
      ruleCount: 0,
      trainHitCount: 0,
      trainMatchCount: 0,
      oosHitCount: 0,
      oosMatchCount: 0,
    }
    current.ruleCount += 1
    current.trainHitCount += toNumber(row?.trainHitCount, 0)
    current.trainMatchCount += toNumber(row?.trainMatchCount, 0)
    current.oosHitCount += toNumber(row?.oosHitCount, 0)
    current.oosMatchCount += toNumber(row?.oosMatchCount, 0)
    buckets.set(label, current)
  }
  return Array.from(buckets.values()).sort((left, right) => String(left.bucket).localeCompare(String(right.bucket)))
}

const buildTrainExactnessDriftSummary = ({ catalogRules, leaderboard, trainBundle, trainCoverageSummary }) => {
  const safeCatalogRules = Array.isArray(catalogRules) ? catalogRules : []
  const safeLeaderboard = Array.isArray(leaderboard) ? leaderboard : []
  const catalogRuleLookup = new Map(
    safeCatalogRules.map((rule) => [String(rule?.ruleId ?? "").trim(), rule]),
  )
  const driftRows = safeLeaderboard
    .map((row) => {
      const catalogRule = catalogRuleLookup.get(String(row?.ruleId ?? "").trim()) ?? {}
      const catalogTrainMatchCount = toNumber(catalogRule?.trainMatchCount, 0)
      const catalogTrainHitCount = toNumber(catalogRule?.trainHitCount, 0)
      const catalogTrainNegativeCount = toNumber(catalogRule?.trainNegativeCount, 0)
      const catalogTrainPrecision = Number.isFinite(Number(catalogRule?.precision))
        ? Number(catalogRule.precision)
        : catalogTrainMatchCount > 0
          ? catalogTrainHitCount / catalogTrainMatchCount
          : 0
      const catalogTrainMaxGapTradingDays = toNumber(catalogRule?.maxGapTradingDays, 0)
      const catalogTrainFirstHitDate = toText(catalogRule?.firstHitDate)
      const catalogTrainLastHitDate = toText(catalogRule?.lastHitDate)
      const catalogTrainMatchedDateCount = toNumber(catalogRule?.matchedDateCount, 0)
      const compareTrainGapSemantics = hasOwn(catalogRule, "maxGapTradingDays")
      const compareTrainFirstHitDate = hasOwn(catalogRule, "firstHitDate")
      const compareTrainLastHitDate = hasOwn(catalogRule, "lastHitDate")
      const compareTrainMatchedDateCount = hasOwn(catalogRule, "matchedDateCount")
      const trainReapplyMatchCount = toNumber(row?.trainMatchCount, 0)
      const trainReapplyHitCount = toNumber(row?.trainHitCount, 0)
      const trainReapplyNegativeCount = toNumber(row?.trainNegativeCount, 0)
      const trainReapplyPrecision =
        trainReapplyMatchCount > 0 ? trainReapplyHitCount / trainReapplyMatchCount : 0
      const trainReapplyMaxGapTradingDays = toNumber(row?.trainMaxGapTradingDays, 0)
      const trainReapplyFirstHitDate = toText(row?.trainFirstHitDate)
      const trainReapplyLastHitDate = toText(row?.trainLastHitDate)
      const trainReapplyMatchedDateCount = toNumber(row?.trainMatchedDateCount, 0)
      const hasCountDrift =
        catalogTrainMatchCount !== trainReapplyMatchCount ||
        catalogTrainHitCount !== trainReapplyHitCount ||
        catalogTrainNegativeCount !== trainReapplyNegativeCount
      const hasGapDrift =
        compareTrainGapSemantics && catalogTrainMaxGapTradingDays !== trainReapplyMaxGapTradingDays
      const hasDateSemanticsDrift =
        (compareTrainFirstHitDate && catalogTrainFirstHitDate !== trainReapplyFirstHitDate) ||
        (compareTrainLastHitDate && catalogTrainLastHitDate !== trainReapplyLastHitDate) ||
        (compareTrainMatchedDateCount && catalogTrainMatchedDateCount !== trainReapplyMatchedDateCount)
      const hasDrift = hasCountDrift || hasGapDrift || hasDateSemanticsDrift
      return {
        ruleId: String(row?.ruleId ?? "").trim(),
        hasDrift,
        hasCountDrift,
        hasGapDrift,
        hasDateSemanticsDrift,
        catalogTrainMatchCount,
        catalogTrainHitCount,
        catalogTrainNegativeCount,
        catalogTrainPrecision,
        catalogTrainMaxGapTradingDays,
        catalogTrainFirstHitDate,
        catalogTrainLastHitDate,
        catalogTrainMatchedDateCount,
        trainReapplyMatchCount,
        trainReapplyHitCount,
        trainReapplyNegativeCount,
        trainReapplyPrecision,
        trainReapplyMaxGapTradingDays,
        trainReapplyFirstHitDate,
        trainReapplyLastHitDate,
        trainReapplyMatchedDateCount,
        trainStatsSource: String(row?.trainStatsSource ?? "catalog_fallback"),
      }
    })
    .filter((row) => row.ruleId)

  const driftOnlyRows = driftRows.filter((row) => row.hasDrift)
  return {
    catalogRuleCount: safeCatalogRules.length,
    catalogExactRuleCount: safeCatalogRules.filter((rule) => toNumber(rule?.trainNegativeCount, 0) === 0).length,
    trainReapplyExactRuleCount: safeLeaderboard.filter((row) => toNumber(row?.trainNegativeCount, 0) === 0).length,
    trainReapplyNegativeRuleCount: safeLeaderboard.filter((row) => toNumber(row?.trainNegativeCount, 0) > 0).length,
    trainCatalogFallbackRuleCount: safeLeaderboard.filter(
      (row) => String(row?.trainStatsSource ?? "catalog_fallback") !== "train_reapply",
    ).length,
    trainExactnessDriftRuleCount: driftOnlyRows.length,
    trainCountDriftRuleCount: driftRows.filter((row) => row.hasCountDrift).length,
    trainGapDriftRuleCount: driftRows.filter((row) => row.hasGapDrift).length,
    trainDateSemanticsDriftRuleCount: driftRows.filter((row) => row.hasDateSemanticsDrift).length,
    trainReapplyMatchedRows: toNumber(trainBundle?.summary?.rawMatches, 0),
    trainReapplyDedupedMatches: toNumber(trainBundle?.summary?.dedupedMatches, 0),
    trainReapplyUniqueMatchedDates: toNumber(trainCoverageSummary?.uniqueMatchedDates, 0),
    trainReapplyUniqueMatchedSymbols: toNumber(trainCoverageSummary?.uniqueMatchedSymbols, 0),
    driftExamples: driftOnlyRows
      .slice()
      .sort((left, right) => {
        if (right.trainReapplyNegativeCount !== left.trainReapplyNegativeCount) {
          return right.trainReapplyNegativeCount - left.trainReapplyNegativeCount
        }
        if (right.trainReapplyMatchCount !== left.trainReapplyMatchCount) {
          return right.trainReapplyMatchCount - left.trainReapplyMatchCount
        }
        return String(left.ruleId).localeCompare(String(right.ruleId))
      })
      .slice(0, 25),
  }
}

const buildApplyCoverageStats = ({ summary, matches, dedupedMatches, inputStats }) => {
  const ruleMatchLookup = buildRuleMatchLookup(matches)
  const matchedRuleCount = new Set(
    (Array.isArray(matches) ? matches : []).flatMap((row) =>
      Array.isArray(row?.matchedRuleIds)
        ? row.matchedRuleIds.map((ruleId) => String(ruleId ?? "").trim()).filter(Boolean)
        : [],
    ),
  ).size
  const zeroNegativeRuleCount = Array.from(ruleMatchLookup.values()).filter(
    (row) => toNumber(row?.positiveMatchCount, 0) > 0 && toNumber(row?.negativeMatchCount, 0) === 0,
  ).length
  const rawMatchedRows = toNumber(summary?.rawMatches, 0)
  const dedupedMatchedRows = toNumber(summary?.dedupedMatches, 0)
  const dedupedMatchedPositiveRows = (Array.isArray(dedupedMatches) ? dedupedMatches : []).filter(
    (row) => resolveOutcomeHitTarget(row) === true,
  ).length
  const lineLevelHitCount = toNumber(summary?.lineLevelHitCount, dedupedMatchedPositiveRows)
  const lineLevelHitRate =
    Number.isFinite(Number(summary?.lineLevelHitRate))
      ? toNumber(summary?.lineLevelHitRate, 0)
      : dedupedMatchedRows > 0
        ? lineLevelHitCount / dedupedMatchedRows
        : 0
  const dedupedPositiveCoverageRate =
    toNumber(inputStats?.totalPositiveRows, 0) > 0
      ? dedupedMatchedPositiveRows / toNumber(inputStats?.totalPositiveRows, 0)
      : 0
  return {
    rawMatchedRows,
    rawMatches: rawMatchedRows,
    dedupedMatchedRows,
    dedupedMatches: dedupedMatchedRows,
    dedupedMatchedPositiveRows,
    lineLevelHitCount,
    lineLevelHitRate,
    dedupedPositiveCoverageRate,
    positiveCoverageRate: dedupedPositiveCoverageRate,
    positiveCoverageRateKind: "deduped_positive_rows_over_total_positive_rows",
    overlapCount: toNumber(summary?.overlapCount, 0),
    uniqueMatchedDates: uniqueSorted((dedupedMatches ?? []).map((row) => row?.dateKey)).length,
    uniqueMatchedSymbols: uniqueSorted((dedupedMatches ?? []).map((row) => row?.symbol)).length,
    matchedRuleCount,
    zeroNegativeRuleCount,
  }
}

const buildRawVsClose28Delta = ({ rawApply, close28Apply }) => ({
  rawApply: {
    ...rawApply,
  },
  close28Apply: {
    ...close28Apply,
  },
  delta: {
    rawMatchDelta: toNumber(rawApply?.rawMatches, 0) - toNumber(close28Apply?.rawMatches, 0),
    dedupedMatchDelta: toNumber(rawApply?.dedupedMatches, 0) - toNumber(close28Apply?.dedupedMatches, 0),
    uniqueMatchedDatesDelta:
      toNumber(rawApply?.uniqueMatchedDates, 0) - toNumber(close28Apply?.uniqueMatchedDates, 0),
    uniqueMatchedSymbolsDelta:
      toNumber(rawApply?.uniqueMatchedSymbols, 0) - toNumber(close28Apply?.uniqueMatchedSymbols, 0),
    matchedRuleDelta: toNumber(rawApply?.matchedRuleCount, 0) - toNumber(close28Apply?.matchedRuleCount, 0),
    zeroNegativeRuleDelta:
      toNumber(rawApply?.zeroNegativeRuleCount, 0) - toNumber(close28Apply?.zeroNegativeRuleCount, 0),
    dedupedPositiveCoverageRateDelta:
      toNumber(rawApply?.dedupedPositiveCoverageRate, 0) - toNumber(close28Apply?.dedupedPositiveCoverageRate, 0),
  },
})

const csvEscape = (value) => {
  const text = String(value ?? "")
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

const buildCoverageSummary = ({ evalSummary, dedupedMatches, inputStats }) => {
  const dedupedMatchedPositiveRows = (Array.isArray(dedupedMatches) ? dedupedMatches : []).filter(
    (row) => resolveOutcomeHitTarget(row) === true,
  ).length
  const rawMatchedRows = toNumber(evalSummary?.rawMatches, 0)
  const dedupedMatchedRows = toNumber(evalSummary?.dedupedMatches, 0)
  const dedupedPositiveCoverageRate =
    toNumber(inputStats?.totalPositiveRows, 0) > 0
      ? dedupedMatchedPositiveRows / toNumber(inputStats?.totalPositiveRows, 0)
      : 0
  return {
    sourceRows: toNumber(evalSummary?.sourceRows, inputStats?.totalRows ?? 0),
    rawMatchedRows,
    matchedRows: rawMatchedRows,
    dedupedMatchedRows,
    dedupedMatches: dedupedMatchedRows,
    uniqueMatchedDates: uniqueSorted((dedupedMatches ?? []).map((row) => row?.dateKey)).length,
    uniqueMatchedSymbols: uniqueSorted((dedupedMatches ?? []).map((row) => row?.symbol)).length,
    totalPositiveRows: toNumber(inputStats?.totalPositiveRows, 0),
    dedupedMatchedPositiveRows,
    matchedPositiveRows: dedupedMatchedPositiveRows,
    dedupedPositiveCoverageRate,
    positiveCoverageRate: dedupedPositiveCoverageRate,
    positiveCoverageRateKind: "deduped_positive_rows_over_total_positive_rows",
  }
}

const resolveSelectionModeIntegrity = ({
  cliSelectionMode,
  trainBundle,
  oosBundle,
  rawApplyBundle,
  close28ApplyBundle,
}) => {
  const selectionModeSources = [
    { source: "cli", selectionMode: normalizeSelectionMode(cliSelectionMode) },
    { source: "train_report", selectionMode: normalizeSelectionMode(trainBundle?.summary?.selectionMode) },
    { source: "oos_report", selectionMode: normalizeSelectionMode(oosBundle?.summary?.selectionMode) },
    { source: "oos_apply_raw", selectionMode: normalizeSelectionMode(rawApplyBundle?.summary?.selectionMode) },
    { source: "oos_apply_close28", selectionMode: normalizeSelectionMode(close28ApplyBundle?.summary?.selectionMode) },
  ]
  const missingSources = selectionModeSources.filter((entry) => !entry.selectionMode)
  if (missingSources.length > 0) {
    throw new Error(
      `Missing selectionMode across Step-B baseline artifacts: ${missingSources
        .map((entry) => entry.source)
        .join(", ")}`,
    )
  }
  const observedSources = selectionModeSources
  const distinctSelectionModes = uniqueSorted(observedSources.map((entry) => entry.selectionMode))
  if (distinctSelectionModes.length > 1) {
    const evidence = observedSources
      .map((entry) => `${entry.source}=${entry.selectionMode}`)
      .join(", ")
    throw new Error(`SelectionMode integrity mismatch across Step-B baseline artifacts: ${evidence}`)
  }
  return {
    resolvedSelectionMode: observedSources[0].selectionMode,
    selectionModeIntegrityOk: true,
    selectionModeSources,
  }
}

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2))
  const catalogPath = path.resolve(String(getFlag(parsed.flags, "catalog", "")).trim())
  const trainInputPath = path.resolve(String(getFlag(parsed.flags, "train-input", "")).trim())
  const trainReportDir = path.resolve(String(getFlag(parsed.flags, "train-report-dir", "")).trim())
  const oosInputPath = path.resolve(String(getFlag(parsed.flags, "oos-input", "")).trim())
  const oosReportDir = path.resolve(String(getFlag(parsed.flags, "oos-report-dir", "")).trim())
  const oosApplyRawDir = path.resolve(String(getFlag(parsed.flags, "oos-apply-raw-dir", "")).trim())
  const oosApplyClose28Dir = path.resolve(String(getFlag(parsed.flags, "oos-apply-close28-dir", "")).trim())
  const outDir = path.resolve(String(getFlag(parsed.flags, "out-dir", "")).trim())
  const runId = String(getFlag(parsed.flags, "run-id", "")).trim() || null
  const splitPolicy = String(getFlag(parsed.flags, "split-policy", "")).trim() || null
  const lineId = String(getFlag(parsed.flags, "line-id", "stepb_dplus1_baseline")).trim() || "stepb_dplus1_baseline"
  const selectionMode = normalizeSelectionMode(getFlag(parsed.flags, "selection-mode", ""))
  const close28FilterPct = toNumber(getFlag(parsed.flags, "close28-filter-pct", ""), null)
  const maxGapTradingDays = toNumber(getFlag(parsed.flags, "max-gap", ""), null)
  const trainStepASummaryPath = toText(getFlag(parsed.flags, "train-step-a-summary", ""))
  const oosStepASummaryPath = toText(getFlag(parsed.flags, "oos-step-a-summary", ""))
  const configPath = toText(getFlag(parsed.flags, "config-path", ""))
  const configSha256 = toText(getFlag(parsed.flags, "config-sha256", ""))
  const trainConfigPath = toText(getFlag(parsed.flags, "train-config-path", ""))
  const trainConfigSha256 = toText(getFlag(parsed.flags, "train-config-sha256", ""))
  const oosConfigPath = toText(getFlag(parsed.flags, "oos-config-path", ""))
  const oosConfigSha256 = toText(getFlag(parsed.flags, "oos-config-sha256", ""))
  const trainStart = String(getFlag(parsed.flags, "train-start", "")).trim() || null
  const trainEnd = String(getFlag(parsed.flags, "train-end", "")).trim() || null
  const oosStart = String(getFlag(parsed.flags, "oos-start", "")).trim() || null
  const oosEnd = String(getFlag(parsed.flags, "oos-end", "")).trim() || null
  const supportCasesFile = toText(getFlag(parsed.flags, "support-cases-file", ""))

  if (
    !catalogPath ||
    !trainInputPath ||
    !trainReportDir ||
    !oosInputPath ||
    !oosReportDir ||
    !oosApplyRawDir ||
    !oosApplyClose28Dir ||
    !outDir
  ) {
    throw new Error(
      "Usage: node tools/report_stepb_dplus1_train_oos_leaderboard.mjs --catalog=<catalog.json> --train-input=<templates_lite.jsonl> --train-report-dir=<dir> --oos-input=<templates_lite.jsonl> --oos-report-dir=<dir> --oos-apply-raw-dir=<dir> --oos-apply-close28-dir=<dir> --out-dir=<dir> [--run-id=<run_id>] [--split-policy=<policy>] [--line-id=<line>] [--selection-mode=<mode>] [--close28-filter-pct=<pct>] [--train-start=YYYY-MM-DD] [--train-end=YYYY-MM-DD] [--oos-start=YYYY-MM-DD] [--oos-end=YYYY-MM-DD] [--support-cases-file=<support_cases.json>]",
    )
  }
  const supportCasesPayload = supportCasesFile ? await readJson(path.resolve(supportCasesFile), null) : null
  const supportCases = normalizePerfectPrototypeSupportCases(
    Array.isArray(supportCasesPayload?.supportCases)
      ? supportCasesPayload.supportCases
      : Array.isArray(supportCasesPayload?.cases)
        ? supportCasesPayload.cases
        : [],
  )
  if (supportCasesFile && supportCases.length < 1) {
    throw new Error(`support-cases-file resolved zero support cases: ${supportCasesFile}`)
  }
  if (STEPB_DPLUS1_NO_GAP_LINE_IDS.has(lineId) && Number.isFinite(maxGapTradingDays) && maxGapTradingDays !== 100000) {
    throw new Error(`${lineId} must use maxGapTradingDays=100000, got ${maxGapTradingDays}`)
  }

  const catalog = await loadPerfectPrototypeCatalog(catalogPath)
  const catalogSurface = toText(catalog?.tokenizerSpec?.surface ?? catalog?.metadata?.surfaceName)
  if (
    lineId === "stepb_dplus1_plus_lite_lane_local" &&
    String(catalogSurface ?? "").trim().toLowerCase() !== "v5_contextual_plus_lite_lane_local_pool8"
  ) {
    throw new Error(
      `stepb_dplus1_plus_lite_lane_local requires v5_contextual_plus_lite_lane_local_pool8, got ${catalogSurface ?? "null"}`,
    )
  }
  if (
    lineId === PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID &&
    String(catalogSurface ?? "").trim().toLowerCase() !==
      PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE
  ) {
    throw new Error(
      `${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID} requires ${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE}, got ${catalogSurface ?? "null"}`,
    )
  }
  if (lineId === PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID) {
    const catalogSelectionLineId = toText(catalog?.metadata?.selectionLineId)
    const catalogSelectionSurface = toText(catalog?.metadata?.selectionSurface)
    const catalogSelectionAllowedFamilyIds = uniqueSorted(catalog?.metadata?.selectionAllowedFamilyIds)
    const catalogSelectionContractId = toText(catalog?.metadata?.selectionContractId)
    const catalogSelectionDiscoveryUniverseId = toText(catalog?.metadata?.selectionDiscoveryUniverseId)
    const catalogSelectionManifestPath = toText(catalog?.metadata?.selectionManifestPath)
    const catalogSelectionIntent = toText(catalog?.metadata?.selectionIntent)
    const catalogSelectionProfileId = toText(catalog?.metadata?.selectionProfileId)
    const isCuratedSelectionCatalog =
      (Array.isArray(catalog?.metadata?.curatedRuleIds) && catalog.metadata.curatedRuleIds.length > 0) ||
      Number(catalog?.metadata?.curatedRuleCount ?? 0) > 0 ||
      !!toText(catalog?.metadata?.sourceCatalogPath)
    const hasSelectionMetadata =
      !!catalogSelectionLineId ||
      !!catalogSelectionSurface ||
      !!catalogSelectionContractId ||
      !!catalogSelectionManifestPath ||
      !!catalogSelectionDiscoveryUniverseId ||
      catalogSelectionAllowedFamilyIds.length > 0
    const requiresSelectionMetadata =
      isCuratedSelectionCatalog || hasSelectionMetadata || !!catalogSelectionIntent || !!catalogSelectionProfileId
    if (requiresSelectionMetadata && !catalogSelectionLineId) {
      throw new Error("recent_mid_low curated catalog requires selectionLineId.")
    }
    if (requiresSelectionMetadata && !catalogSelectionSurface) {
      throw new Error("recent_mid_low curated catalog requires selectionSurface.")
    }
    if (requiresSelectionMetadata && !catalogSelectionContractId) {
      throw new Error("recent_mid_low curated catalog requires selectionContractId.")
    }
    if (requiresSelectionMetadata && !catalogSelectionDiscoveryUniverseId) {
      throw new Error("recent_mid_low curated catalog requires selectionDiscoveryUniverseId.")
    }
    if (requiresSelectionMetadata && !catalogSelectionManifestPath) {
      throw new Error("recent_mid_low curated catalog requires selectionManifestPath.")
    }
    if (requiresSelectionMetadata && catalogSelectionAllowedFamilyIds.length < 1) {
      throw new Error("recent_mid_low curated catalog requires selectionAllowedFamilyIds.")
    }
    if (requiresSelectionMetadata && catalogSelectionLineId !== lineId) {
      throw new Error(
        `recent_mid_low catalog selectionLineId mismatch: expected ${lineId}, got ${catalogSelectionLineId}`,
      )
    }
    if (
      requiresSelectionMetadata &&
      String(catalogSelectionSurface ?? "").trim().toLowerCase() !==
        PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE
    ) {
      throw new Error(
        `recent_mid_low catalog selectionSurface mismatch: expected ${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_SURFACE}, got ${catalogSelectionSurface}`,
      )
    }
    if (
      requiresSelectionMetadata &&
      !PERFECT_PROTOTYPE_RECENT_ONLY_ALLOWED_SELECTION_CONTRACT_IDS.has(catalogSelectionContractId)
    ) {
      throw new Error(
        [
          "recent_mid_low catalog selectionContractId mismatch:",
          `expected one of ${Array.from(PERFECT_PROTOTYPE_RECENT_ONLY_ALLOWED_SELECTION_CONTRACT_IDS).join(", ")}`,
          `got ${catalogSelectionContractId}`,
        ].join(" "),
      )
    }
    if (
      requiresSelectionMetadata &&
      catalogSelectionDiscoveryUniverseId !== PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_DISCOVERY_UNIVERSE_ID
    ) {
      throw new Error(
        `recent_mid_low catalog selectionDiscoveryUniverseId mismatch: expected ${PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_DISCOVERY_UNIVERSE_ID}, got ${catalogSelectionDiscoveryUniverseId}`,
      )
    }
    const catalogFamilyIds = uniqueSorted(
      (Array.isArray(catalog?.rules) ? catalog.rules : []).map((rule) => toText(rule?.familyId) ?? "unclassified"),
    )
    const disallowedCatalogFamilyIds = catalogFamilyIds.filter(
      (familyId) =>
        catalogSelectionContractId === PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID
          ? !PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS.includes(familyId)
          : catalogSelectionContractId === PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID
            ? familyId !== PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION
          : !PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.includes(familyId),
    )
    if (disallowedCatalogFamilyIds.length > 0) {
      throw new Error(
        [
          catalogSelectionContractId === PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID
            ? "stepb_dplus1_plus_lite_recent_mid_low low-bundle catalog contains disallowed families:"
            : "stepb_dplus1_plus_lite_recent_mid_low catalog contains disallowed families:",
          disallowedCatalogFamilyIds.join(", "),
        ].join(" "),
      )
    }
    const disallowedSelectionFamilyIds = catalogSelectionAllowedFamilyIds.filter(
      (familyId) =>
        catalogSelectionContractId === PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID
          ? !PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS.includes(familyId)
          : catalogSelectionContractId === PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID
            ? familyId !== PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION
          : !PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.includes(familyId),
    )
    if (disallowedSelectionFamilyIds.length > 0) {
      throw new Error(
        [
          catalogSelectionContractId === PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID
            ? "stepb_dplus1_plus_lite_recent_mid_low low-bundle catalog metadata contains disallowed selectionAllowedFamilyIds:"
            : "stepb_dplus1_plus_lite_recent_mid_low catalog metadata contains disallowed selectionAllowedFamilyIds:",
          disallowedSelectionFamilyIds.join(", "),
        ].join(" "),
      )
    }
  }
  const [
    trainBundle,
    oosBundle,
    trainInputStats,
    oosInputStats,
    rawApplyBundle,
    close28ApplyBundle,
    trainStepBSummary,
    oosStepBSummary,
    trainStepASummary,
    oosStepASummary,
  ] =
    await Promise.all([
      readEvaluationBundle(trainReportDir),
      readEvaluationBundle(oosReportDir),
      buildInputStats(trainInputPath),
      buildInputStats(oosInputPath),
      readApplyBundle(oosApplyRawDir),
      readApplyBundle(oosApplyClose28Dir),
      readStepBSummaryForInput(trainInputPath),
      readStepBSummaryForInput(oosInputPath),
      trainStepASummaryPath ? readOptionalJson(trainStepASummaryPath) : Promise.resolve(null),
      oosStepASummaryPath ? readOptionalJson(oosStepASummaryPath) : Promise.resolve(null),
    ])
  const expectedCatalogSha256 = toText(catalog?.freeze?.catalogContentSha256)
  const expectedRuleIdsSha256 = toText(catalog?.freeze?.ruleIdsSha256)
  assertBundleCountConsistency({
    label: "train_report",
    summary: trainBundle?.summary,
    matches: trainBundle?.matches,
    dedupedMatches: trainBundle?.dedupedMatches,
  })
  assertBundleCountConsistency({
    label: "oos_report",
    summary: oosBundle?.summary,
    matches: oosBundle?.matches,
    dedupedMatches: oosBundle?.dedupedMatches,
  })
  assertBundleCountConsistency({
    label: "oos_apply_raw",
    summary: rawApplyBundle?.summary,
    matches: rawApplyBundle?.matches,
    dedupedMatches: rawApplyBundle?.dedupedMatches,
  })
  assertBundleCountConsistency({
    label: "oos_apply_close28",
    summary: close28ApplyBundle?.summary,
    matches: close28ApplyBundle?.matches,
    dedupedMatches: close28ApplyBundle?.dedupedMatches,
  })
  assertArtifactHashConsistency({
    label: "train_report",
    summary: trainBundle?.summary,
    expectedCatalogSha256,
    expectedRuleIdsSha256,
  })
  assertArtifactHashConsistency({
    label: "oos_report",
    summary: oosBundle?.summary,
    expectedCatalogSha256,
    expectedRuleIdsSha256,
  })
  assertArtifactHashConsistency({
    label: "oos_apply_raw",
    summary: rawApplyBundle?.summary,
    expectedCatalogSha256,
    expectedRuleIdsSha256,
  })
  assertArtifactHashConsistency({
    label: "oos_apply_close28",
    summary: close28ApplyBundle?.summary,
    expectedCatalogSha256,
    expectedRuleIdsSha256,
  })
  const {
    resolvedSelectionMode,
    selectionModeIntegrityOk,
    selectionModeSources,
  } = resolveSelectionModeIntegrity({
    cliSelectionMode: selectionMode,
    trainBundle,
    oosBundle,
    rawApplyBundle,
    close28ApplyBundle,
  })

  const trainReportLookup = buildRuleReportLookup(trainBundle.ruleReport)
  const oosReportLookup = buildRuleReportLookup(oosBundle.ruleReport)
  const trainMatchLookup = buildRuleMatchLookup(trainBundle.matches)
  const oosMatchLookup = buildRuleMatchLookup(oosBundle.matches)

  const leaderboard = (Array.isArray(catalog?.rules) ? catalog.rules : [])
    .map((rule) => {
      const ruleId = String(rule?.ruleId ?? "").trim()
      const supportEvaluation = evaluatePerfectPrototypeRuleSupportCases({
        rule,
        supportCases,
      })
      const trainStat = trainReportLookup.get(ruleId) ?? {}
      const oosStat = oosReportLookup.get(ruleId) ?? {}
      const trainMatchStat = trainMatchLookup.get(ruleId) ?? null
      const oosMatchStat = oosMatchLookup.get(ruleId) ?? null
      const hasTrainReapplyStat = trainReportLookup.has(ruleId)
      const catalogTrainMatchCount = toNumber(rule?.trainMatchCount, 0)
      const catalogTrainHitCount = toNumber(rule?.trainHitCount, 0)
      const catalogTrainNegativeCount = toNumber(rule?.trainNegativeCount, 0)
      const catalogTrainPrecision = Number.isFinite(Number(rule?.precision))
        ? Number(rule.precision)
        : catalogTrainMatchCount > 0
          ? catalogTrainHitCount / catalogTrainMatchCount
          : 0
      const catalogTrainMaxGapTradingDays = toNumber(rule?.maxGapTradingDays, 0)
      const catalogTrainFirstHitDate = toText(rule?.firstHitDate)
      const catalogTrainLastHitDate = toText(rule?.lastHitDate)
      const catalogTrainMatchedDateCount = toNumber(rule?.matchedDateCount, 0)
      const compareTrainGapSemantics = hasOwn(rule, "maxGapTradingDays")
      const compareTrainFirstHitDate = hasOwn(rule, "firstHitDate")
      const compareTrainLastHitDate = hasOwn(rule, "lastHitDate")
      const compareTrainMatchedDateCount = hasOwn(rule, "matchedDateCount")
      const trainStatsSource = hasTrainReapplyStat ? "train_reapply" : "catalog_fallback"
      const trainReapplyMatchCount = hasTrainReapplyStat
        ? toNumber(trainStat?.oosMatchCount, catalogTrainMatchCount)
        : catalogTrainMatchCount
      const trainReapplyHitCount = hasTrainReapplyStat
        ? toNumber(trainStat?.oosHitCount, catalogTrainHitCount)
        : catalogTrainHitCount
      const trainReapplyNegativeCount = hasTrainReapplyStat
        ? toNumber(trainStat?.oosNegativeCount, catalogTrainNegativeCount)
        : catalogTrainNegativeCount
      const trainReapplyPrecision = Number.isFinite(Number(trainStat?.oosPrecision))
        ? Number(trainStat.oosPrecision)
        : trainReapplyMatchCount > 0
          ? trainReapplyHitCount / trainReapplyMatchCount
          : catalogTrainPrecision
      const trainMaxGapTradingDays = hasTrainReapplyStat
        ? toNumber(trainStat?.oosMaxGapTradingDays, catalogTrainMaxGapTradingDays)
        : catalogTrainMaxGapTradingDays
      const trainFirstHitDate = hasTrainReapplyStat
        ? toText(trainStat?.oosFirstHitDate) ?? catalogTrainFirstHitDate
        : catalogTrainFirstHitDate
      const trainLastHitDate = hasTrainReapplyStat
        ? toText(trainStat?.oosLastHitDate) ?? catalogTrainLastHitDate
        : catalogTrainLastHitDate
      const trainMatchedDateCount = hasTrainReapplyStat
        ? toNumber(trainStat?.oosMatchedDateCount, catalogTrainMatchedDateCount)
        : catalogTrainMatchedDateCount
      const trainCountDrift =
        catalogTrainMatchCount !== trainReapplyMatchCount ||
        catalogTrainHitCount !== trainReapplyHitCount ||
        catalogTrainNegativeCount !== trainReapplyNegativeCount
      const trainGapDrift =
        compareTrainGapSemantics && catalogTrainMaxGapTradingDays !== trainMaxGapTradingDays
      const trainDateSemanticsDrift =
        (compareTrainFirstHitDate && catalogTrainFirstHitDate !== trainFirstHitDate) ||
        (compareTrainLastHitDate && catalogTrainLastHitDate !== trainLastHitDate) ||
        (compareTrainMatchedDateCount && catalogTrainMatchedDateCount !== trainMatchedDateCount)
      const oosUniqueMatchedDates = (oosMatchStat?.uniqueDates ?? new Set()).size
      const oosUniqueMatchedSymbols = (oosMatchStat?.uniqueSymbols ?? new Set()).size
      const trainUniqueMatchedDates = (trainMatchStat?.uniqueDates ?? new Set()).size
      const trainUniqueMatchedSymbols = (trainMatchStat?.uniqueSymbols ?? new Set()).size
      return {
        ruleId,
        familyId: toText(rule?.familyId) ?? "unclassified",
        tokens: Array.isArray(rule?.tokens) ? rule.tokens : [],
        trainStatsSource,
        catalogTrainMatchCount,
        catalogTrainHitCount,
        catalogTrainNegativeCount,
        catalogTrainPrecision,
        catalogTrainMaxGapTradingDays,
        catalogTrainFirstHitDate,
        catalogTrainLastHitDate,
        catalogTrainMatchedDateCount,
        trainMatchCount: trainReapplyMatchCount,
        trainHitCount: trainReapplyHitCount,
        trainNegativeCount: trainReapplyNegativeCount,
        trainPrecision: trainReapplyPrecision,
        trainMaxGapTradingDays,
        trainFirstHitDate,
        trainLastHitDate,
        trainMatchedDateCount,
        trainMatchedMonthCount: toNumber(rule?.matchedMonthCount, 0),
        trainMatchedFoldCount: toNumber(rule?.matchedFoldCount, 0),
        trainCountDrift,
        trainGapDrift,
        trainDateSemanticsDrift,
        trainExactnessDrift: trainCountDrift || trainGapDrift || trainDateSemanticsDrift,
        oosMatchCount: toNumber(oosStat?.oosMatchCount, 0),
        oosHitCount: toNumber(oosStat?.oosHitCount, 0),
        oosNegativeCount: toNumber(oosStat?.oosNegativeCount, 0),
        oosPrecision: toNumber(oosStat?.oosPrecision, 0),
        oosMaxGapTradingDays: toNumber(oosStat?.oosMaxGapTradingDays, 0),
        oosFirstHitDate: toText(oosStat?.oosFirstHitDate),
        oosLastHitDate: toText(oosStat?.oosLastHitDate),
        oosMatchedDateCount: toNumber(oosStat?.oosMatchedDateCount, 0),
        trainUniqueMatchedDates,
        trainUniqueMatchedSymbols,
        oosUniqueMatchedDates,
        oosUniqueMatchedSymbols,
        rawMatchedRows: toNumber(oosMatchStat?.rawMatchCount, 0),
        oosZeroNegative: toNumber(oosStat?.oosMatchCount, 0) > 0 && toNumber(oosStat?.oosNegativeCount, 0) === 0,
        matchesSupportCases: supportEvaluation.matchesSupportCases,
        supportCaseIds: supportEvaluation.supportCaseIds,
        supportCaseCount: supportEvaluation.supportCaseCount,
        haesungSupport: supportEvaluation.haesungSupport,
      }
    })
    .sort((left, right) => {
      if (right.trainPrecision !== left.trainPrecision) return right.trainPrecision - left.trainPrecision
      if (right.trainHitCount !== left.trainHitCount) return right.trainHitCount - left.trainHitCount
      if (right.trainMatchCount !== left.trainMatchCount) return right.trainMatchCount - left.trainMatchCount
      return String(left.ruleId).localeCompare(String(right.ruleId))
    })

  const familyByRuleId = new Map(
    (Array.isArray(catalog?.rules) ? catalog.rules : []).map((rule) => [
      String(rule?.ruleId ?? "").trim(),
      toText(rule?.familyId) ?? "unclassified",
    ]),
  )
  const familyRawApplyCoverage = resolveFamilyCoverageLookup({
    rows: rawApplyBundle?.matches,
    familyByRuleId,
  })
  const familyClose28ApplyCoverage = resolveFamilyCoverageLookup({
    rows: close28ApplyBundle?.matches,
    familyByRuleId,
  })
  const familyClose28DedupedCoverage = resolveFamilyCoverageLookup({
    rows: close28ApplyBundle?.dedupedMatches,
    familyByRuleId,
  })
  const familyFinalSelectedProxyCoverage = resolveFamilyCoverageLookup({
    rows: close28ApplyBundle?.dedupedMatches,
    familyByRuleId,
    primaryRuleOnly: true,
  })

  const familySummary = Array.from(
    leaderboard.reduce((acc, row) => {
      const familyId = toText(row?.familyId) ?? "unclassified"
      const current = acc.get(familyId) ?? {
        familyId,
        ruleCount: 0,
        trainHitCount: 0,
        trainMatchCount: 0,
        trainMatchedDateCount: 0,
        oosHitCount: 0,
        oosMatchCount: 0,
        oosMatchedRules: 0,
      }
      current.ruleCount += 1
      current.trainHitCount += toNumber(row?.trainHitCount, 0)
      current.trainMatchCount += toNumber(row?.trainMatchCount, 0)
      current.trainMatchedDateCount += toNumber(row?.trainMatchedDateCount, 0)
      current.oosHitCount += toNumber(row?.oosHitCount, 0)
      current.oosMatchCount += toNumber(row?.oosMatchCount, 0)
      if (toNumber(row?.oosMatchCount, 0) > 0) current.oosMatchedRules += 1
      acc.set(familyId, current)
      return acc
    }, new Map()).values(),
  )
    .map((row) => ({
      ...row,
      trainPrecision: row.trainMatchCount > 0 ? row.trainHitCount / row.trainMatchCount : 0,
      oosPrecision: row.oosMatchCount > 0 ? row.oosHitCount / row.oosMatchCount : 0,
      rawApplyMatchedRows: familyRawApplyCoverage.get(row.familyId)?.rowKeys?.size ?? 0,
      rawApplyHitRows: familyRawApplyCoverage.get(row.familyId)?.hitRowKeys?.size ?? 0,
      rawApplyUniqueDates: familyRawApplyCoverage.get(row.familyId)?.uniqueDates?.size ?? 0,
      rawApplyUniqueSymbols: familyRawApplyCoverage.get(row.familyId)?.uniqueSymbols?.size ?? 0,
      close28MatchedRows: familyClose28ApplyCoverage.get(row.familyId)?.rowKeys?.size ?? 0,
      close28HitRows: familyClose28ApplyCoverage.get(row.familyId)?.hitRowKeys?.size ?? 0,
      close28UniqueDates: familyClose28ApplyCoverage.get(row.familyId)?.uniqueDates?.size ?? 0,
      close28UniqueSymbols: familyClose28ApplyCoverage.get(row.familyId)?.uniqueSymbols?.size ?? 0,
      close28DedupedRows: familyClose28DedupedCoverage.get(row.familyId)?.rowKeys?.size ?? 0,
      close28DedupedHitRows: familyClose28DedupedCoverage.get(row.familyId)?.hitRowKeys?.size ?? 0,
      close28DedupedUniqueDates: familyClose28DedupedCoverage.get(row.familyId)?.uniqueDates?.size ?? 0,
      close28DedupedUniqueSymbols: familyClose28DedupedCoverage.get(row.familyId)?.uniqueSymbols?.size ?? 0,
      finalSelectedProxyRows: familyFinalSelectedProxyCoverage.get(row.familyId)?.rowKeys?.size ?? 0,
      finalSelectedProxyHitRows: familyFinalSelectedProxyCoverage.get(row.familyId)?.hitRowKeys?.size ?? 0,
      finalSelectedProxyUniqueDates: familyFinalSelectedProxyCoverage.get(row.familyId)?.uniqueDates?.size ?? 0,
      finalSelectedProxyUniqueSymbols:
        familyFinalSelectedProxyCoverage.get(row.familyId)?.uniqueSymbols?.size ?? 0,
    }))
    .map((row) => ({
      ...row,
      rawApplyPrecision: row.rawApplyMatchedRows > 0 ? row.rawApplyHitRows / row.rawApplyMatchedRows : 0,
      close28Precision: row.close28MatchedRows > 0 ? row.close28HitRows / row.close28MatchedRows : 0,
      close28DedupedPrecision:
        row.close28DedupedRows > 0 ? row.close28DedupedHitRows / row.close28DedupedRows : 0,
      finalSelectedProxyPrecision:
        row.finalSelectedProxyRows > 0 ? row.finalSelectedProxyHitRows / row.finalSelectedProxyRows : 0,
    }))
    .sort((left, right) => {
      if (right.finalSelectedProxyPrecision !== left.finalSelectedProxyPrecision) {
        return right.finalSelectedProxyPrecision - left.finalSelectedProxyPrecision
      }
      if (right.finalSelectedProxyRows !== left.finalSelectedProxyRows) {
        return right.finalSelectedProxyRows - left.finalSelectedProxyRows
      }
      if (right.close28Precision !== left.close28Precision) return right.close28Precision - left.close28Precision
      if (right.oosPrecision !== left.oosPrecision) return right.oosPrecision - left.oosPrecision
      if (right.oosHitCount !== left.oosHitCount) return right.oosHitCount - left.oosHitCount
      return String(left.familyId).localeCompare(String(right.familyId))
    })
  const recentLowBundleCandidateRuleIds =
    lineId === PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID
      ? leaderboard
          .filter((row) => PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_FAMILY_IDS.includes(String(row?.familyId ?? "").trim()))
          .map((row) => String(row?.ruleId ?? "").trim())
          .filter(Boolean)
      : []
  const recentLowBundleCandidate =
    lineId === PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID && recentLowBundleCandidateRuleIds.length > 0
      ? (() => {
          const candidate = selectRecentLowShadowBundleCandidate({
            rows: close28ApplyBundle?.dedupedMatches,
            candidateRuleIds: recentLowBundleCandidateRuleIds,
          })
          const leaderboardLookup = new Map(
            leaderboard.map((row) => [String(row?.ruleId ?? "").trim(), row]),
          )
          return {
            contractId: PERFECT_PROTOTYPE_RECENT_ONLY_LOW_BUNDLE_CONTRACT_ID,
            candidateRuleIds: candidate.candidateRuleIds,
            selectedRuleIds: candidate.selectedRuleIds,
            selectedFamilyIds: uniqueSorted(
              candidate.selectedRuleIds
                .map((ruleId) => familyByRuleId.get(String(ruleId ?? "").trim()) ?? null)
                .filter(Boolean),
            ),
            metrics: candidate.metrics,
            promotable: candidate.promotable,
            rejectReasons: candidate.rejectReasons,
            perRuleMetrics: candidate.perRuleMetrics.map((metrics) => {
              const ruleId = String(metrics?.ruleIds?.[0] ?? "").trim()
              const leaderboardRow = leaderboardLookup.get(ruleId) ?? null
              return {
                ruleId,
                familyId: toText(leaderboardRow?.familyId) ?? "unclassified",
                selectedRows: toNumber(metrics?.selectedRows, 0),
                hitRows: toNumber(metrics?.hitRows, 0),
                hitRate: toNumber(metrics?.hitRate, 0),
                uniqueDateCount: toNumber(metrics?.uniqueDateCount, 0),
                top1DateShare: toNumber(metrics?.top1DateShare, 0),
                openOosHitCount: toNumber(leaderboardRow?.oosHitCount, 0),
                openOosMatchCount: toNumber(leaderboardRow?.oosMatchCount, 0),
                openOosPrecision: toNumber(leaderboardRow?.oosPrecision, 0),
                openOosUniqueMatchedDates: toNumber(leaderboardRow?.oosUniqueMatchedDates, 0),
                close28MatchedRows: toNumber(metrics?.selectedRows, 0),
              }
            }),
          }
        })()
      : null
  const haesungLowGapTopOos100Candidates =
    lineId === PERFECT_PROTOTYPE_RECENT_ONLY_SELECTION_LINE_ID
      ? leaderboard.filter(
          (row) =>
            String(row?.familyId ?? "").trim() === PERFECT_PROTOTYPE_RULE_FAMILY_LOW_GAP_TOP_CONTINUATION &&
            row?.haesungSupport === true &&
            toNumber(row?.oosPrecision, 0) >= 1 &&
            toNumber(row?.oosMatchCount, 0) >= 3 &&
            toNumber(row?.oosUniqueMatchedDates, 0) >= 3 &&
            toNumber(row?.trainMatchedMonthCount, 0) >= 4 &&
            toNumber(row?.trainMatchedFoldCount, 0) >= 4,
        )
      : []

  const trainCoverageSummary = buildCoverageSummary({
    evalSummary: trainBundle.summary,
    dedupedMatches: trainBundle.dedupedMatches,
    inputStats: trainInputStats,
  })
  const oosCoverageSummary = buildCoverageSummary({
    evalSummary: oosBundle.summary,
    dedupedMatches: oosBundle.dedupedMatches,
    inputStats: oosInputStats,
  })

  const dateConcentration = buildConcentrationRows({
    rows: oosBundle.dedupedMatches,
    field: "dateKey",
    topN: 50,
  })
  const symbolConcentration = buildConcentrationRows({
    rows: oosBundle.dedupedMatches,
    field: "symbol",
    topN: 50,
  })
  const overlapRows = (Array.isArray(oosBundle.matches) ? oosBundle.matches : [])
    .filter((row) => Array.isArray(row?.matchedRuleIds) && row.matchedRuleIds.length > 1)
    .map((row) => ({
      dateKey: row.dateKey,
      symbol: row.symbol,
      outcomeHitTarget: row.outcomeHitTarget,
      matchedRuleIds: row.matchedRuleIds,
      matchedRuleCount: row.matchedRuleIds.length,
    }))

  const oosCollapseLeaderboard = leaderboard
    .map((row) => ({
      ...row,
      oosPrecisionDelta: toNumber(row?.oosPrecision, 0) - toNumber(row?.trainPrecision, 0),
      oosHitDelta: toNumber(row?.oosHitCount, 0) - toNumber(row?.trainHitCount, 0),
    }))
    .sort((left, right) => {
      if (left.oosPrecisionDelta !== right.oosPrecisionDelta) return left.oosPrecisionDelta - right.oosPrecisionDelta
      if (left.oosHitDelta !== right.oosHitDelta) return left.oosHitDelta - right.oosHitDelta
      return String(left.ruleId).localeCompare(String(right.ruleId))
    })

  const precisionBucketSummary = buildPrecisionBucketSummary(leaderboard)
  const rawApplyCoverage = buildApplyCoverageStats({
    summary: rawApplyBundle?.summary,
    matches: rawApplyBundle?.matches,
    dedupedMatches: rawApplyBundle?.dedupedMatches,
    inputStats: oosInputStats,
  })
  const close28ApplyCoverage = {
    ...buildApplyCoverageStats({
      summary: close28ApplyBundle?.summary,
      matches: close28ApplyBundle?.matches,
      dedupedMatches: close28ApplyBundle?.dedupedMatches,
      inputStats: oosInputStats,
    }),
    removedRawMatches: toNumber(close28ApplyBundle?.summary?.recommendationDateCloseRetFilter?.removedRawMatches, 0),
    removedHitMatches: toNumber(close28ApplyBundle?.summary?.recommendationDateCloseRetFilter?.removedHitMatches, 0),
    removedNegativeMatches: toNumber(
      close28ApplyBundle?.summary?.recommendationDateCloseRetFilter?.removedNegativeMatches,
      0,
    ),
  }
  const rawVsClose28Delta = buildRawVsClose28Delta({
    rawApply: rawApplyCoverage,
    close28Apply: close28ApplyCoverage,
  })
  const trainExactnessDriftSummary = buildTrainExactnessDriftSummary({
    catalogRules: catalog?.rules,
    leaderboard,
    trainBundle,
    trainCoverageSummary,
  })
  const baselineExactnessClaimable =
    toNumber(trainExactnessDriftSummary?.trainExactnessDriftRuleCount, 0) === 0 &&
    toNumber(trainExactnessDriftSummary?.trainCatalogFallbackRuleCount, 0) === 0
  const baselineArtifactIntegrityClaimable =
    baselineExactnessClaimable &&
    selectionModeIntegrityOk &&
    Boolean(expectedCatalogSha256) &&
    Boolean(expectedRuleIdsSha256)

  const oosGuardrailSummary = {
    ruleCount: leaderboard.length,
    familyCount: familySummary.length,
    rawMatchedRows: toNumber(oosBundle.summary?.rawMatches, 0),
    matchedRows: toNumber(oosBundle.summary?.rawMatches, 0),
    dedupedMatchedRows: toNumber(oosBundle.summary?.dedupedMatches, 0),
    dedupedMatches: toNumber(oosBundle.summary?.dedupedMatches, 0),
    close28SelectedRows: toNumber(close28ApplyCoverage?.dedupedMatchedRows, 0),
    close28HitRows: toNumber(close28ApplyCoverage?.lineLevelHitCount, 0),
    lineLevelHitCount: toNumber(close28ApplyCoverage?.lineLevelHitCount, 0),
    lineLevelHitRate: toNumber(close28ApplyCoverage?.lineLevelHitRate, 0),
    uniqueMatchedDates: oosCoverageSummary.uniqueMatchedDates,
    uniqueMatchedSymbols: oosCoverageSummary.uniqueMatchedSymbols,
    dedupedMatchedPositiveRows: oosCoverageSummary.dedupedMatchedPositiveRows,
    dedupedPositiveCoverageRate: oosCoverageSummary.dedupedPositiveCoverageRate,
    positiveCoverageRate: oosCoverageSummary.positiveCoverageRate,
    positiveCoverageRateKind: oosCoverageSummary.positiveCoverageRateKind,
    oosMatchedRules: leaderboard.filter((row) => toNumber(row?.oosMatchCount, 0) > 0).length,
    oosZeroNegativeRules: leaderboard.filter((row) => row.oosZeroNegative === true).length,
    oosHit2ZeroNegativeRules: leaderboard.filter(
      (row) => row.oosZeroNegative === true && toNumber(row?.oosHitCount, 0) >= 2,
    ).length,
    oosHit3ZeroNegativeRules: leaderboard.filter(
      (row) => row.oosZeroNegative === true && toNumber(row?.oosHitCount, 0) >= 3,
    ).length,
    top1DateShare: toNumber(dateConcentration[0]?.share, 0),
    top5DateShare: sumShares(dateConcentration.slice(0, 5)),
    top1SymbolShare: toNumber(symbolConcentration[0]?.share, 0),
    top10SymbolShare: sumShares(symbolConcentration.slice(0, 10)),
    selectionMode: resolvedSelectionMode,
    selectionModeIntegrityOk,
    baselineExactnessClaimable,
    baselineArtifactIntegrityClaimable,
    trainExactnessDriftRuleCount: toNumber(trainExactnessDriftSummary?.trainExactnessDriftRuleCount, 0),
    trainCatalogFallbackRuleCount: toNumber(trainExactnessDriftSummary?.trainCatalogFallbackRuleCount, 0),
    overlapRate:
      toNumber(oosBundle.summary?.rawMatches, 0) > 0
        ? overlapRows.length / toNumber(oosBundle.summary?.rawMatches, 1)
        : 0,
    recentLowBundlePromotable: recentLowBundleCandidate?.promotable ?? null,
    recentLowBundleRuleCount: toNumber(recentLowBundleCandidate?.metrics?.ruleCount, 0),
    recentLowBundleSelectedRows: toNumber(recentLowBundleCandidate?.metrics?.selectedRows, 0),
    recentLowBundleHitRows: toNumber(recentLowBundleCandidate?.metrics?.hitRows, 0),
    recentLowBundleHitRate: toNumber(recentLowBundleCandidate?.metrics?.hitRate, 0),
    recentLowBundleUniqueDates: toNumber(recentLowBundleCandidate?.metrics?.uniqueDateCount, 0),
    recentLowBundleTop1DateShare: toNumber(recentLowBundleCandidate?.metrics?.top1DateShare, 0),
    recentLowBundleRejectReasons: recentLowBundleCandidate?.rejectReasons ?? [],
  }

  const trainRecentImpulseCandidateCounts = buildRecentImpulseCountFields({
    summary: trainStepASummary,
    prefix: "candidate",
  })
  const trainRecentImpulsePassedCounts = buildRecentImpulseCountFields({
    summary: trainStepASummary,
    prefix: "passed",
  })
  const oosRecentImpulseCandidateCounts = buildRecentImpulseCountFields({
    summary: oosStepASummary,
    prefix: "candidate",
  })
  const oosRecentImpulsePassedCounts = buildRecentImpulseCountFields({
    summary: oosStepASummary,
    prefix: "passed",
  })

  const recentImpulseGuardrailSummary = {
    lineId,
    recentImpulseDiscovery: trainStepASummary?.recentImpulseDiscovery ?? oosStepASummary?.recentImpulseDiscovery ?? null,
    trainStepASummaryPath,
    oosStepASummaryPath,
    sameDayHigh8CandidateCount: toNumber(trainStepASummary?.candidateSameDayHigh8Count, 0),
    recentImpulseCandidateCounts: trainRecentImpulseCandidateCounts,
    recentImpulseDedupedCandidateCount: toNumber(trainStepASummary?.candidateRecentImpulseDedupedCount, 0),
    sameDayHigh8PassedEventCount: toNumber(trainStepASummary?.passedSameDayHigh8Count, 0),
    recentImpulsePassedEventCounts: trainRecentImpulsePassedCounts,
    recentImpulseDedupedPassedEventCount: toNumber(trainStepASummary?.passedRecentImpulseDedupedCount, 0),
    oosSameDayHigh8CandidateCount: toNumber(oosStepASummary?.candidateSameDayHigh8Count, 0),
    oosRecentImpulseCandidateCounts,
    oosRecentImpulseDedupedCandidateCount: toNumber(oosStepASummary?.candidateRecentImpulseDedupedCount, 0),
    oosSameDayHigh8PassedEventCount: toNumber(oosStepASummary?.passedSameDayHigh8Count, 0),
    oosRecentImpulsePassedEventCounts: oosRecentImpulsePassedCounts,
    oosRecentImpulseDedupedPassedEventCount: toNumber(oosStepASummary?.passedRecentImpulseDedupedCount, 0),
    ruleCount: leaderboard.length,
    oosMatchedRules: oosGuardrailSummary.oosMatchedRules,
    oosZeroNegativeRules: oosGuardrailSummary.oosZeroNegativeRules,
    oosHit2ZeroNegativeRules: oosGuardrailSummary.oosHit2ZeroNegativeRules,
    oosHit3ZeroNegativeRules: oosGuardrailSummary.oosHit3ZeroNegativeRules,
    uniqueMatchedDates: oosGuardrailSummary.uniqueMatchedDates,
    uniqueMatchedSymbols: oosGuardrailSummary.uniqueMatchedSymbols,
    top1DateShare: oosGuardrailSummary.top1DateShare,
    top5DateShare: oosGuardrailSummary.top5DateShare,
    top1SymbolShare: oosGuardrailSummary.top1SymbolShare,
    top10SymbolShare: oosGuardrailSummary.top10SymbolShare,
    ...buildFlatRecentImpulseFields({
      prefix: "recentImpulse",
      values: trainRecentImpulseCandidateCounts,
    }),
    ...buildFlatRecentImpulseFields({
      prefix: "recentImpulsePassedEvent",
      values: trainRecentImpulsePassedCounts,
    }),
    ...buildFlatRecentImpulseFields({
      prefix: "oosRecentImpulse",
      values: oosRecentImpulseCandidateCounts,
    }),
    ...buildFlatRecentImpulseFields({
      prefix: "oosRecentImpulsePassedEvent",
      values: oosRecentImpulsePassedCounts,
    }),
  }
  const catalogSelectionAllowedFamilyIds = uniqueSorted(catalog?.metadata?.selectionAllowedFamilyIds)
  const catalogSelectionContractId = toText(catalog?.metadata?.selectionContractId)
  const catalogSelectionProfileId = toText(catalog?.metadata?.selectionProfileId)
  const catalogSelectionProfileVersion = toText(catalog?.metadata?.selectionProfileVersion)
  const catalogSelectionIntent = toText(catalog?.metadata?.selectionIntent)
  const catalogSelectionMode = toText(catalog?.metadata?.selectionMode)
  const catalogSelectionLineId = toText(catalog?.metadata?.selectionLineId)
  const catalogSelectionSurface = toText(catalog?.metadata?.selectionSurface)
  const catalogSelectionDiscoveryUniverseId = toText(catalog?.metadata?.selectionDiscoveryUniverseId)
  const catalogSelectionManifestPath = toText(catalog?.metadata?.selectionManifestPath)
  const catalogSelectionManifestSha256 = toText(catalog?.metadata?.selectionManifestSha256)

  const baselineManifest = {
    generatedAt: new Date().toISOString(),
    runId,
    lineId,
    splitPolicy,
    selectionMode: resolvedSelectionMode,
    selectionModeIntegrityOk,
    selectionModeSources,
    close28FilterPct: Number.isFinite(close28FilterPct) ? close28FilterPct : null,
    maxGapTradingDays: Number.isFinite(maxGapTradingDays) ? maxGapTradingDays : null,
    configPath,
    configSha256,
    trainConfigPath,
    trainConfigSha256,
    oosConfigPath,
    oosConfigSha256,
    trainStepASummaryPath,
    oosStepASummaryPath,
    trainWindow: {
      start: trainStart,
      end: trainEnd,
    },
    oosWindow: {
      start: oosStart,
      end: oosEnd,
    },
    baselineExactnessClaimable,
    baselineArtifactIntegrityClaimable,
    catalogPath: catalog.path ?? catalogPath,
    catalogContentSha256: catalog?.freeze?.catalogContentSha256 ?? null,
    ruleIdsSha256: catalog?.freeze?.ruleIdsSha256 ?? null,
    surface: catalogSurface,
    selectionContractId: catalogSelectionContractId,
    selectionAllowedFamilyIds: catalogSelectionAllowedFamilyIds,
    selectionProfileId: catalogSelectionProfileId,
    selectionProfileVersion: catalogSelectionProfileVersion,
    selectionIntent: catalogSelectionIntent,
    selectionModeCatalog: catalogSelectionMode,
    selectionLineIdCatalog: catalogSelectionLineId,
    selectionSurfaceCatalog: catalogSelectionSurface,
    selectionDiscoveryUniverseId: catalogSelectionDiscoveryUniverseId,
    selectionManifestPath: catalogSelectionManifestPath,
    selectionManifestSha256: catalogSelectionManifestSha256,
    supportCasesFile: supportCasesFile ? path.resolve(supportCasesFile) : null,
    supportCaseIds: supportCases.map((entry) => entry.caseId),
    recentLowBundleCandidate,
    haesungLowGapTopOos100Candidates,
    trainInputPath,
    trainReportDir,
    oosInputPath,
    oosReportDir,
    oosApplyRawDir,
    oosApplyClose28Dir,
    trainCoverageSummary,
    trainExactnessDriftSummary,
    trainRecentImpulseSummary: trainStepASummary,
    trainBoundaryFilterSummary: trainStepBSummary?.baselineBoundaryFilter ?? null,
    oosCoverageSummary,
    oosRecentImpulseSummary: oosStepASummary,
    oosBoundaryFilterSummary: oosStepBSummary?.baselineBoundaryFilter ?? null,
    rawVsClose28Delta,
    recentImpulseGuardrailSummary,
  }

  await ensureDir(outDir)
  await writeJson(path.join(outDir, "baseline_manifest.json"), baselineManifest)
  await writeJson(path.join(outDir, "train_reapply_summary.json"), {
    ...trainCoverageSummary,
    ...trainExactnessDriftSummary,
    selectionMode: resolvedSelectionMode,
    selectionModeIntegrityOk,
    baselineExactnessClaimable,
    baselineArtifactIntegrityClaimable,
  })
  await writeJson(path.join(outDir, "oos_guardrail_summary.json"), oosGuardrailSummary)
  await writeJson(path.join(outDir, "recent_impulse_guardrail_summary.json"), recentImpulseGuardrailSummary)
  await writeJson(path.join(outDir, "precision_bucket_summary.json"), precisionBucketSummary)
  await writeJson(path.join(outDir, "family_summary.json"), familySummary)
  if (lineId === "stepb_dplus1_plus_lite_recent_mid_low") {
    await writeJson(
      path.join(outDir, "recent_mid_low_family_summary.json"),
      familySummary.filter((row) => PERFECT_PROTOTYPE_RULE_FAMILY_RECENT_ONLY_SHADOW_IDS.includes(row.familyId)),
    )
    await writeJson(path.join(outDir, "recent_low_bundle_candidate.json"), recentLowBundleCandidate)
    await writeJson(
      path.join(outDir, "haesung_low_gap_top_oos100_candidates.json"),
      {
        contractId: PERFECT_PROTOTYPE_HAESUNG_LOW_GAP_TOP_OOS100_CONTRACT_ID,
        supportCaseId: PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID,
        candidates: haesungLowGapTopOos100Candidates,
      },
    )
  }
  await writeJson(path.join(outDir, "leaderboard.json"), leaderboard)
  await writeJson(path.join(outDir, "date_concentration_leaderboard.json"), dateConcentration)
  await writeJson(path.join(outDir, "symbol_concentration_leaderboard.json"), symbolConcentration)
  await writeJson(path.join(outDir, "oos_collapse_leaderboard.json"), oosCollapseLeaderboard)
  await writeJson(path.join(outDir, "raw_vs_close28_delta.json"), rawVsClose28Delta)
  await writeJsonl(path.join(outDir, "oos_overlap_rows.jsonl"), overlapRows)

  const csvHeaders = [
    "ruleId",
    "familyId",
    "tokens",
    "trainStatsSource",
    "catalogTrainMatchCount",
    "catalogTrainHitCount",
    "catalogTrainNegativeCount",
    "catalogTrainPrecision",
    "catalogTrainMaxGapTradingDays",
    "catalogTrainFirstHitDate",
    "catalogTrainLastHitDate",
    "catalogTrainMatchedDateCount",
    "trainMatchCount",
    "trainHitCount",
    "trainNegativeCount",
    "trainPrecision",
    "trainMaxGapTradingDays",
    "trainFirstHitDate",
    "trainLastHitDate",
    "trainMatchedDateCount",
    "trainMatchedMonthCount",
    "trainMatchedFoldCount",
    "trainCountDrift",
    "trainGapDrift",
    "trainDateSemanticsDrift",
    "trainExactnessDrift",
    "oosMatchCount",
    "oosHitCount",
    "oosNegativeCount",
    "oosPrecision",
    "oosMaxGapTradingDays",
    "oosFirstHitDate",
    "oosLastHitDate",
    "oosMatchedDateCount",
    "trainUniqueMatchedDates",
    "trainUniqueMatchedSymbols",
    "oosUniqueMatchedDates",
    "oosUniqueMatchedSymbols",
    "rawMatchedRows",
    "matchesSupportCases",
    "supportCaseIds",
    "supportCaseCount",
    "haesungSupport",
  ]
  const csvLines = [
    csvHeaders.join(","),
    ...leaderboard.map((row) =>
      [
        row.ruleId,
        row.familyId,
        (Array.isArray(row.tokens) ? row.tokens : []).join(" "),
        row.trainStatsSource,
        row.catalogTrainMatchCount,
        row.catalogTrainHitCount,
        row.catalogTrainNegativeCount,
        row.catalogTrainPrecision,
        row.catalogTrainMaxGapTradingDays,
        row.catalogTrainFirstHitDate,
        row.catalogTrainLastHitDate,
        row.catalogTrainMatchedDateCount,
        row.trainMatchCount,
        row.trainHitCount,
        row.trainNegativeCount,
        row.trainPrecision,
        row.trainMaxGapTradingDays,
        row.trainFirstHitDate,
        row.trainLastHitDate,
        row.trainMatchedDateCount,
        row.trainMatchedMonthCount,
        row.trainMatchedFoldCount,
        row.trainCountDrift,
        row.trainGapDrift,
        row.trainDateSemanticsDrift,
        row.trainExactnessDrift,
        row.oosMatchCount,
        row.oosHitCount,
        row.oosNegativeCount,
        row.oosPrecision,
        row.oosMaxGapTradingDays,
        row.oosFirstHitDate,
        row.oosLastHitDate,
        row.oosMatchedDateCount,
        row.trainUniqueMatchedDates,
        row.trainUniqueMatchedSymbols,
        row.oosUniqueMatchedDates,
        row.oosUniqueMatchedSymbols,
        row.rawMatchedRows,
        row.matchesSupportCases,
        (Array.isArray(row.supportCaseIds) ? row.supportCaseIds : []).join(" "),
        row.supportCaseCount,
        row.haesungSupport,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ]
  await fs.writeFile(path.join(outDir, "leaderboard.csv"), `${csvLines.join("\n")}\n`, "utf8")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
