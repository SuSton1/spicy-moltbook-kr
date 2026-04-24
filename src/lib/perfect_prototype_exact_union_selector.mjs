const uniqueStrings = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const buildRowKey = (row) =>
  String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()

const rowMatchesRule = (row, rule) => {
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(uniqueStrings(row?.categoricalTokens ?? []))
  return Array.isArray(rule?.ruleTokens) && rule.ruleTokens.every((token) => tokenSet.has(token))
}

const summarizeSelectedRows = (rows = []) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const positives = safeRows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = safeRows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    selectedRowCount: safeRows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    precision: safeRows.length > 0 ? positives.length / safeRows.length : 0,
    matchedDateCount: new Set(positives.map((row) => row?.dateKey).filter(Boolean)).size,
    matchedMonthCount: new Set(positives.map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
    matchedFoldCount: new Set(positives.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
    selectedDateCount: new Set(safeRows.map((row) => row?.dateKey).filter(Boolean)).size,
    selectedSymbolCount: new Set(safeRows.map((row) => row?.symbol).filter(Boolean)).size,
  }
}

const evaluateUnion = ({ rows = [], rules = [] } = {}) => {
  const seen = new Set()
  const selectedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!(Array.isArray(rules) ? rules : []).some((rule) => rowMatchesRule(row, rule))) continue
    const rowKey = buildRowKey(row)
    if (!rowKey || seen.has(rowKey)) continue
    seen.add(rowKey)
    selectedRows.push(row)
  }
  return {
    selectedRows,
    summary: summarizeSelectedRows(selectedRows),
  }
}

const compareRules = (left, right) => {
  if (Number(left?.qValue ?? 1) !== Number(right?.qValue ?? 1)) {
    return Number(left?.qValue ?? 1) - Number(right?.qValue ?? 1)
  }
  if (Number(right?.selectionFrequency ?? 0) !== Number(left?.selectionFrequency ?? 0)) {
    return Number(right?.selectionFrequency ?? 0) - Number(left?.selectionFrequency ?? 0)
  }
  if (Number(left?.crossfitNegativeWindowCount ?? 0) !== Number(right?.crossfitNegativeWindowCount ?? 0)) {
    return Number(left?.crossfitNegativeWindowCount ?? 0) - Number(right?.crossfitNegativeWindowCount ?? 0)
  }
  if (Number(right?.trainSummary?.matchedDateCount ?? 0) !== Number(left?.trainSummary?.matchedDateCount ?? 0)) {
    return Number(right?.trainSummary?.matchedDateCount ?? 0) - Number(left?.trainSummary?.matchedDateCount ?? 0)
  }
  return Number(left?.ruleTokens?.length ?? 0) - Number(right?.ruleTokens?.length ?? 0)
}

export const buildPerfectPrototypeExactUnionSelector = ({
  qualifiedRules = [],
  trainRows = [],
  oosRows = [],
  minTrainDates = 10,
  minTrainMonths = 6,
  minTrainFolds = 4,
  maxRules = 6,
  maxPerFamily = 2,
} = {}) => {
  const selectedRules = []
  const perFamilyCounts = new Map()
  const rankedRules = (Array.isArray(qualifiedRules) ? qualifiedRules : []).slice().sort(compareRules)
  let currentTrain = evaluateUnion({ rows: trainRows, rules: [] })

  for (const rule of rankedRules) {
    const familyId = String(rule?.familyId ?? "").trim()
    if (familyId && Number(perFamilyCounts.get(familyId) ?? 0) >= Number(maxPerFamily)) continue
    if (selectedRules.length >= Number(maxRules)) break
    const nextRules = [...selectedRules, rule]
    const nextTrain = evaluateUnion({
      rows: trainRows,
      rules: nextRules,
    })
    const improvement =
      Number(nextTrain.summary.matchedDateCount ?? 0) > Number(currentTrain.summary.matchedDateCount ?? 0) ||
      Number(nextTrain.summary.matchedMonthCount ?? 0) > Number(currentTrain.summary.matchedMonthCount ?? 0) ||
      Number(nextTrain.summary.matchedFoldCount ?? 0) > Number(currentTrain.summary.matchedFoldCount ?? 0) ||
      Number(nextTrain.summary.selectedRowCount ?? 0) > Number(currentTrain.summary.selectedRowCount ?? 0)
    if (!improvement) continue
    if (Number(nextTrain.summary.precision ?? 0) < 1) continue
    selectedRules.push(rule)
    currentTrain = nextTrain
    if (familyId) perFamilyCounts.set(familyId, Number(perFamilyCounts.get(familyId) ?? 0) + 1)
  }

  const trainUnion = evaluateUnion({
    rows: trainRows,
    rules: selectedRules,
  })
  const oosUnion = evaluateUnion({
    rows: oosRows,
    rules: selectedRules,
  })
  const ok =
    selectedRules.length > 0 &&
    Number(trainUnion.summary.precision ?? 0) >= 1 &&
    Number(trainUnion.summary.matchedDateCount ?? 0) >= Number(minTrainDates) &&
    Number(trainUnion.summary.matchedMonthCount ?? 0) >= Number(minTrainMonths) &&
    Number(trainUnion.summary.matchedFoldCount ?? 0) >= Number(minTrainFolds)

  return {
    ok,
    reason: ok ? null : selectedRules.length < 1 ? "unsat_union_no_rules" : "unsat_union_train_breadth",
    candidateCount: rankedRules.length,
    selectedRuleCount: selectedRules.length,
    selectedRules,
    unionTrainSummary: trainUnion.summary,
    unionOosSummary: oosUnion.summary,
    selectedRuleIds: uniqueStrings(selectedRules.map((rule) => rule?.ruleId)),
  }
}
