#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getFlag, parseCliArgs } from "../src/lib/args.mjs"
import { ensureDir, readJson, writeJson } from "../src/lib/io.mjs"
import {
  closeWriteStream,
  iterateJsonlMaybeGzip,
  toNumber,
  toText,
  uniqueSorted,
  validDateKey,
  writeJsonlRow,
} from "../src/lib/tp12_year2hit_foundation_io.mjs"
import {
  buildConsensusRows,
  buildPatternReliability,
  loadClusterByPattern,
  loadContextBySymbolDate,
  loadLabelBySymbolDate,
  loadPatternTokens,
} from "./replay_tp12_zero_fp_rules_full_train.mjs"

const rowKeyOf = (row) => `${row.decisionDateKey}\t${row.symbol}`
const yearOf = (row) => toText(row?.decisionDateKey).slice(0, 4)
const safeRatio = (num, den) => (den > 0 ? num / den : 0)
const hashId = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)

const requirePath = (value, label, cwd) => {
  const resolved = path.resolve(cwd, toText(value))
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`)
  return resolved
}

const readJsonlRows = async (filePath) => {
  const rows = []
  await iterateJsonlMaybeGzip(filePath, {
    strict: true,
    onRow: async (row) => rows.push(row),
  })
  return rows
}

const normalizeArray = (value) => uniqueSorted(Array.isArray(value) ? value : [])

const EXECUTION_NUMERIC_TOP_LEVEL_FIELDS = new Set([
  "decisionClose",
  "entryOpen",
  "entryHigh",
  "entryLow",
  "entryClose",
  "entryVolume",
  "entryGapPct",
  "entryDayIntradayUpsidePct",
  "targetPrice",
  "chartMaxForwardReturn",
])

const assertContract = (contract) => {
  if (toText(contract?.kind) !== "tp12_year2hit_zero_fp_micro_split_contract_v1") {
    throw new Error(`unexpected contract kind: ${toText(contract?.kind)}`)
  }
  const dateFrom = toText(contract?.trainDateRange?.from)
  const dateTo = toText(contract?.trainDateRange?.to)
  if (!validDateKey(dateFrom) || !validDateKey(dateTo) || dateFrom > dateTo) {
    throw new Error(`invalid contract trainDateRange: ${dateFrom}..${dateTo}`)
  }
  const coreYears = (contract?.coreYears ?? []).map((year) => String(year))
  if (coreYears.length < 1) throw new Error("contract coreYears must not be empty")
  if (toNumber(contract?.target?.requiredTrainPrecision, 0) !== 1) {
    throw new Error("contract target.requiredTrainPrecision must be exactly 1")
  }
  if (toNumber(contract?.target?.maxFalsePositiveRows, 1) !== 0) {
    throw new Error("contract target.maxFalsePositiveRows must be exactly 0")
  }
  return { dateFrom, dateTo, coreYears }
}

const hitDefinitionOf = (contract) => toText(contract?.hitDefinition ?? contract?.target?.hitDefinition ?? "chart_hit_v1")

const assertNoTopLevelExecutionLeakage = (row) => {
  for (const field of EXECUTION_NUMERIC_TOP_LEVEL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      throw new Error(`executable_hit_v1 input must keep execution field nested, not top-level: ${field}`)
    }
  }
}

const applyHitDefinition = ({ row, contract }) => {
  const hitDefinition = hitDefinitionOf(contract)
  if (hitDefinition === "chart_hit_v1") {
    row.hitTarget = row.hitTarget === true
    row.labelClass = row.hitTarget ? "positive" : toText(row.labelClass || "unknown")
    return
  }
  if (hitDefinition !== "executable_hit_v1") throw new Error(`unsupported hitDefinition: ${hitDefinition}`)
  assertNoTopLevelExecutionLeakage(row)
  for (const field of ["chartHitTarget", "executableHitTarget", "entryExecutable"]) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) {
      throw new Error(`executable_hit_v1 row missing required field: ${row.decisionDateKey}::${row.symbol} ${field}`)
    }
  }
  row.chartHitTarget = row.chartHitTarget === true
  row.executableHitTarget = row.executableHitTarget === true
  row.entryExecutable = row.entryExecutable === true
  if (row.executableHitTarget && (!row.chartHitTarget || !row.entryExecutable)) {
    throw new Error(`invalid executableHitTarget invariant at ${row.decisionDateKey}::${row.symbol}`)
  }
  row.hitTarget = row.executableHitTarget
  row.labelClass = row.hitTarget
    ? "positive"
    : !row.entryExecutable && row.chartHitTarget
      ? "non_executable_chart_hit"
      : !row.entryExecutable
        ? "non_executable_chart_miss"
        : toText(row.labelClass || "unknown")
}

const addFeatureRanks = (dateRows) => {
  const fields = new Set()
  for (const row of dateRows) {
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === "number" && Number.isFinite(value)) fields.add(field)
    }
  }
  for (const field of fields) {
    const sorted = dateRows
      .filter((row) => Number.isFinite(row[field]))
      .sort((left, right) => left[field] - right[field] || left.symbol.localeCompare(right.symbol))
    const denom = Math.max(1, sorted.length - 1)
    for (const [index, row] of sorted.entries()) row.__featureRanks[field] = sorted.length > 1 ? index / denom : 1
  }
}

const hydrateRows = ({ rows, contract, dateFrom, dateTo }) => {
  const forbiddenFrom = toText(contract?.forbiddenDateRange?.from)
  const forbiddenTo = toText(contract?.forbiddenDateRange?.to)
  const scopedRows = []
  for (const row of rows) {
    const dateKey = toText(row?.decisionDateKey ?? row?.dateKey)
    const symbol = toText(row?.symbol).toUpperCase()
    if (!validDateKey(dateKey)) throw new Error(`invalid consensus dateKey: ${dateKey}`)
    if (!symbol) throw new Error(`consensus row missing symbol for ${dateKey}`)
    if (validDateKey(forbiddenFrom) && validDateKey(forbiddenTo) && dateKey >= forbiddenFrom && dateKey <= forbiddenTo) {
      throw new Error(`forbidden OOS row encountered in consensus input: ${dateKey}::${symbol}`)
    }
    if (dateKey < dateFrom || dateKey > dateTo) continue
    row.decisionDateKey = dateKey
    row.symbol = symbol
    applyHitDefinition({ row, contract })
    row.supportPatternIds = normalizeArray(row.supportPatternIds)
    row.supportClusterIds = normalizeArray(row.supportClusterIds)
    row.supportTokenSet = normalizeArray(row.supportTokenSet)
    row.tokenFamilies = normalizeArray(row.tokenFamilies)
    row.__featureRanks = {}
    scopedRows.push(row)
  }
  if (scopedRows.length < 1) throw new Error(`consensus input produced zero scoped rows for ${dateFrom}..${dateTo}`)
  const byDate = new Map()
  for (const row of scopedRows) {
    const dateRows = byDate.get(row.decisionDateKey) ?? []
    dateRows.push(row)
    byDate.set(row.decisionDateKey, dateRows)
  }
  for (const dateRows of byDate.values()) addFeatureRanks(dateRows)
  scopedRows.sort((left, right) => left.decisionDateKey.localeCompare(right.decisionDateKey) || left.symbol.localeCompare(right.symbol))
  return scopedRows
}

const atomKey = (atom) =>
  [toText(atom?.type), toText(atom?.field), toText(atom?.item), toText(atom?.direction), toText(atom?.threshold)].join("|")

const normalizeAtom = (atom) => {
  const type = toText(atom?.type)
  if (type === "token_include") {
    const item = toText(atom?.item)
    if (!item) throw new Error("token_include atom missing item")
    return { type, field: null, item, direction: null, threshold: null, label: `has token ${item}` }
  }
  if (type === "family_include") {
    const item = toText(atom?.item)
    if (!item) throw new Error("family_include atom missing item")
    return { type, field: null, item, direction: null, threshold: null, label: `has family ${item}` }
  }
  if (type === "pattern_include") {
    const item = toText(atom?.item)
    if (!item) throw new Error("pattern_include atom missing item")
    return { type, field: null, item, direction: null, threshold: null, label: `has pattern ${item}` }
  }
  if (type === "cluster_include") {
    const item = toText(atom?.item)
    if (!item) throw new Error("cluster_include atom missing item")
    return { type, field: null, item, direction: null, threshold: null, label: `has cluster ${item}` }
  }
  if (type === "feature_rank") {
    const field = toText(atom?.field)
    const direction = toText(atom?.direction)
    const threshold = toNumber(atom?.threshold, NaN)
    if (!field || !["ge", "le"].includes(direction) || !Number.isFinite(threshold)) {
      throw new Error(`invalid feature_rank atom: ${JSON.stringify(atom)}`)
    }
    return {
      type,
      field,
      item: null,
      direction,
      threshold,
      label: `${field} same-day rank ${direction} ${threshold}`,
    }
  }
  throw new Error(`unknown atom type: ${type}`)
}

const rowMatchesAtom = (row, atom) => {
  const normalized = normalizeAtom(atom)
  if (normalized.type === "token_include") {
    const item = normalized.item
    if (item.startsWith("family:")) return row.tokenFamilies.includes(item.slice("family:".length))
    return row.supportTokenSet.includes(item)
  }
  if (normalized.type === "family_include") return row.tokenFamilies.includes(normalized.item)
  if (normalized.type === "pattern_include") return row.supportPatternIds.includes(normalized.item)
  if (normalized.type === "cluster_include") return row.supportClusterIds.includes(normalized.item)
  if (normalized.type === "feature_rank") {
    const rank = row.__featureRanks?.[normalized.field]
    if (!Number.isFinite(rank)) return false
    if (normalized.direction === "ge") return rank >= normalized.threshold
    if (normalized.direction === "le") return rank <= normalized.threshold
  }
  return false
}

const rowMatchesBase = (row, baseType, baseId) => {
  if (baseType === "pattern") return row.supportPatternIds.includes(baseId)
  if (baseType === "cluster") return row.supportClusterIds.includes(baseId)
  if (baseType === "all_year2hit_rows") return true
  throw new Error(`unknown baseType: ${baseType}`)
}

const rowMatchesRule = (row, rule) => {
  if (!rowMatchesBase(row, toText(rule?.baseType), toText(rule?.baseId))) return false
  for (const atom of rule?.atoms ?? []) {
    if (!rowMatchesAtom(row, atom)) return false
  }
  return true
}

const emptyMetricState = () => ({
  matchRows: 0,
  hitRows: 0,
  falsePositiveRows: 0,
  nearMissRows: 0,
  easyNegativeRows: 0,
  hardNegativeRows: 0,
  unknownNegativeRows: 0,
  hitDatesByYear: new Map(),
  hitSymbolDatesByYear: new Map(),
  hitDateSet: new Set(),
  hitRowKeySet: new Set(),
})

const addRowToMetricState = (state, row) => {
  state.matchRows += 1
  if (row.hitTarget === true) {
    state.hitRows += 1
    state.hitDateSet.add(row.decisionDateKey)
    state.hitRowKeySet.add(rowKeyOf(row))
    const year = yearOf(row)
    const dates = state.hitDatesByYear.get(year) ?? new Set()
    dates.add(row.decisionDateKey)
    state.hitDatesByYear.set(year, dates)
    const symbolDates = state.hitSymbolDatesByYear.get(year) ?? new Set()
    symbolDates.add(rowKeyOf(row))
    state.hitSymbolDatesByYear.set(year, symbolDates)
    return
  }
  state.falsePositiveRows += 1
  if (row.labelClass === "near_miss") state.nearMissRows += 1
  else if (row.labelClass === "easy_negative") state.easyNegativeRows += 1
  else if (row.labelClass === "hard_negative") state.hardNegativeRows += 1
  else state.unknownNegativeRows += 1
}

const finalizeMetricState = (state, coreYears, target) => {
  const hitDatesByYear = Object.fromEntries(
    coreYears.map((year) => [year, state.hitDatesByYear.get(year)?.size ?? 0]),
  )
  const hitSymbolDatesByYear = Object.fromEntries(
    coreYears.map((year) => [year, state.hitSymbolDatesByYear.get(year)?.size ?? 0]),
  )
  const minHitDatesPerYear = Math.min(...coreYears.map((year) => hitDatesByYear[year] ?? 0))
  const minHitSymbolDatesPerYear = Math.min(...coreYears.map((year) => hitSymbolDatesByYear[year] ?? 0))
  const totalHitSymbolDates = state.hitRowKeySet.size
  const year2hitPassed =
    minHitDatesPerYear >= toNumber(target?.minHitDecisionDatesPerYear, 2) &&
    minHitSymbolDatesPerYear >= toNumber(target?.minHitSymbolDatesPerYear, 2) &&
    totalHitSymbolDates >= toNumber(target?.minPositiveSymbolDatesTotal, 18)
  return {
    matchRows: state.matchRows,
    hitRows: state.hitRows,
    falsePositiveRows: state.falsePositiveRows,
    nearMissRows: state.nearMissRows,
    easyNegativeRows: state.easyNegativeRows,
    hardNegativeRows: state.hardNegativeRows,
    unknownNegativeRows: state.unknownNegativeRows,
    precision: safeRatio(state.hitRows, state.matchRows),
    totalHitDates: state.hitDateSet.size,
    totalHitSymbolDates,
    hitDatesByYear,
    hitSymbolDatesByYear,
    minHitDatesPerYear,
    minHitSymbolDatesPerYear,
    year2hitPassed,
  }
}

const metricsForRows = (rows, coreYears, target) => {
  const state = emptyMetricState()
  for (const row of rows) addRowToMetricState(state, row)
  return finalizeMetricState(state, coreYears, target)
}

const summarizeRows = (rows, limit = 8) =>
  rows.slice(0, limit).map((row) => ({
    decisionDateKey: row.decisionDateKey,
    symbol: row.symbol,
    hitTarget: row.hitTarget,
    chartHitTarget: Object.prototype.hasOwnProperty.call(row, "chartHitTarget") ? row.chartHitTarget : undefined,
    entryExecutable: Object.prototype.hasOwnProperty.call(row, "entryExecutable") ? row.entryExecutable : undefined,
    labelClass: row.labelClass,
    maxForwardReturn: Number.isFinite(row.maxForwardReturn) ? row.maxForwardReturn : null,
  }))

const supportRowsForAtoms = (rows, includeAtoms, vetoAtoms = []) =>
  rows.filter((row) => {
    for (const atom of includeAtoms) if (!rowMatchesAtom(row, atom)) return false
    for (const atom of vetoAtoms) if (rowMatchesAtom(row, atom)) return false
    return true
  })

const buildAtomFromCountItem = (type, item) => normalizeAtom({ type, item })

const scoreAtom = ({ rows, atom, coreYears, target }) => {
  const support = rows.filter((row) => rowMatchesAtom(row, atom))
  const metrics = metricsForRows(support, coreYears, target)
  return {
    atom,
    supportRows: support.length,
    hitRows: metrics.hitRows,
    falsePositiveRows: metrics.falsePositiveRows,
    precision: metrics.precision,
    totalHitDates: metrics.totalHitDates,
    minHitDatesPerYear: metrics.minHitDatesPerYear,
    score:
      metrics.hitRows * 3 +
      metrics.totalHitDates * 2 +
      metrics.minHitDatesPerYear * 8 -
      metrics.falsePositiveRows * 5 -
      Math.log1p(support.length),
  }
}

const topCountAtoms = ({ rows, type, extractor, maxAtoms, coreYears, target }) => {
  const counts = new Map()
  for (const row of rows) {
    for (const item of extractor(row)) {
      const key = `${type}:${item}`
      const count = counts.get(key) ?? { type, item, hitRows: 0, falsePositiveRows: 0, supportRows: 0 }
      count.supportRows += 1
      if (row.hitTarget === true) count.hitRows += 1
      else count.falsePositiveRows += 1
      counts.set(key, count)
    }
  }
  return [...counts.values()]
    .filter((count) => count.hitRows > 0)
    .sort(
      (left, right) =>
        right.hitRows / (right.falsePositiveRows + 1) - left.hitRows / (left.falsePositiveRows + 1) ||
        left.falsePositiveRows - right.falsePositiveRows ||
        right.hitRows - left.hitRows ||
        left.item.localeCompare(right.item),
    )
    .slice(0, maxAtoms)
    .map((count) => scoreAtom({ rows, atom: buildAtomFromCountItem(type, count.item), coreYears, target }))
}

const buildAtomPool = ({ parentRows, contract, coreYears }) => {
  const atomBuilder = contract.atomBuilder ?? {}
  const target = contract.target ?? {}
  const scored = []
  if (atomBuilder.includeSupportPatternAtoms !== false) {
    scored.push(
      ...topCountAtoms({
        rows: parentRows,
        type: "pattern_include",
        extractor: (row) => row.supportPatternIds,
        maxAtoms: toNumber(atomBuilder.maxPatternAtomsPerParent, 160),
        coreYears,
        target,
      }),
    )
  }
  if (atomBuilder.includeSupportClusterAtoms !== false) {
    scored.push(
      ...topCountAtoms({
        rows: parentRows,
        type: "cluster_include",
        extractor: (row) => row.supportClusterIds,
        maxAtoms: toNumber(atomBuilder.maxClusterAtomsPerParent, 120),
        coreYears,
        target,
      }),
    )
  }
  if (atomBuilder.includeSupportTokenAtoms !== false) {
    scored.push(
      ...topCountAtoms({
        rows: parentRows,
        type: "token_include",
        extractor: (row) => row.supportTokenSet,
        maxAtoms: toNumber(atomBuilder.maxTokenAtomsPerParent, 160),
        coreYears,
        target,
      }),
    )
  }
  if (atomBuilder.includeTokenFamilyAtoms !== false) {
    scored.push(
      ...topCountAtoms({
        rows: parentRows,
        type: "family_include",
        extractor: (row) => row.tokenFamilies,
        maxAtoms: 80,
        coreYears,
        target,
      }),
    )
  }
  if (atomBuilder.includeNumericRankAtoms !== false) {
    const thresholds = (atomBuilder.rankThresholds ?? []).map((value) => toNumber(value, NaN)).filter(Number.isFinite)
    for (const field of atomBuilder.rankFields ?? []) {
      for (const threshold of thresholds) {
        if (threshold > 0 && threshold < 1) {
          scored.push(scoreAtom({ rows: parentRows, atom: normalizeAtom({ type: "feature_rank", field, direction: "ge", threshold }), coreYears, target }))
          scored.push(scoreAtom({ rows: parentRows, atom: normalizeAtom({ type: "feature_rank", field, direction: "le", threshold }), coreYears, target }))
        }
      }
    }
  }
  const dedup = new Map()
  for (const item of scored) {
    const key = atomKey(item.atom)
    const current = dedup.get(key)
    if (!current || item.score > current.score) dedup.set(key, item)
  }
  return [...dedup.values()]
    .filter((item) => item.hitRows >= toNumber(contract?.mining?.minTileHitRows, 1))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.falsePositiveRows - right.falsePositiveRows ||
        right.hitRows - left.hitRows ||
        atomKey(left.atom).localeCompare(atomKey(right.atom)),
    )
    .slice(0, toNumber(contract?.mining?.maxAtomPoolPerParent, 220))
}

const uniqueAtomSet = (atoms) => {
  const byKey = new Map()
  for (const atom of atoms) byKey.set(atomKey(normalizeAtom(atom)), normalizeAtom(atom))
  return [...byKey.values()].sort((left, right) => atomKey(left).localeCompare(atomKey(right)))
}

const coreKey = (atoms) => uniqueAtomSet(atoms).map(atomKey).join("&&")

const buildCoreSets = ({ parentRules, atomPool, contract }) => {
  const mining = contract.mining ?? {}
  const coreTopAtomCount = toNumber(mining.coreTopAtomCount, 80)
  const maxCoreAtoms = toNumber(mining.maxCoreAtoms, 3)
  const maxEvaluated = toNumber(mining.maxEvaluatedCoresPerParent, 16000)
  const cores = new Map()
  const addCore = (atoms, source) => {
    const normalized = uniqueAtomSet(atoms)
    if (normalized.length < 1) return
    if (source === "mined" && normalized.length > maxCoreAtoms) return
    if (source === "source_rule" && normalized.length > toNumber(mining.maxSourceRuleCoreDepth, 8)) return
    const key = coreKey(normalized)
    if (!cores.has(key)) cores.set(key, { includeAtoms: normalized, source })
  }
  if (mining.includeSourceRuleCores !== false) {
    for (const rule of parentRules) addCore(rule.atoms ?? [], "source_rule")
  }
  const topAtoms = atomPool.slice(0, coreTopAtomCount).map((item) => item.atom)
  for (const atom of topAtoms) addCore([atom], "mined")
  for (let i = 0; i < topAtoms.length; i += 1) {
    for (let j = i + 1; j < topAtoms.length; j += 1) {
      if (cores.size >= maxEvaluated) break
      addCore([topAtoms[i], topAtoms[j]], "mined")
    }
    if (cores.size >= maxEvaluated) break
  }
  const tripleAtoms = topAtoms.slice(0, Math.min(34, topAtoms.length))
  if (maxCoreAtoms >= 3) {
    for (let i = 0; i < tripleAtoms.length; i += 1) {
      for (let j = i + 1; j < tripleAtoms.length; j += 1) {
        for (let k = j + 1; k < tripleAtoms.length; k += 1) {
          if (cores.size >= maxEvaluated) break
          addCore([tripleAtoms[i], tripleAtoms[j], tripleAtoms[k]], "mined")
        }
        if (cores.size >= maxEvaluated) break
      }
      if (cores.size >= maxEvaluated) break
    }
  }
  return [...cores.values()].slice(0, maxEvaluated)
}

const tileKey = ({ baseType, baseId, includeAtoms, vetoAtoms }) =>
  `${baseType}|${baseId}|${coreKey(includeAtoms)}|NOT:${coreKey(vetoAtoms)}`

const makeTile = ({ baseType, baseId, includeAtoms, vetoAtoms, supportRows, coreSource, coreYears, target }) => {
  const metrics = metricsForRows(supportRows, coreYears, target)
  const key = tileKey({ baseType, baseId, includeAtoms, vetoAtoms })
  const hitRows = supportRows.filter((row) => row.hitTarget === true)
  const falsePositiveRows = supportRows.filter((row) => row.hitTarget !== true)
  return {
    tileId: `tp12_micro_${hashId(key)}`,
    baseType,
    baseId,
    coreSource,
    includeAtoms: uniqueAtomSet(includeAtoms),
    vetoAtoms: uniqueAtomSet(vetoAtoms),
    metrics,
    hitRowKeys: uniqueSorted(hitRows.map(rowKeyOf)),
    hitDateKeys: uniqueSorted(hitRows.map((row) => row.decisionDateKey)),
    sampleHitRows: summarizeRows(hitRows),
    sampleFalsePositiveRows: summarizeRows(falsePositiveRows),
  }
}

const tileSortScore = (tile, coreYears, target) => {
  let yearPresence = 0
  let cappedYearDates = 0
  let cappedYearRows = 0
  for (const year of coreYears) {
    const dates = tile.metrics.hitDatesByYear?.[year] ?? 0
    const rows = tile.metrics.hitSymbolDatesByYear?.[year] ?? 0
    if (dates > 0) yearPresence += 1
    cappedYearDates += Math.min(toNumber(target?.minHitDecisionDatesPerYear, 2), dates)
    cappedYearRows += Math.min(toNumber(target?.minHitSymbolDatesPerYear, 2), rows)
  }
  return yearPresence * 1000 + cappedYearDates * 100 + cappedYearRows * 50 + tile.metrics.totalHitSymbolDates
}

const selectDiverseZeroTiles = ({ tiles, coreYears, target, limit }) => {
  const selected = new Map()
  const add = (tile) => selected.set(tileKey(tile), tile)
  const sortedOverall = tiles
    .slice()
    .sort(
      (left, right) =>
        tileSortScore(right, coreYears, target) - tileSortScore(left, coreYears, target) ||
        right.metrics.hitRows - left.metrics.hitRows ||
        left.tileId.localeCompare(right.tileId),
    )
  for (const tile of sortedOverall.slice(0, Math.min(260, sortedOverall.length))) add(tile)
  for (const year of coreYears) {
    const yearTiles = sortedOverall
      .filter((tile) => (tile.metrics.hitDatesByYear?.[year] ?? 0) > 0)
      .sort(
        (left, right) =>
          (right.metrics.hitDatesByYear?.[year] ?? 0) - (left.metrics.hitDatesByYear?.[year] ?? 0) ||
          (right.metrics.hitSymbolDatesByYear?.[year] ?? 0) - (left.metrics.hitSymbolDatesByYear?.[year] ?? 0) ||
          tileSortScore(right, coreYears, target) - tileSortScore(left, coreYears, target) ||
          left.tileId.localeCompare(right.tileId),
      )
    for (const tile of yearTiles.slice(0, Math.min(180, yearTiles.length))) add(tile)
  }
  return [...selected.values()]
    .sort(
      (left, right) =>
        tileSortScore(right, coreYears, target) - tileSortScore(left, coreYears, target) ||
        right.metrics.hitRows - left.metrics.hitRows ||
        left.tileId.localeCompare(right.tileId),
    )
    .slice(0, limit)
}

const vetoCandidatesForSupport = ({ supportRows, atomPool, includeAtoms, maxCandidates }) => {
  const includeKeys = new Set(includeAtoms.map((atom) => atomKey(atom)))
  const falseRows = supportRows.filter((row) => row.hitTarget !== true)
  if (falseRows.length < 1) return []
  const scored = []
  for (const item of atomPool) {
    const atom = item.atom
    if (includeKeys.has(atomKey(atom))) continue
    let fpRemoved = 0
    let hitRemoved = 0
    for (const row of supportRows) {
      if (!rowMatchesAtom(row, atom)) continue
      if (row.hitTarget === true) hitRemoved += 1
      else fpRemoved += 1
    }
    if (fpRemoved < 1) continue
    scored.push({
      atom,
      fpRemoved,
      hitRemoved,
      score: fpRemoved * 100 - hitRemoved * 25 - item.falsePositiveRows * 0.1 + item.hitRows * 0.01,
    })
  }
  return scored
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.fpRemoved - left.fpRemoved ||
        left.hitRemoved - right.hitRemoved ||
        atomKey(left.atom).localeCompare(atomKey(right.atom)),
    )
    .slice(0, maxCandidates)
}

const mineParentTiles = ({ parent, parentRows, parentRules, contract, coreYears }) => {
  const target = contract.target ?? {}
  const mining = contract.mining ?? {}
  const atomPool = buildAtomPool({ parentRows, contract, coreYears })
  const coreSets = buildCoreSets({ parentRules, atomPool, contract })
  const candidates = []
  let candidateTileCount = 0
  const zeroTiles = new Map()
  const candidateDedup = new Set()
  const maxCoreFp = toNumber(mining.maxCoreFalsePositiveRowsForVeto, 40)
  const maxVetoAtoms = toNumber(mining.maxVetoAtoms, 2)
  const maxVetoCandidates = toNumber(mining.maxVetoCandidatesPerCore, 80)
  const maxZeroTilesForCover = toNumber(mining.maxZeroFpTilesForCoverPerParent, 900)
  const maxZeroTilesOutput = toNumber(mining.maxZeroFpTilesOutputPerParent, 400)
  const maxCandidateOutput = toNumber(mining.maxCandidateTilesOutputPerParent, 600)

  const candidateOutputScore = (tile) =>
    tile.metrics.year2hitPassed * 100000 +
    (1000 - Math.min(1000, tile.metrics.falsePositiveRows)) * 100 +
    tile.metrics.hitRows * 10 +
    tile.metrics.totalHitDates

  const keepCandidateForOutput = (tile, stage) => {
    const outputTile = {
      ...tile,
      stage,
      hitRowKeys: undefined,
      hitDateKeys: undefined,
    }
    if (candidates.length < maxCandidateOutput) {
      candidates.push(outputTile)
      return
    }
    let worstIndex = 0
    let worstScore = candidateOutputScore(candidates[0])
    for (let index = 1; index < candidates.length; index += 1) {
      const score = candidateOutputScore(candidates[index])
      if (score < worstScore) {
        worstScore = score
        worstIndex = index
      }
    }
    if (candidateOutputScore(outputTile) > worstScore) candidates[worstIndex] = outputTile
  }

  const addCandidate = (tile, stage) => {
    const key = tileKey(tile)
    if (candidateDedup.has(`${stage}|${key}`)) return
    candidateDedup.add(`${stage}|${key}`)
    candidateTileCount += 1
    keepCandidateForOutput(tile, stage)
    if (tile.metrics.falsePositiveRows === 0 && tile.metrics.hitRows >= toNumber(mining.minTileHitRows, 1)) {
      const current = zeroTiles.get(key)
      if (!current || tile.metrics.hitRows > current.metrics.hitRows) zeroTiles.set(key, tile)
      if (zeroTiles.size > maxZeroTilesForCover * 4) {
        const pruned = selectDiverseZeroTiles({
          tiles: [...zeroTiles.values()],
          coreYears,
          target,
          limit: maxZeroTilesForCover * 2,
        })
        zeroTiles.clear()
        for (const prunedTile of pruned) zeroTiles.set(tileKey(prunedTile), prunedTile)
      }
    }
  }

  for (const core of coreSets) {
    const supportRows = supportRowsForAtoms(parentRows, core.includeAtoms)
    if (supportRows.length < 1) continue
    const coreTile = makeTile({
      baseType: parent.baseType,
      baseId: parent.baseId,
      includeAtoms: core.includeAtoms,
      vetoAtoms: [],
      supportRows,
      coreSource: core.source,
      coreYears,
      target,
    })
    if (coreTile.metrics.hitRows >= toNumber(mining.minTileHitRows, 1)) addCandidate(coreTile, "core")
    if (coreTile.metrics.falsePositiveRows === 0 || coreTile.metrics.falsePositiveRows > maxCoreFp) continue
    const vetoPool = vetoCandidatesForSupport({
      supportRows,
      atomPool,
      includeAtoms: core.includeAtoms,
      maxCandidates: maxVetoCandidates,
    })
    for (const veto of vetoPool) {
      const vetoAtoms = [veto.atom]
      const vetoSupportRows = supportRowsForAtoms(supportRows, [], vetoAtoms)
      const vetoTile = makeTile({
        baseType: parent.baseType,
        baseId: parent.baseId,
        includeAtoms: core.includeAtoms,
        vetoAtoms,
        supportRows: vetoSupportRows,
        coreSource: core.source,
        coreYears,
        target,
      })
      addCandidate(vetoTile, "single_veto")
    }
    if (maxVetoAtoms >= 2) {
      const pairPool = vetoPool.slice(0, Math.min(28, vetoPool.length))
      for (let i = 0; i < pairPool.length; i += 1) {
        for (let j = i + 1; j < pairPool.length; j += 1) {
          const vetoAtoms = uniqueAtomSet([pairPool[i].atom, pairPool[j].atom])
          const vetoSupportRows = supportRowsForAtoms(supportRows, [], vetoAtoms)
          const vetoTile = makeTile({
            baseType: parent.baseType,
            baseId: parent.baseId,
            includeAtoms: core.includeAtoms,
            vetoAtoms,
            supportRows: vetoSupportRows,
            coreSource: core.source,
            coreYears,
            target,
          })
          addCandidate(vetoTile, "double_veto")
        }
      }
    }
  }
  const sortedZeroTilesForCover = selectDiverseZeroTiles({
    tiles: [...zeroTiles.values()],
    coreYears,
    target,
    limit: maxZeroTilesForCover,
  })
  const sortedZeroTilesForOutput = sortedZeroTilesForCover
    .sort(
      (left, right) =>
        right.metrics.year2hitPassed - left.metrics.year2hitPassed ||
        right.metrics.totalHitDates - left.metrics.totalHitDates ||
        right.metrics.hitRows - left.metrics.hitRows ||
        left.includeAtoms.length + left.vetoAtoms.length - (right.includeAtoms.length + right.vetoAtoms.length) ||
        left.tileId.localeCompare(right.tileId),
    )
    .slice(0, maxZeroTilesOutput)
  const candidateTilesForOutput = candidates
    .sort(
      (left, right) =>
        right.metrics.year2hitPassed - left.metrics.year2hitPassed ||
        left.metrics.falsePositiveRows - right.metrics.falsePositiveRows ||
        right.metrics.hitRows - left.metrics.hitRows ||
        left.tileId.localeCompare(right.tileId),
    )
    .slice(0, toNumber(mining.maxCandidateTilesOutputPerParent, 600))
  return {
    atomPool,
    coreSetCount: coreSets.length,
    candidateTileCount,
    candidateTiles: candidateTilesForOutput,
    zeroFpTilesForCover: sortedZeroTilesForCover,
    zeroFpTiles: sortedZeroTilesForOutput,
  }
}

const deficitScore = (metrics, coreYears, target) => {
  let score = 0
  for (const year of coreYears) {
    score += Math.min(toNumber(target.minHitDecisionDatesPerYear, 2), metrics.hitDatesByYear?.[year] ?? 0) * 10
    score += Math.min(toNumber(target.minHitSymbolDatesPerYear, 2), metrics.hitSymbolDatesByYear?.[year] ?? 0) * 10
  }
  score += Math.min(toNumber(target.minPositiveSymbolDatesTotal, 18), metrics.totalHitSymbolDates ?? 0)
  if (metrics.year2hitPassed) score += 10000
  return score
}

const buildUnionState = ({ tiles, rowByKey, coreYears, target }) => {
  const keys = new Set()
  for (const tile of tiles) for (const key of tile.hitRowKeys ?? []) keys.add(key)
  const rows = [...keys].map((key) => rowByKey.get(key)).filter(Boolean)
  const metrics = metricsForRows(rows, coreYears, target)
  return { rows, metrics, hitRowKeys: uniqueSorted([...keys]) }
}

const buildUnionStateFromKeys = ({ hitRowKeys, rowByKey, coreYears, target }) => {
  const rows = [...hitRowKeys].map((key) => rowByKey.get(key)).filter(Boolean)
  const metrics = metricsForRows(rows, coreYears, target)
  return { rows, metrics, hitRowKeys: uniqueSorted([...hitRowKeys]) }
}

const positiveYearCount = (metrics, coreYears, key) =>
  coreYears.filter((year) => toNumber(metrics?.[key]?.[year], 0) > 0).length

const stabilityGateEnabled = (gate) => gate?.enabled === true

const tilePassesStabilityGate = ({ tile, coreYears, gate }) => {
  if (!stabilityGateEnabled(gate)) return true
  if (toNumber(tile?.metrics?.matchRows, 0) < toNumber(gate.minTileMatchRows, 0)) return false
  if (toNumber(tile?.metrics?.hitRows, 0) < toNumber(gate.minTileHitRows, 0)) return false
  if (toNumber(tile?.metrics?.falsePositiveRows, 0) > toNumber(gate.maxTileFalsePositiveRows, 0)) return false
  if (positiveYearCount(tile?.metrics, coreYears, "hitDatesByYear") < toNumber(gate.minTilePositiveYears, 0)) return false
  if (
    positiveYearCount(tile?.metrics, coreYears, "hitSymbolDatesByYear") <
    toNumber(gate.minTilePositiveSymbolDateYears, toNumber(gate.minTilePositiveYears, 0))
  ) {
    return false
  }
  if (gate.requireTileYear2Hit === true && tile?.metrics?.year2hitPassed !== true) return false
  return true
}

const coverPassesStabilityGate = ({ cover, tiles, rowByKey, contract, coreYears, gate }) => {
  if (!stabilityGateEnabled(gate)) return true
  if (!cover?.metrics?.year2hitPassed) return false
  const selectedTiles = Array.isArray(tiles) ? tiles : []
  if (selectedTiles.length < 1) return false
  const minContributors = toNumber(gate.minPerYearTileContributorCount, 0)
  if (minContributors > 0) {
    for (const year of coreYears) {
      const contributors = selectedTiles.filter((tile) => toNumber(tile?.metrics?.hitDatesByYear?.[year], 0) > 0).length
      if (contributors < minContributors) return false
    }
  }
  if (gate.rejectAllTilesYear2Incomplete === true && selectedTiles.every((tile) => tile?.metrics?.year2hitPassed !== true)) {
    return false
  }
  const minDatesAfterDrop = toNumber(gate.minHitDatesPerYearAfterSingleTileDrop, 0)
  const minSymbolDatesAfterDrop = toNumber(gate.minHitSymbolDatesPerYearAfterSingleTileDrop, 0)
  if (minDatesAfterDrop > 0 || minSymbolDatesAfterDrop > 0) {
    for (const droppedTile of selectedTiles) {
      const remainingKeys = new Set()
      for (const tile of selectedTiles) {
        if (tile.tileId === droppedTile.tileId) continue
        for (const key of tile.hitRowKeys ?? []) remainingKeys.add(key)
      }
      const remaining = buildUnionStateFromKeys({
        hitRowKeys: remainingKeys,
        rowByKey,
        coreYears,
        target: contract.target ?? {},
      })
      if (remaining.metrics.minHitDatesPerYear < minDatesAfterDrop) return false
      if (remaining.metrics.minHitSymbolDatesPerYear < minSymbolDatesAfterDrop) return false
    }
  }
  return true
}

const searchCoverCandidates = ({ parent, zeroFpTiles, rowByKey, contract, coreYears, coverOverride = null }) => {
  const target = contract.target ?? {}
  const cover = coverOverride ?? contract.cover ?? {}
  const stabilityGate = cover.stabilityGate ?? {}
  const maxTilesPerCover = toNumber(cover.maxTilesPerCover, 8)
  const beamWidth = toNumber(cover.beamWidth, 160)
  const maxCoverCandidates = toNumber(cover.maxCoverCandidatesPerParent, 20)
  if (maxCoverCandidates < 1) return []
  const tilePool = zeroFpTiles
    .filter((tile) => tile.metrics.hitRows > 0)
    .filter((tile) => tilePassesStabilityGate({ tile, coreYears, gate: stabilityGate }))
    .sort(
      (left, right) =>
        deficitScore(right.metrics, coreYears, target) - deficitScore(left.metrics, coreYears, target) ||
        right.metrics.hitRows - left.metrics.hitRows ||
        left.tileId.localeCompare(right.tileId),
    )
    .slice(0, Math.min(toNumber(cover.maxTilePoolForCover, 900), zeroFpTiles.length))
  const states = [
    {
      tileIds: [],
      tileIndexes: [],
      hitRowKeys: [],
      metrics: metricsForRows([], coreYears, target),
      score: 0,
    },
  ]
  const accepted = new Map()
  let frontier = states
  for (let depth = 1; depth <= maxTilesPerCover; depth += 1) {
    const next = new Map()
    for (const state of frontier) {
      const used = new Set(state.tileIndexes)
      for (let index = 0; index < tilePool.length; index += 1) {
        if (used.has(index)) continue
        const nextTileIndexes = [...state.tileIndexes, index]
        const tile = tilePool[index]
        const nextHitRowKeys = new Set(state.hitRowKeys ?? [])
        for (const key of tile.hitRowKeys ?? []) nextHitRowKeys.add(key)
        const union = buildUnionStateFromKeys({ hitRowKeys: nextHitRowKeys, rowByKey, coreYears, target })
        const tileIds = uniqueSorted([...state.tileIds, tile.tileId])
        const key = tileIds.join("|")
        const candidate = {
          coverId: `tp12_micro_cover_${hashId(`${parent.baseType}|${parent.baseId}|${key}`)}`,
          baseType: parent.baseType,
          baseId: parent.baseId,
          tileIds,
          tileIndexes: nextTileIndexes,
          tileCount: tileIds.length,
          metrics: union.metrics,
          hitRowKeys: union.hitRowKeys,
          score: deficitScore(union.metrics, coreYears, target) - tileIds.length,
        }
        const current = next.get(key)
        if (!current || candidate.score > current.score) next.set(key, candidate)
        if (
          candidate.metrics.year2hitPassed &&
          coverPassesStabilityGate({
            cover: candidate,
            tiles: nextTileIndexes.map((tileIndex) => tilePool[tileIndex]).filter(Boolean),
            rowByKey,
            contract,
            coreYears,
            gate: stabilityGate,
          })
        ) {
          accepted.set(key, candidate)
        }
      }
    }
    frontier = [...next.values()]
      .sort((left, right) => right.score - left.score || left.tileCount - right.tileCount || left.coverId.localeCompare(right.coverId))
      .slice(0, beamWidth)
    if (accepted.size >= maxCoverCandidates) break
  }
  return [...accepted.values()]
    .sort(
      (left, right) =>
        right.metrics.totalHitSymbolDates - left.metrics.totalHitSymbolDates ||
        left.tileCount - right.tileCount ||
        left.coverId.localeCompare(right.coverId),
    )
    .slice(0, maxCoverCandidates)
}

const makeCoverFromTiles = ({ parent, tiles, rowByKey, contract, coreYears, coverIdPrefix = "tp12_micro_cover" }) => {
  const union = buildUnionState({ tiles, rowByKey, coreYears, target: contract.target ?? {} })
  const tileIds = uniqueSorted(tiles.map((tile) => tile.tileId))
  return {
    coverId: `${coverIdPrefix}_${hashId(`${parent.baseType}|${parent.baseId}|${tileIds.join("|")}`)}`,
    baseType: parent.baseType,
    baseId: parent.baseId,
    tileIds,
    tileIndexes: [],
    tileCount: tileIds.length,
    metrics: union.metrics,
    hitRowKeys: union.hitRowKeys,
    score: deficitScore(union.metrics, coreYears, contract.target ?? {}) - tileIds.length,
  }
}

const searchGreedyCoverCandidates = ({ parent, zeroFpTiles, rowByKey, contract, coreYears, greedyConfig = {} }) => {
  const target = contract.target ?? {}
  const stabilityGate = greedyConfig.stabilityGate ?? {}
  const maxTilesPerCover = toNumber(greedyConfig.maxTilesPerCover, 36)
  const maxTilePool = toNumber(greedyConfig.maxTilePoolForCover, zeroFpTiles.length)
  const maxSeedTiles = toNumber(greedyConfig.maxSeedTiles, 80)
  const maxCoverCandidates = toNumber(greedyConfig.maxCoverCandidates, 20)
  if (maxCoverCandidates < 1) return []
  const tilePool = zeroFpTiles
    .filter((tile) => tile.metrics.hitRows > 0)
    .filter((tile) => tilePassesStabilityGate({ tile, coreYears, gate: stabilityGate }))
    .sort(
      (left, right) =>
        tileSortScore(right, coreYears, target) - tileSortScore(left, coreYears, target) ||
        right.metrics.hitRows - left.metrics.hitRows ||
        left.tileId.localeCompare(right.tileId),
    )
    .slice(0, Math.min(maxTilePool, zeroFpTiles.length))

  const buildGreedyFromSeed = (seedTiles) => {
    const selected = [...seedTiles]
    const selectedIds = new Set(selected.map((tile) => tile.tileId))
    const hitRowKeys = new Set()
    for (const tile of selected) for (const key of tile.hitRowKeys ?? []) hitRowKeys.add(key)
    let current = buildUnionStateFromKeys({ hitRowKeys, rowByKey, coreYears, target })

    while (!current.metrics.year2hitPassed && selected.length < maxTilesPerCover) {
      const currentScore = deficitScore(current.metrics, coreYears, target)
      let best = null
      for (const tile of tilePool) {
        if (selectedIds.has(tile.tileId)) continue
        const nextHitRowKeys = new Set(current.hitRowKeys)
        for (const key of tile.hitRowKeys ?? []) nextHitRowKeys.add(key)
        if (nextHitRowKeys.size === current.hitRowKeys.length) continue
        const next = buildUnionStateFromKeys({ hitRowKeys: nextHitRowKeys, rowByKey, coreYears, target })
        const gain = deficitScore(next.metrics, coreYears, target) - currentScore
        if (gain <= 0) continue
        const candidate = {
          tile,
          union: next,
          gain,
          score:
            gain * 100000 +
            tileSortScore(tile, coreYears, target) * 10 +
            tile.metrics.hitRows -
            selected.length,
        }
        if (!best || candidate.score > best.score || (candidate.score === best.score && tile.tileId.localeCompare(best.tile.tileId) < 0)) {
          best = candidate
        }
      }
      if (!best) break
      selected.push(best.tile)
      selectedIds.add(best.tile.tileId)
      current = best.union
    }

    if (!current.metrics.year2hitPassed) return null
    const cover = makeCoverFromTiles({
      parent,
      tiles: selected,
      rowByKey,
      contract,
      coreYears,
      coverIdPrefix: "tp12_micro_greedy_cover",
    })
    if (!coverPassesStabilityGate({ cover, tiles: selected, rowByKey, contract, coreYears, gate: stabilityGate })) {
      return null
    }
    return cover
  }

  const candidates = new Map()
  const addCandidate = (cover) => {
    if (!cover) return
    const key = cover.tileIds.join("|")
    const current = candidates.get(key)
    if (!current || cover.score > current.score) candidates.set(key, cover)
  }
  addCandidate(buildGreedyFromSeed([]))
  for (const tile of tilePool.slice(0, Math.min(maxSeedTiles, tilePool.length))) {
    addCandidate(buildGreedyFromSeed([tile]))
    if (candidates.size >= maxCoverCandidates) break
  }

  return [...candidates.values()]
    .sort(
      (left, right) =>
        right.metrics.totalHitSymbolDates - left.metrics.totalHitSymbolDates ||
        left.tileCount - right.tileCount ||
        left.coverId.localeCompare(right.coverId),
    )
    .slice(0, maxCoverCandidates)
}

const bestRulesByParent = (rules, enabledBaseTypes, maxParents) => {
  const groups = new Map()
  for (const rule of rules) {
    const baseType = toText(rule.baseType)
    const baseId = toText(rule.baseId)
    if (!enabledBaseTypes.includes(baseType)) continue
    const key = `${baseType}\t${baseId}`
    const rows = groups.get(key) ?? []
    rows.push(rule)
    groups.set(key, rows)
  }
  const parents = []
  for (const [key, rows] of groups.entries()) {
    rows.sort(
      (left, right) =>
        toNumber(left.replayMetrics?.falsePositiveRows, Infinity) - toNumber(right.replayMetrics?.falsePositiveRows, Infinity) ||
        toNumber(right.replayMetrics?.hitRows, 0) - toNumber(left.replayMetrics?.hitRows, 0) ||
        toNumber(right.replayMetrics?.matchRows, 0) - toNumber(left.replayMetrics?.matchRows, 0),
    )
    const [baseType, baseId] = key.split("\t")
    parents.push({ baseType, baseId, rules: rows, bestRule: rows[0] })
  }
  return parents
    .sort(
      (left, right) =>
        toNumber(left.bestRule?.replayMetrics?.falsePositiveRows, Infinity) -
          toNumber(right.bestRule?.replayMetrics?.falsePositiveRows, Infinity) ||
        toNumber(right.bestRule?.replayMetrics?.hitRows, 0) - toNumber(left.bestRule?.replayMetrics?.hitRows, 0) ||
        toNumber(right.bestRule?.replayMetrics?.matchRows, 0) - toNumber(left.bestRule?.replayMetrics?.matchRows, 0) ||
        `${left.baseType}:${left.baseId}`.localeCompare(`${right.baseType}:${right.baseId}`),
    )
    .slice(0, maxParents)
}

const writeRows = async (filePath, rows) => {
  const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
  try {
    for (const row of rows) await writeJsonlRow(stream, row)
  } finally {
    await closeWriteStream(stream)
  }
}

const compactTileForOutput = (tile) => ({
  ...tile,
  hitRowKeys: undefined,
  hitDateKeys: undefined,
})

const compactCoverForOutput = (cover, { includeHitRowKeys = false } = {}) => ({
  ...cover,
  tileIndexes: undefined,
  hitRowKeys: includeHitRowKeys ? cover.hitRowKeys : undefined,
})

const compactGlobalCoverForOutput = (cover, { includeHitRowKeys = false } = {}) =>
  compactCoverForOutput(
    {
      ...cover,
      globalCover: true,
      baseType: "all_year2hit_rows",
      baseId: "global_zero_fp_tile_union",
    },
    { includeHitRowKeys },
  )

export const main = async (argv = process.argv.slice(2), { cwd = process.cwd() } = {}) => {
  const flags = parseCliArgs(argv).flags ?? {}
  const contractPath = requirePath(getFlag(flags, "contract", ""), "contract", cwd)
  const brokenRulesPath = requirePath(getFlag(flags, "broken-rules", getFlag(flags, "rules", "")), "broken-rules", cwd)
  const outDir = path.resolve(cwd, toText(getFlag(flags, "out-dir", "")))
  if (!toText(outDir)) throw new Error("--out-dir is required")
  const contract = await readJson(contractPath)
  const { dateFrom, dateTo, coreYears } = assertContract(contract)
  let rows = []
  const enrichedFlag = toText(getFlag(flags, "enriched", ""))
  const inputs = {
    contractPath,
    brokenRulesPath,
    dateFrom,
    dateTo,
    hitDefinition: hitDefinitionOf(contract),
  }
  if (enrichedFlag) {
    const enrichedPath = requirePath(enrichedFlag, "enriched", cwd)
    rows = hydrateRows({ rows: await readJsonlRows(enrichedPath), contract, dateFrom, dateTo })
    inputs.enrichedPath = enrichedPath
  } else {
    const eventsPath = requirePath(getFlag(flags, "events", ""), "events", cwd)
    const contextPath = requirePath(getFlag(flags, "context", ""), "context", cwd)
    const labelsPath = requirePath(getFlag(flags, "labels", ""), "labels", cwd)
    const clustersPath = requirePath(getFlag(flags, "clusters", ""), "clusters", cwd)
    const catalogPath = requirePath(getFlag(flags, "catalog", ""), "catalog", cwd)
    const priorStrengthRow = toNumber(getFlag(flags, "prior-strength-row", 100), 100)
    const priorStrengthDate = toNumber(getFlag(flags, "prior-strength-date", 50), 50)
    const contextByKey = await loadContextBySymbolDate(contextPath)
    const labelByKey = await loadLabelBySymbolDate(labelsPath)
    const patternTokens = await loadPatternTokens(catalogPath)
    const clusterByPattern = await loadClusterByPattern(clustersPath)
    const reliability = await buildPatternReliability({ eventsPath, priorStrengthRow, priorStrengthDate })
    const consensus = await buildConsensusRows({
      eventsPath,
      contextByKey,
      labelByKey,
      patternTokens,
      clusterByPattern,
      reliabilityByPattern: reliability.reliabilityByPattern,
    })
    rows = hydrateRows({ rows: consensus.rows, contract, dateFrom, dateTo })
    Object.assign(inputs, {
      eventsPath,
      contextPath,
      labelsPath,
      clustersPath,
      catalogPath,
      priorStrengthRow,
      priorStrengthDate,
      reliabilitySummary: reliability.reliabilitySummary,
      consensusSummary: consensus.consensusSummary,
    })
  }
  const rules = await readJsonlRows(brokenRulesPath)
  if (rules.length < 1) throw new Error(`broken-rules input produced zero rows: ${brokenRulesPath}`)
  const enabledBaseTypes = (contract?.parents?.enabledBaseTypes ?? []).map(toText)
  if (enabledBaseTypes.length < 1) throw new Error("contract parents.enabledBaseTypes must not be empty")
  const maxParents = toNumber(getFlag(flags, "max-parents", contract?.parents?.maxParents ?? 24), contract?.parents?.maxParents ?? 24)
  const parents = bestRulesByParent(rules, enabledBaseTypes, maxParents)
  if (parents.length < 1) throw new Error("no enabled parents were found in broken-rules input")
  const rowByKey = new Map(rows.map((row) => [rowKeyOf(row), row]))
  const maxParentRows = toNumber(contract?.parents?.maxParentRows, 25000)

  const counterexampleLedger = rules.map((rule) => ({
    kind: "tp12_year2hit_zero_fp_micro_split_counterexample_v1",
    baseType: rule.baseType,
    baseId: rule.baseId,
    depth: rule.depth ?? (rule.atoms ?? []).length,
    atomLabels: rule.atomLabels ?? (rule.atoms ?? []).map((atom) => normalizeAtom(atom).label),
    originalMetrics: rule.metrics ?? null,
    fullTrainReplayMetrics: rule.replayMetrics ?? null,
    sampleFalsePositiveRows: rule.replaySampleFalsePositiveRows ?? [],
    missingCoreYears: coreYears.filter((year) => toNumber(rule.replayMetrics?.hitDatesByYear?.[year], 0) < toNumber(contract.target.minHitDecisionDatesPerYear, 2)),
  }))

  const parentSummaries = []
  const candidateTiles = []
  const zeroFpTiles = []
  const globalZeroFpTiles = []
  const coverCandidates = []
  const finalSurvivors = []
  const globalCoverCandidates = []
  const globalFinalSurvivors = []
  const globalGreedyCoverCandidates = []
  const globalGreedyFinalSurvivors = []
  const rejected = []
  const emitTileCatalogs = contract?.outputs?.emitTileCatalogs === true
  const emitGlobalZeroFpTilePool = contract?.outputs?.emitGlobalZeroFpTilePool === true
  let internalCandidateTileCount = 0
  let internalZeroFpTileCount = 0

  for (const parent of parents) {
    const parentRows = rows.filter((row) => rowMatchesBase(row, parent.baseType, parent.baseId))
    const parentMetrics = metricsForRows(parentRows, coreYears, contract.target)
    if (parentRows.length > maxParentRows) {
      rejected.push({
        kind: "tp12_year2hit_zero_fp_micro_split_rejection_v1",
        baseType: parent.baseType,
        baseId: parent.baseId,
        reason: "parent_rows_exceed_contract_max",
        parentRowCount: parentRows.length,
        maxParentRows,
      })
      continue
    }
    const mined = mineParentTiles({ parent, parentRows, parentRules: parent.rules, contract, coreYears })
    internalCandidateTileCount += mined.candidateTileCount
    internalZeroFpTileCount += mined.zeroFpTilesForCover.length
    if (contract?.globalCover?.enabled === true || emitGlobalZeroFpTilePool) {
      for (const tile of mined.zeroFpTilesForCover) globalZeroFpTiles.push(tile)
    }
    if (emitTileCatalogs) {
      for (const tile of mined.candidateTiles) candidateTiles.push(tile)
      for (const tile of mined.zeroFpTiles) zeroFpTiles.push(tile)
    }
    const covers = searchCoverCandidates({ parent, zeroFpTiles: mined.zeroFpTilesForCover, rowByKey, contract, coreYears })
    for (const cover of covers) {
      const tileMap = new Map(mined.zeroFpTilesForCover.map((tile) => [tile.tileId, tile]))
      cover.tiles = cover.tileIds.map((tileId) => {
        const tile = tileMap.get(tileId)
        if (!tile) throw new Error(`cover references missing zero-FP tile: ${cover.coverId}::${tileId}`)
        return {
          tileId,
          includeAtoms: tile.includeAtoms,
          vetoAtoms: tile.vetoAtoms,
          metrics: tile.metrics,
        }
      })
      coverCandidates.push(cover)
      if (cover.metrics.falsePositiveRows === 0 && cover.metrics.year2hitPassed) finalSurvivors.push(cover)
    }
    const bestCover = covers[0] ?? null
    parentSummaries.push({
      kind: "tp12_year2hit_zero_fp_micro_split_parent_summary_v1",
      baseType: parent.baseType,
      baseId: parent.baseId,
      parentRowCount: parentRows.length,
      sourceRuleVariantCount: parent.rules.length,
      parentMetrics,
      bestSourceReplayMetrics: parent.bestRule?.replayMetrics ?? null,
      atomPoolCount: mined.atomPool.length,
      coreSetCount: mined.coreSetCount,
      candidateTileCount: mined.candidateTileCount,
      zeroFpTileCount: mined.zeroFpTilesForCover.length,
      zeroFpTileOutputCount: mined.zeroFpTiles.length,
      coverCandidateCount: covers.length,
      finalSurvivorCount: covers.filter((cover) => cover.metrics.falsePositiveRows === 0 && cover.metrics.year2hitPassed).length,
      bestCoverMetrics: bestCover?.metrics ?? null,
    })
    if (mined.zeroFpTilesForCover.length < 1) {
      rejected.push({
        kind: "tp12_year2hit_zero_fp_micro_split_rejection_v1",
        baseType: parent.baseType,
        baseId: parent.baseId,
        reason: "unsat_counterexample_not_separable",
        parentMetrics,
      })
    } else if (!bestCover) {
      rejected.push({
        kind: "tp12_year2hit_zero_fp_micro_split_rejection_v1",
        baseType: parent.baseType,
        baseId: parent.baseId,
        reason: "unsat_year_cover_gap",
        zeroFpTileCount: mined.zeroFpTilesForCover.length,
        bestZeroFpTileMetrics: mined.zeroFpTilesForCover[0]?.metrics ?? null,
      })
    }
    console.error(
      JSON.stringify({
        progress: "parent_done",
        baseType: parent.baseType,
        baseId: parent.baseId,
        parentIndex: parentSummaries.length,
        parentCount: parents.length,
        zeroFpTileCount: mined.zeroFpTilesForCover.length,
        coverCandidateCount: covers.length,
        finalSurvivorCount: covers.filter((cover) => cover.metrics.falsePositiveRows === 0 && cover.metrics.year2hitPassed).length,
      }),
    )
  }

  if (contract?.globalCover?.enabled === true) {
    const globalParent = {
      baseType: "all_year2hit_rows",
      baseId: "global_zero_fp_tile_union",
    }
    const covers = searchCoverCandidates({
      parent: globalParent,
      zeroFpTiles: globalZeroFpTiles,
      rowByKey,
      contract,
      coreYears,
      coverOverride: contract.globalCover.cover ?? contract.cover,
    })
    const tileMap = new Map(globalZeroFpTiles.map((tile) => [tile.tileId, tile]))
    for (const cover of covers) {
      cover.globalCover = true
      cover.tiles = cover.tileIds.map((tileId) => {
        const tile = tileMap.get(tileId)
        if (!tile) throw new Error(`global cover references missing zero-FP tile: ${cover.coverId}::${tileId}`)
        return {
          tileId,
          baseType: tile.baseType,
          baseId: tile.baseId,
          includeAtoms: tile.includeAtoms,
          vetoAtoms: tile.vetoAtoms,
          metrics: tile.metrics,
        }
      })
      globalCoverCandidates.push(cover)
      if (cover.metrics.falsePositiveRows === 0 && cover.metrics.year2hitPassed) globalFinalSurvivors.push(cover)
    }
    if (contract.globalCover.greedy?.enabled === true) {
      const greedyCovers = searchGreedyCoverCandidates({
        parent: globalParent,
        zeroFpTiles: globalZeroFpTiles,
        rowByKey,
        contract,
        coreYears,
        greedyConfig: contract.globalCover.greedy,
      })
      for (const cover of greedyCovers) {
        cover.globalCover = true
        cover.greedyCover = true
        cover.tiles = cover.tileIds.map((tileId) => {
          const tile = tileMap.get(tileId)
          if (!tile) throw new Error(`global greedy cover references missing zero-FP tile: ${cover.coverId}::${tileId}`)
          return {
            tileId,
            baseType: tile.baseType,
            baseId: tile.baseId,
            includeAtoms: tile.includeAtoms,
            vetoAtoms: tile.vetoAtoms,
            metrics: tile.metrics,
          }
        })
        globalGreedyCoverCandidates.push(cover)
        if (cover.metrics.falsePositiveRows === 0 && cover.metrics.year2hitPassed) globalGreedyFinalSurvivors.push(cover)
      }
    }
    console.error(
      JSON.stringify({
        progress: "global_cover_done",
        zeroFpTileCount: globalZeroFpTiles.length,
        coverCandidateCount: globalCoverCandidates.length,
        finalSurvivorCount: globalFinalSurvivors.length,
        greedyCoverCandidateCount: globalGreedyCoverCandidates.length,
        greedyFinalSurvivorCount: globalGreedyFinalSurvivors.length,
      }),
    )
  }

  finalSurvivors.sort(
    (left, right) =>
      right.metrics.totalHitSymbolDates - left.metrics.totalHitSymbolDates ||
      left.tileCount - right.tileCount ||
      left.coverId.localeCompare(right.coverId),
  )

  const outputPaths = {
    summary: path.join(outDir, "micro_split_summary.json"),
    counterexampleLedger: path.join(outDir, "counterexample_ledger.jsonl"),
    parentSummary: path.join(outDir, "parent_failure_summary.jsonl"),
    candidateTiles: path.join(outDir, "micro_split_candidate_tiles.jsonl"),
    zeroFpTiles: path.join(outDir, "micro_split_zero_fp_tiles.jsonl"),
    globalZeroFpTilePool: path.join(outDir, "micro_split_global_zero_fp_tile_pool.jsonl"),
    coverCandidates: path.join(outDir, "micro_split_year_cover_candidates.jsonl"),
    finalSurvivors: path.join(outDir, "micro_split_final_survivors.jsonl"),
    globalCoverCandidates: path.join(outDir, "micro_split_global_year_cover_candidates.jsonl"),
    globalFinalSurvivors: path.join(outDir, "micro_split_global_final_survivors.jsonl"),
    globalGreedyCoverCandidates: path.join(outDir, "micro_split_global_greedy_cover_candidates.jsonl"),
    globalGreedyFinalSurvivors: path.join(outDir, "micro_split_global_greedy_final_survivors.jsonl"),
    rejected: path.join(outDir, "micro_split_rejected.jsonl"),
  }
  await ensureDir(outDir)
  await writeRows(outputPaths.counterexampleLedger, counterexampleLedger)
  await writeRows(outputPaths.parentSummary, parentSummaries)
  await writeRows(outputPaths.candidateTiles, emitTileCatalogs ? candidateTiles.map(compactTileForOutput) : [])
  await writeRows(outputPaths.zeroFpTiles, emitTileCatalogs ? zeroFpTiles.map(compactTileForOutput) : [])
  await writeRows(
    outputPaths.globalZeroFpTilePool,
    emitGlobalZeroFpTilePool ? globalZeroFpTiles.map(compactTileForOutput) : [],
  )
  await writeRows(outputPaths.coverCandidates, coverCandidates.map((cover) => compactCoverForOutput(cover)))
  await writeRows(outputPaths.finalSurvivors, finalSurvivors.map((cover) => compactCoverForOutput(cover, { includeHitRowKeys: true })))
  await writeRows(outputPaths.globalCoverCandidates, globalCoverCandidates.map((cover) => compactGlobalCoverForOutput(cover)))
  await writeRows(outputPaths.globalFinalSurvivors, globalFinalSurvivors.map((cover) => compactGlobalCoverForOutput(cover, { includeHitRowKeys: true })))
  await writeRows(outputPaths.globalGreedyCoverCandidates, globalGreedyCoverCandidates.map((cover) => compactGlobalCoverForOutput(cover)))
  await writeRows(
    outputPaths.globalGreedyFinalSurvivors,
    globalGreedyFinalSurvivors.map((cover) => compactGlobalCoverForOutput(cover, { includeHitRowKeys: true })),
  )
  await writeRows(outputPaths.rejected, rejected)

  const totalFinalSurvivorCount =
    finalSurvivors.length + globalFinalSurvivors.length + globalGreedyFinalSurvivors.length
  const summary = {
    kind: "tp12_year2hit_zero_fp_micro_split_summary_v1",
    generatedAt: new Date().toISOString(),
    status: "completed",
    verdict: totalFinalSurvivorCount > 0 ? "survivors_found" : "no_full_train_zero_fp_year2hit_survivors",
    inputs: {
      ...inputs,
    },
    scopedRowCount: rows.length,
    sourceRuleCount: rules.length,
    enabledParentCount: parents.length,
    processedParentCount: parentSummaries.length,
    counterexampleLedgerCount: counterexampleLedger.length,
    candidateTileCount: internalCandidateTileCount,
    candidateTileOutputCount: candidateTiles.length,
    zeroFpTileCount: internalZeroFpTileCount,
    zeroFpTileOutputCount: zeroFpTiles.length,
    coverCandidateCount: coverCandidates.length,
    finalSurvivorCount: finalSurvivors.length,
    globalCoverEnabled: contract?.globalCover?.enabled === true,
    globalZeroFpTileCount: globalZeroFpTiles.length,
    globalCoverCandidateCount: globalCoverCandidates.length,
    globalFinalSurvivorCount: globalFinalSurvivors.length,
    globalGreedyCoverCandidateCount: globalGreedyCoverCandidates.length,
    globalGreedyFinalSurvivorCount: globalGreedyFinalSurvivors.length,
    totalFinalSurvivorCount,
    rejectionCount: rejected.length,
    topParentSummaries: parentSummaries
      .slice()
      .sort(
        (left, right) =>
          right.finalSurvivorCount - left.finalSurvivorCount ||
          right.zeroFpTileCount - left.zeroFpTileCount ||
          toNumber(left.bestSourceReplayMetrics?.falsePositiveRows, Infinity) -
            toNumber(right.bestSourceReplayMetrics?.falsePositiveRows, Infinity) ||
          `${left.baseType}:${left.baseId}`.localeCompare(`${right.baseType}:${right.baseId}`),
      )
      .slice(0, 20),
    topFinalSurvivors: finalSurvivors.slice(0, 20).map((survivor) => ({
      coverId: survivor.coverId,
      baseType: survivor.baseType,
      baseId: survivor.baseId,
      tileCount: survivor.tileCount,
      metrics: survivor.metrics,
      tileIds: survivor.tileIds,
    })),
    topGlobalFinalSurvivors: globalFinalSurvivors.slice(0, 20).map((survivor) => ({
      coverId: survivor.coverId,
      baseType: "all_year2hit_rows",
      baseId: "global_zero_fp_tile_union",
      tileCount: survivor.tileCount,
      metrics: survivor.metrics,
      tileIds: survivor.tileIds,
    })),
    topGlobalGreedyFinalSurvivors: globalGreedyFinalSurvivors.slice(0, 20).map((survivor) => ({
      coverId: survivor.coverId,
      baseType: "all_year2hit_rows",
      baseId: "global_zero_fp_tile_union",
      tileCount: survivor.tileCount,
      metrics: survivor.metrics,
      tileIds: survivor.tileIds,
    })),
    outputPaths,
  }
  await writeJson(outputPaths.summary, summary)
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        verdict: summary.verdict,
        scopedRowCount: summary.scopedRowCount,
        sourceRuleCount: summary.sourceRuleCount,
        enabledParentCount: summary.enabledParentCount,
        candidateTileCount: summary.candidateTileCount,
        zeroFpTileCount: summary.zeroFpTileCount,
        coverCandidateCount: summary.coverCandidateCount,
        finalSurvivorCount: summary.finalSurvivorCount,
        globalCoverCandidateCount: summary.globalCoverCandidateCount,
        globalFinalSurvivorCount: summary.globalFinalSurvivorCount,
        globalGreedyCoverCandidateCount: summary.globalGreedyCoverCandidateCount,
        globalGreedyFinalSurvivorCount: summary.globalGreedyFinalSurvivorCount,
        summaryPath: outputPaths.summary,
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
