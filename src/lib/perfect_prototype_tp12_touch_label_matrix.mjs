import { scoreTp12TouchBundleRow } from "./perfect_prototype_tp12_touch_scorecard_bundle.mjs"

const uniqueSorted = (values = []) =>
  Array.from(
    new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const buildRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const buildTokenList = (row) =>
  uniqueSorted([
    ...(Array.isArray(row?.tokens) ? row.tokens : []),
    ...(Array.isArray(row?.categoricalTokens) ? row.categoricalTokens : []),
    ...(Array.isArray(row?.contextualTokens) ? row.contextualTokens : []),
    ...(row?.tokenSet instanceof Set ? Array.from(row.tokenSet) : []),
  ])

const buildRowEntries = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    rowKey: buildRowKey(row),
    sourceId: row?.sourceId ?? null,
    dateKey: row?.dateKey ?? null,
    monthKey: row?.monthKey ?? buildMonthKey(row?.dateKey),
    dateFoldKey: row?.dateFoldKey ?? null,
    symbol: row?.symbol ?? null,
    outcomeHitTarget: row?.outcomeHitTarget === true,
    tokens: buildTokenList(row),
    matchedTermIds: [],
  }))

export const summarizeTp12TouchSelectedRowEntries = (rowEntries = []) => {
  const safeRows = Array.isArray(rowEntries) ? rowEntries : []
  const positives = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  const hitDates = uniqueSorted(positives.map((row) => row?.dateKey).filter(Boolean))
  const topDateCounts = new Map()
  for (const row of positives) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    topDateCounts.set(dateKey, Number(topDateCounts.get(dateKey) ?? 0) + 1)
  }
  const top1DateHits = Array.from(topDateCounts.values()).sort((a, b) => b - a)[0] ?? 0
  return {
    selectedRowCount: safeRows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    precision: safeRows.length > 0 ? positives.length / safeRows.length : 0,
    matchedDateCount: hitDates.length,
    matchedMonthCount: uniqueSorted(hitDates.map(buildMonthKey).filter(Boolean)).length,
    matchedFoldCount: uniqueSorted(positives.map((row) => row?.dateFoldKey).filter(Boolean)).length,
    selectedDateCount: uniqueSorted(safeRows.map((row) => row?.dateKey).filter(Boolean)).length,
    selectedSymbolCount: uniqueSorted(safeRows.map((row) => row?.symbol).filter(Boolean)).length,
    top1DateHitShare: positives.length > 0 ? top1DateHits / positives.length : 0,
    zeroNegative: safeRows.length > 0 && negatives.length === 0,
    perfectDateFloor3:
      safeRows.length > 0 && negatives.length === 0 && positives.length >= 3 && hitDates.length >= 3,
  }
}

const buildRoleCounts = (terms = []) => {
  const out = {
    donor_exact: 0,
    cluster_any: 0,
    broadened_rule: 0,
    parent_lift: 0,
  }
  for (const term of Array.isArray(terms) ? terms : []) {
    const role = String(term?.role ?? "").trim()
    if (role in out) out[role] += 1
  }
  return out
}

const evaluateTermOnRows = ({ term, rows = [] } = {}) => {
  const artifact = {
    threshold: 1,
    terms: [term],
  }
  const rowKeys = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const evaluation = scoreTp12TouchBundleRow({ artifact, row })
    if (evaluation?.selected !== true) continue
    rowKeys.push(buildRowKey(row))
  }
  return uniqueSorted(rowKeys)
}

const attachMatchedTerms = ({ rowEntries = [], termEntries = [], key = "trainRowKeys" } = {}) => {
  const rowMap = new Map((Array.isArray(rowEntries) ? rowEntries : []).map((row) => [row.rowKey, row]))
  for (const term of Array.isArray(termEntries) ? termEntries : []) {
    for (const rowKey of Array.isArray(term?.[key]) ? term[key] : []) {
      const row = rowMap.get(String(rowKey ?? "").trim())
      if (!row) continue
      row.matchedTermIds.push(term.termId)
    }
  }
  return Array.from(rowMap.values()).map((row) => ({
    ...row,
    matchedTermIds: uniqueSorted(row.matchedTermIds),
  }))
}

export const buildTp12TouchLabelMatrix = ({ termBank = {}, trainRows = [], oosRows = [] } = {}) => {
  const terms = Array.isArray(termBank?.qualifiedTerms) ? termBank.qualifiedTerms : []
  const trainEntries = buildRowEntries(trainRows)
  const oosEntries = buildRowEntries(oosRows)
  const trainRowsByKey = new Map((Array.isArray(trainRows) ? trainRows : []).map((row) => [buildRowKey(row), row]))
  const oosRowsByKey = new Map((Array.isArray(oosRows) ? oosRows : []).map((row) => [buildRowKey(row), row]))

  const termEntries = terms.map((term) => ({
    termId: term.termId,
    role: term.role,
    weight: toNumber(term.weight, 0),
    label: term.label ?? term.termId,
    meta: term.meta ?? {},
    trainSummary: term.trainSummary ?? {},
    oosSummary: term.oosSummary ?? {},
    trainRowKeys: evaluateTermOnRows({ term, rows: trainRows }),
    oosRowKeys: evaluateTermOnRows({ term, rows: oosRows }),
  }))

  const materializedTrainEntries = attachMatchedTerms({ rowEntries: trainEntries, termEntries, key: "trainRowKeys" })
  const materializedOosEntries = attachMatchedTerms({ rowEntries: oosEntries, termEntries, key: "oosRowKeys" })

  return {
    summary: {
      termCount: termEntries.length,
      roleCounts: buildRoleCounts(termEntries),
      trainRowCount: materializedTrainEntries.length,
      oosRowCount: materializedOosEntries.length,
      trainRowsWithAnyTerm: materializedTrainEntries.filter((row) => row.matchedTermIds.length > 0).length,
      oosRowsWithAnyTerm: materializedOosEntries.filter((row) => row.matchedTermIds.length > 0).length,
    },
    terms: termEntries,
    trainRows: materializedTrainEntries,
    oosRows: materializedOosEntries,
    runtime: {
      trainRowsByKey: Object.fromEntries(Array.from(trainRowsByKey.entries())),
      oosRowsByKey: Object.fromEntries(Array.from(oosRowsByKey.entries())),
    },
  }
}

export const applyTp12TouchLabelSelection = ({ rowEntries = [], positiveTermIds = [], vetoTokens = [] } = {}) => {
  const positiveSet = new Set(uniqueSorted(positiveTermIds))
  const vetoSet = new Set(uniqueSorted(vetoTokens))
  const selectedRows = []
  const vetoedRows = []
  for (const row of Array.isArray(rowEntries) ? rowEntries : []) {
    const matchedTermIds = Array.isArray(row?.matchedTermIds) ? row.matchedTermIds : []
    if (positiveSet.size > 0 && !matchedTermIds.some((termId) => positiveSet.has(termId))) continue
    const vetoed = Array.isArray(row?.tokens) ? row.tokens.some((token) => vetoSet.has(token)) : false
    if (vetoed) {
      vetoedRows.push(row)
      continue
    }
    selectedRows.push(row)
  }
  return {
    selectedRows,
    vetoedRows,
    summary: summarizeTp12TouchSelectedRowEntries(selectedRows),
  }
}
