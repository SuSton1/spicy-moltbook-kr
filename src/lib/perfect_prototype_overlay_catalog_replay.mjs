import { buildRecommendationCloseRetLookupForMatchTargets } from "./perfect_prototype_apply_close_ret_lookup.mjs"
import { createPerfectPrototypeMatchAccumulator } from "./perfect_prototype_dedupe.mjs"
import { enrichPerfectPrototypeRowsWithContext } from "./perfect_prototype_contextual_features.mjs"
import { enrichPerfectPrototypeRowsWithDecisionContext } from "./perfect_prototype_decision_contextual_features.mjs"
import { isPrejumpPredictiveSurface, assertNoPrejumpLeakageRows } from "./perfect_prototype_prejump_contract.mjs"
import { selectPerfectPrototypeRules } from "./perfect_prototype_catalog.mjs"
import { buildPerfectPrototypeRuleMatchIndex, selectPerfectPrototypeCandidateRules } from "./perfect_prototype_rule_match_index.mjs"
import { matchPerfectPrototypeRule } from "./perfect_prototype_rule.mjs"
import { normalizePerfectPrototypeRow, tokenizePerfectPrototypeRow } from "./perfect_prototype_tokenizer.mjs"

const uniqueStrings = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const enrichRowsForCatalogSurface = ({ rows, catalog }) => {
  const surface = String(catalog?.tokenizerSpec?.surface ?? "").trim().toLowerCase()
  if (isPrejumpPredictiveSurface(surface)) {
    assertNoPrejumpLeakageRows(rows)
    return enrichPerfectPrototypeRowsWithDecisionContext(rows, {
      referenceRows: rows,
      preserveExisting: true,
    })
  }
  return enrichPerfectPrototypeRowsWithContext(rows, {
    referenceRows: rows,
    replaceExistingContextualTokens: true,
  })
}

const buildMatchRow = ({
  rawRow,
  normalizedRow,
  tokenSet,
  matchedRules = [],
} = {}) => {
  const matchedRuleIds = matchedRules.map((rule) => rule.ruleId).filter(Boolean)
  return {
    rowKey: String(rawRow?.rowKey ?? normalizedRow?.sourceId ?? `${normalizedRow?.symbol ?? "?"}:${normalizedRow?.dateKey ?? "?"}`).trim(),
    sourceId: normalizedRow?.sourceId ?? rawRow?.sourceId ?? null,
    dateKey: normalizedRow?.dateKey ?? rawRow?.dateKey ?? null,
    monthKey:
      String(rawRow?.monthKey ?? "").trim() ||
      (String(normalizedRow?.dateKey ?? "").trim().length >= 7 ? String(normalizedRow.dateKey).slice(0, 7) : null),
    foldId: Number(rawRow?.foldId ?? 0) || null,
    windowId: Number(rawRow?.windowId ?? 0) || null,
    symbol: normalizedRow?.symbol ?? rawRow?.symbol ?? null,
    name: String(rawRow?.name ?? rawRow?.symbolName ?? normalizedRow?.raw?.name ?? "").trim() || null,
    outcomeHitTarget:
      typeof normalizedRow?.outcomeHitTarget === "boolean"
        ? normalizedRow.outcomeHitTarget
        : typeof rawRow?.outcomeHitTarget === "boolean"
          ? rawRow.outcomeHitTarget
          : typeof rawRow?.eventOutcome?.hitTarget === "boolean"
            ? rawRow.eventOutcome.hitTarget
            : false,
    categoricalTokens: uniqueStrings(Array.from(tokenSet)),
    tokenSet,
    numericFeatureMap: {
      ...(normalizedRow?.numericFeatureMap ?? {}),
    },
    matchedRuleIds,
    matchedRuleCount: matchedRuleIds.length,
    primaryRuleId: matchedRuleIds[0] ?? null,
    recommendationDateCloseRetPct: null,
  }
}

const summarizeMatches = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const hits = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    selectedRowCount: safeRows.length,
    hitRowCount: hits.length,
    negativeRowCount: negatives.length,
    precision: safeRows.length > 0 ? hits.length / safeRows.length : 0,
    selectedDateCount: new Set(safeRows.map((row) => row?.dateKey).filter(Boolean)).size,
    hitDateCount: new Set(hits.map((row) => row?.dateKey).filter(Boolean)).size,
    selectedSymbolCount: new Set(safeRows.map((row) => row?.symbol).filter(Boolean)).size,
  }
}

const resolveSelectionMaxSymbolsPerDay = (selectionMode) => {
  const normalizedSelectionMode =
    String(selectionMode ?? "union_all").trim().toLowerCase() || "union_all"
  if (normalizedSelectionMode === "top1_per_day_union") return 1
  if (normalizedSelectionMode === "top2_per_day_union") return 2
  return null
}

