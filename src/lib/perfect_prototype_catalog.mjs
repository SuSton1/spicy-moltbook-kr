import path from "node:path"

import {
  buildPerfectPrototypeMonthKey,
  buildPerfectPrototypeQuarterKey,
  buildPerfectPrototypeRuleRankLookup,
  matchPerfectPrototypeRule,
  pickChampionPerfectPrototypeRule,
  rankPerfectPrototypeRules,
} from "./perfect_prototype_rule.mjs"
import {
  applyPerfectPrototypeCatalogFreezeMetadata,
  normalizeLoadedPerfectPrototypeCatalog,
  stripPerfectPrototypeRuleInternals,
} from "./perfect_prototype_catalog_freeze.mjs"
import { tokenizePerfectPrototypeRow } from "./perfect_prototype_tokenizer.mjs"
import { pathExists, readJson } from "./io.mjs"

const uniqueSorted = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort((left, right) =>
    String(left).localeCompare(String(right)),
  )

export const buildPerfectPrototypeCoverageReport = ({
  rows,
  rules,
  matches,
  dedupedMatches,
  datasetStats = null,
}) => {
  const sourceRows = Array.isArray(rows) ? rows : []
  const ruleRows = Array.isArray(rules) ? rules : []
  const matchRows = Array.isArray(matches) ? matches : []
  const dedupedRows = Array.isArray(dedupedMatches) ? dedupedMatches : []
  const positiveRows = sourceRows.filter((row) => row?.outcomeHitTarget === true)
  const negativeRows = sourceRows.filter((row) => row?.outcomeHitTarget === false)
  const totalRows = Number(datasetStats?.rowCount ?? sourceRows.length)
  const totalPositiveRows = Number(datasetStats?.positiveRowCount ?? positiveRows.length)
  const totalNegativeRows = Number(datasetStats?.negativeRowCount ?? negativeRows.length)
  const matchedIds = new Set(matchRows.map((row) => row.sourceId).filter(Boolean))
  const matchedPositiveIds = new Set(
    matchRows
      .filter((row) => row?.outcomeHitTarget === true)
      .map((row) => row.sourceId)
      .filter(Boolean),
  )
  const matchedNegativeIds = new Set(
    matchRows
      .filter((row) => row?.outcomeHitTarget === false)
      .map((row) => row.sourceId)
      .filter(Boolean),
  )
  const matchedDateKeys = uniqueSorted(matchRows.map((row) => row.dateKey).filter(Boolean))
  const matchedMonthKeys = uniqueSorted(
    matchRows.map((row) => buildPerfectPrototypeMonthKey(row?.dateKey)).filter(Boolean),
  )
  const matchedQuarterKeys = uniqueSorted(
    matchRows.map((row) => buildPerfectPrototypeQuarterKey(row?.dateKey)).filter(Boolean),
  )

  return {
    totalRows,
    totalPositiveRows,
    totalNegativeRows,
    ruleCount: ruleRows.length,
    matchedRows: matchRows.length,
    matchedPositiveRows: matchedPositiveIds.size,
    matchedNegativeRows: matchedNegativeIds.size,
    positiveCoverageRate: totalPositiveRows > 0 ? matchedPositiveIds.size / totalPositiveRows : 0,
    negativeCoverageRate: totalNegativeRows > 0 ? matchedNegativeIds.size / totalNegativeRows : 0,
    dedupedSymbolDayMatches: dedupedRows.length,
    uniqueMatchedDates: matchedDateKeys.length,
    uniqueMatchedMonths: matchedMonthKeys.length,
    uniqueMatchedQuarters: matchedQuarterKeys.length,
    uniqueMatchedSymbols: uniqueSorted(matchRows.map((row) => row.symbol).filter(Boolean)).length,
    unmatchedPositiveRows: totalPositiveRows - matchedPositiveIds.size,
    unmatchedNegativeRows: totalNegativeRows - matchedNegativeIds.size,
    coveredRuleIds: uniqueSorted(matchRows.flatMap((row) => row?.matchedRuleIds ?? [])),
    matchedRowIds: Array.from(matchedIds).slice(0, 1000),
  }
}

