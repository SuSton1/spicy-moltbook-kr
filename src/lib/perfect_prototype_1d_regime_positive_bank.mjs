const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const buildMonthKey = (dateKey) => {
  const text = String(dateKey ?? "").trim()
  return text.length >= 7 ? text.slice(0, 7) : null
}

const rowTokens = (row) =>
  uniqueStrings(
    [...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => {
      const normalized = String(token ?? "").trim()
      return normalized.startsWith("tag:") || normalized.startsWith("sig.cellbin.")
    }),
  )

const tokenFamily = (token) => {
  const normalized = String(token ?? "").trim()
  if (normalized.startsWith("sig.cellbin.")) {
    return normalized.split(".").slice(0, 3).join(".")
  }
  return normalized.split(":").slice(0, 2).join(":")
}

const summarizeSelectedRows = (rows = []) => {
  const positives = rows.filter((row) => row?.outcomeHitTarget === true)
  const negatives = rows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    selectedRowCount: rows.length,
    positiveRowCount: positives.length,
    negativeRowCount: negatives.length,
    precision: rows.length > 0 ? positives.length / rows.length : 0,
    trainMatchedDateCount: new Set(positives.map((row) => row?.dateKey).filter(Boolean)).size,
    trainMatchedMonthCount: new Set(positives.map((row) => row?.monthKey ?? buildMonthKey(row?.dateKey)).filter(Boolean)).size,
    trainMatchedFoldCount: new Set(positives.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
    crossfitNegativeWindowCount: new Set(negatives.map((row) => Number(row?.windowId ?? 0)).filter((value) => value > 0)).size,
  }
}

const summarizeOosRows = (rows = []) => {
  const hits = rows.filter((row) => row?.outcomeHitTarget === true)
  return {
    selectedRowCount: rows.length,
    hitRowCount: hits.length,
    precision: rows.length > 0 ? hits.length / rows.length : 0,
    matchCount: hits.length,
    selectedDateCount: new Set(rows.map((row) => row?.dateKey).filter(Boolean)).size,
    hitDateCount: new Set(hits.map((row) => row?.dateKey).filter(Boolean)).size,
  }
}

const evaluateRule = ({
  cellDataset,
  ruleTokens = [],
  minTrainDates = 10,
  minTrainMonths = 6,
  minTrainFolds = 4,
  maxCrossfitNegativeWindows = 0,
} = {}) => {
  const matchRule = (row) => {
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(rowTokens(row))
    return ruleTokens.every((token) => tokenSet.has(token))
  }
  const matchedTrainRows = (cellDataset?.trainRows ?? []).filter(matchRule)
  const matchedOosRows = (cellDataset?.oosRows ?? []).filter(matchRule)
  const trainSummary = summarizeSelectedRows(matchedTrainRows)
  const oosSummary = summarizeOosRows(matchedOosRows)
  let reason = null
  if (trainSummary.selectedRowCount < 1) reason = "unsat_positive_bank_no_selection"
  else if (trainSummary.precision < 1) reason = "unsat_positive_bank_train_precision"
  else if (
    trainSummary.trainMatchedDateCount < Number(minTrainDates) ||
    trainSummary.trainMatchedMonthCount < Number(minTrainMonths) ||
    trainSummary.trainMatchedFoldCount < Number(minTrainFolds)
  ) {
    reason = "unsat_positive_bank_train_breadth"
  } else if (trainSummary.crossfitNegativeWindowCount > Number(maxCrossfitNegativeWindows)) {
    reason = "unsat_positive_bank_crossfit_negative"
  }
  return {
    ok: reason === null,
    reason,
    ruleTokens,
    trainSummary,
    oosSummary,
    matchedTrainRows,
    matchedOosRows,
  }
}

const buildDateSupport = (rows = []) => {
  const out = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    for (const token of rowTokens(row)) {
      const bucket = out.get(token) ?? new Set()
      bucket.add(dateKey)
      out.set(token, bucket)
    }
  }
  return out
}

const compareCandidates = (left, right) => {
  const leftQualified = left?.ok === true ? 1 : 0
  const rightQualified = right?.ok === true ? 1 : 0
  if (rightQualified !== leftQualified) return rightQualified - leftQualified
  if (Number(right?.trainSummary?.precision ?? 0) !== Number(left?.trainSummary?.precision ?? 0)) {
    return Number(right?.trainSummary?.precision ?? 0) - Number(left?.trainSummary?.precision ?? 0)
  }
  if (Number(right?.trainSummary?.trainMatchedDateCount ?? 0) !== Number(left?.trainSummary?.trainMatchedDateCount ?? 0)) {
    return Number(right?.trainSummary?.trainMatchedDateCount ?? 0) - Number(left?.trainSummary?.trainMatchedDateCount ?? 0)
  }
  if (Number(right?.oosSummary?.matchCount ?? 0) !== Number(left?.oosSummary?.matchCount ?? 0)) {
    return Number(right?.oosSummary?.matchCount ?? 0) - Number(left?.oosSummary?.matchCount ?? 0)
  }
  return Number(left?.ruleTokens?.length ?? 0) - Number(right?.ruleTokens?.length ?? 0)
}