export const replayPerfectPrototypeOverlayCatalog = async ({
  rows = [],
  catalog,
  selectionMode = "union_all",
  closeRetFilterGte = null,
  candlePath = null,
} = {}) => {
  const selectedRules = selectPerfectPrototypeRules(catalog, selectionMode)
  const rankedSelectedRules = (Array.isArray(selectedRules) ? selectedRules : []).slice()
  const ruleMatchIndex = buildPerfectPrototypeRuleMatchIndex({
    rules: rankedSelectedRules,
  })
  const contextualizedRows = enrichRowsForCatalogSurface({
    rows,
    catalog,
  })
  const allMatchedRows = []
  const targetDatesBySymbol = new Map()
  let ruleCandidateChecks = 0

  for (const rawRow of Array.isArray(contextualizedRows) ? contextualizedRows : []) {
    const normalizedRow = normalizePerfectPrototypeRow(rawRow, catalog?.tokenizerSpec?.options)
    if (!normalizedRow?.dateKey) continue
    const tokenSet = tokenizePerfectPrototypeRow(normalizedRow, catalog?.tokenizerSpec)
    const candidateRules = selectPerfectPrototypeCandidateRules({
      tokenSet,
      matchIndex: ruleMatchIndex,
    })
    ruleCandidateChecks += candidateRules.length
    const matchedRules = candidateRules
      .filter((rule) => matchPerfectPrototypeRule(tokenSet, rule))
      .sort((left, right) => Number(left?.rank ?? Number.MAX_SAFE_INTEGER) - Number(right?.rank ?? Number.MAX_SAFE_INTEGER))
    if (matchedRules.length < 1) continue
    const matchRow = buildMatchRow({
      rawRow,
      normalizedRow,
      tokenSet,
      matchedRules,
    })
    allMatchedRows.push(matchRow)
    if (closeRetFilterGte != null) {
      const bucket = targetDatesBySymbol.get(matchRow.symbol) ?? new Set()
      bucket.add(matchRow.dateKey)
      targetDatesBySymbol.set(matchRow.symbol, bucket)
    }
  }

  let filteredRows = allMatchedRows
  let excludedSummary = {
    removedRowCount: 0,
    removedHitRowCount: 0,
    removedNegativeRowCount: 0,
  }

  if (closeRetFilterGte != null) {
    if (!candlePath) {
      throw new Error("replayPerfectPrototypeOverlayCatalog requires candlePath when closeRetFilterGte is set")
    }
    const recommendationCloseRetLookup = await buildRecommendationCloseRetLookupForMatchTargets({
      candlePath,
      targetDatesBySymbol,
    })
    filteredRows = []
    for (const row of allMatchedRows) {
      const closeRetKey = `${row.symbol}::${row.dateKey}`
      const recommendationCloseRetPct = recommendationCloseRetLookup.get(closeRetKey)
      if (!Number.isFinite(recommendationCloseRetPct)) {
        throw new Error(`Missing recommendation-date close return lookup for ${closeRetKey} from ${candlePath}`)
      }
      const enrichedRow = {
        ...row,
        recommendationDateCloseRetPct: Number(recommendationCloseRetPct.toFixed(6)),
      }
      if (Number(enrichedRow.recommendationDateCloseRetPct) >= Number(closeRetFilterGte)) {
        excludedSummary.removedRowCount += 1
        if (enrichedRow?.outcomeHitTarget === true) excludedSummary.removedHitRowCount += 1
        if (enrichedRow?.outcomeHitTarget !== true) excludedSummary.removedNegativeRowCount += 1
        continue
      }
      filteredRows.push(enrichedRow)
    }
  }

  const accumulator = createPerfectPrototypeMatchAccumulator({
    rules: rankedSelectedRules,
    selectionMode,
    selectionMaxSymbolsPerDay: resolveSelectionMaxSymbolsPerDay(selectionMode),
  })
  for (const row of filteredRows) {
    accumulator.consume(row)
  }
  const deduped = accumulator.finalize()

  return {
    catalogRuleCount: rankedSelectedRules.length,
    selectionMode,
    ruleCandidateChecks,
    preFilterMatchedRows: allMatchedRows.length,
    filteredMatchedRows: filteredRows.length,
    excludedSummary,
    rawMatches: filteredRows,
    dedupedMatches: deduped.dedupedMatches,
    symbolDayDedupedMatches: deduped.symbolDayDedupedMatches,
    overlapRows: deduped.overlapRows,
    dayCapDroppedRows: deduped.dayCapDroppedRows,
    topOverflowDates: deduped.topOverflowDates,
    rawSummary: summarizeMatches(filteredRows),
    dedupedSummary: summarizeMatches(deduped.dedupedMatches),
  }
}