export const buildPerfectPrototypeCatalog = ({
  tokenizerSpec,
  rules,
  rows,
  matches,
  dedupedMatches,
  metadata = {},
  datasetStats = null,
}) => {
  const rankedRules = rankPerfectPrototypeRules(rules)
  const championRaw = pickChampionPerfectPrototypeRule(rankedRules)
  const champion = championRaw ? stripPerfectPrototypeRuleInternals(championRaw) : null
  return applyPerfectPrototypeCatalogFreezeMetadata({
    catalog: {
    version: 1,
    generatedAt: new Date().toISOString(),
    metadata: {
      ...metadata,
      rowCount: Number(datasetStats?.rowCount ?? (Array.isArray(rows) ? rows.length : 0)),
      ruleCount: rankedRules.length,
    },
    tokenizerSpec,
    champion,
    summary: buildPerfectPrototypeCoverageReport({
      rows,
      rules: rankedRules,
      matches,
      dedupedMatches,
      datasetStats,
    }),
      rules: rankedRules.map(stripPerfectPrototypeRuleInternals),
    },
    sourceRunId: metadata?.sourceRunId ?? null,
  })
}

export const selectPerfectPrototypeRules = (catalog, selectionMode = "union_all") => {
  const mode = String(selectionMode ?? "union_all").trim().toLowerCase()
  const rules = Array.isArray(catalog?.rules) ? catalog.rules : []
  if (mode === "champion_only") {
    return catalog?.champion ? [catalog.champion] : rules.slice(0, 1)
  }
  if (mode === "union_all" || mode === "top1_per_day_union" || mode === "top2_per_day_union") {
    return rules
  }
  throw new Error(`Unsupported perfect prototype selectionMode: ${selectionMode}`)
}

export const buildPerfectPrototypeCatalogRuleLookup = (catalog) =>
  buildPerfectPrototypeRuleRankLookup(Array.isArray(catalog?.rules) ? catalog.rules : [])

export const loadPerfectPrototypeCatalog = async (catalogPath, options = {}) => {
  const resolvedPath = path.isAbsolute(catalogPath)
    ? catalogPath
    : path.resolve(process.cwd(), String(catalogPath ?? "").trim())
  if (!pathExists(resolvedPath)) {
    throw new Error(`Perfect prototype catalog not found: ${resolvedPath}`)
  }
  const catalog = await readJson(resolvedPath, null)
  if (!catalog || typeof catalog !== "object") {
    throw new Error(`Perfect prototype catalog invalid JSON: ${resolvedPath}`)
  }
  return normalizeLoadedPerfectPrototypeCatalog({
    catalog,
    catalogPath: resolvedPath,
    expectedCatalogSha256: options?.expectedCatalogSha256 ?? null,
    expectedRuleIdsSha256: options?.expectedRuleIdsSha256 ?? null,
    requireFrozen: options?.requireFrozen === true,
  })
}

export const matchPerfectPrototypeCatalog = ({
  row,
  catalog,
  selectionMode = "champion_only",
  tokenizerSpec = null,
  tokenizerOptions = {},
}) => {
  const spec = tokenizerSpec ?? catalog?.tokenizerSpec ?? null
  if (!spec) {
    throw new Error("Perfect prototype catalog tokenizerSpec is required for matching")
  }
  const tokenizedRow = tokenizePerfectPrototypeRow(row, spec, tokenizerOptions)
  const selectedRules = selectPerfectPrototypeRules(catalog, selectionMode)
  const matchedRules = selectedRules.filter((rule) => matchPerfectPrototypeRule(tokenizedRow, rule))
  return {
    tokenizedRow,
    matchedRules,
    matchedRuleIds: uniqueSorted(matchedRules.map((rule) => rule?.ruleId).filter(Boolean)),
    primaryRuleId: matchedRules[0]?.ruleId ?? null,
  }
}