const evaluateUnionSummary = ({ rows = [], rules = [] } = {}) => {
  const selected = []
  const seen = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowKey = String(row?.rowKey ?? row?.sourceId ?? `${row?.symbol ?? "?"}:${row?.dateKey ?? "?"}`).trim()
    if (!rowKey || seen.has(rowKey)) continue
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(rowTokens(row))
    const matched = (Array.isArray(rules) ? rules : []).some((rule) =>
      Array.isArray(rule?.ruleTokens) && rule.ruleTokens.every((token) => tokenSet.has(token)),
    )
    if (!matched) continue
    seen.add(rowKey)
    selected.push(row)
  }
  return {
    trainSummary: summarizeSelectedRows(selected),
    oosSummary: summarizeOosRows(selected),
    selectedRows: selected,
  }
}

export const buildPerfectPrototype1dRegimePositiveBank = ({
  cellDataset,
  minTrainDates = 10,
  minTrainMonths = 6,
  minTrainFolds = 4,
  maxCrossfitNegativeWindows = 0,
  maxSeedTokens = 18,
  maxRuleTokens = 4,
  maxQualifiedRules = 8,
} = {}) => {
  const positiveRows = cellDataset?.trainPositiveRows ?? []
  const negativeRows = cellDataset?.trainNegativeRows ?? []
  const positiveSupport = buildDateSupport(positiveRows)
  const negativeSupport = buildDateSupport(negativeRows)
  const positiveDateCount = new Set(positiveRows.map((row) => row?.dateKey).filter(Boolean)).size
  const negativeDateCount = new Set(negativeRows.map((row) => row?.dateKey).filter(Boolean)).size
  const candidateTokens = uniqueStrings([...positiveSupport.keys()])
    .map((token) => ({
      token,
      positiveDateSupport: positiveSupport.get(token)?.size ?? 0,
      negativeDateSupport: negativeSupport.get(token)?.size ?? 0,
      lift:
        (positiveSupport.get(token)?.size ?? 0) / Math.max(1, positiveDateCount) -
        (negativeSupport.get(token)?.size ?? 0) / Math.max(1, negativeDateCount),
    }))
    .filter((entry) => entry.positiveDateSupport >= 3)
    .sort(
      (left, right) =>
        right.lift - left.lift ||
        right.positiveDateSupport - left.positiveDateSupport ||
        left.token.localeCompare(right.token),
    )
    .slice(0, Math.max(4, Math.floor(Number(maxSeedTokens) || 18)))

  const candidates = []
  const seenRuleKeys = new Set()
  const pushCandidate = (ruleTokens) => {
    const normalizedTokens = uniqueStrings(ruleTokens)
    const ruleKey = normalizedTokens.join("||")
    if (!ruleKey || seenRuleKeys.has(ruleKey)) return null
    seenRuleKeys.add(ruleKey)
    const candidate = evaluateRule({
      cellDataset,
      ruleTokens: normalizedTokens,
      minTrainDates,
      minTrainMonths,
      minTrainFolds,
      maxCrossfitNegativeWindows,
    })
    candidates.push(candidate)
    return candidate
  }

  const walk = (ruleTokens, startIndex, usedFamilies) => {
    const candidate = pushCandidate(ruleTokens)
    if (!candidate) return
    if (candidate.ok === true || ruleTokens.length >= Math.max(1, Math.floor(Number(maxRuleTokens) || 4))) return
    for (let index = startIndex; index < candidateTokens.length; index += 1) {
      const token = candidateTokens[index]?.token
      const familyKey = tokenFamily(token)
      if (!token || ruleTokens.includes(token)) continue
      if (usedFamilies.filter((entry) => entry === familyKey).length >= 2) continue
      walk([...ruleTokens, token], index + 1, [...usedFamilies, familyKey])
    }
  }

  for (let index = 0; index < candidateTokens.length; index += 1) {
    const token = candidateTokens[index]?.token
    if (!token) continue
    walk([token], index + 1, [tokenFamily(token)])
  }

  candidates.sort(compareCandidates)
  const qualifiedRules = candidates.filter((candidate) => candidate?.ok === true).slice(0, Math.max(1, Math.floor(Number(maxQualifiedRules) || 8)))
  const unionTrain = evaluateUnionSummary({
    rows: cellDataset?.trainRows ?? [],
    rules: qualifiedRules,
  })
  const unionOos = evaluateUnionSummary({
    rows: cellDataset?.oosRows ?? [],
    rules: qualifiedRules,
  })
  const bestCandidate = candidates[0] ?? null

  return {
    ok: qualifiedRules.length > 0,
    reason: qualifiedRules.length > 0 ? null : bestCandidate?.reason ?? "unsat_no_positive_bank_candidates",
    candidateCount: candidates.length,
    qualifiedRuleCount: qualifiedRules.length,
    qualifiedRules,
    bestCandidate,
    unionTrainSummary: unionTrain.trainSummary,
    unionOosSummary: unionOos.oosSummary,
    unionTrainRows: unionTrain.selectedRows,
    unionOosRows: unionOos.selectedRows,
  }
}
