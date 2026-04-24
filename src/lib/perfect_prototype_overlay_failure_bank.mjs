const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const rowTokens = (row) =>
  uniqueStrings(
    [...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => {
      const normalized = String(token ?? "").trim()
      return normalized.startsWith("tag:") || normalized.startsWith("sig.")
    }),
  )

const tokenFamily = (token) => {
  const normalized = String(token ?? "").trim()
  if (normalized.startsWith("sig.")) {
    return normalized.split(".").slice(0, 3).join(".")
  }
  return normalized.split(":").slice(0, 2).join(":")
}

const summarizeRows = (rows = []) => ({
  rowCount: Array.isArray(rows) ? rows.length : 0,
  matchedDateCount: new Set((rows ?? []).map((row) => row?.dateKey).filter(Boolean)).size,
  matchedMonthCount: new Set((rows ?? []).map((row) => row?.monthKey).filter(Boolean)).size,
  matchedFoldCount: new Set((rows ?? []).map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
})

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

const evaluateRule = ({ dataset, ruleTokens = [], minNegativeMatchedDates = 2 } = {}) => {
  const matches = (row) => {
    const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(rowTokens(row))
    return ruleTokens.every((token) => tokenSet.has(token))
  }
  const matchedTrainRows = (dataset?.trainRows ?? []).filter(matches)
  const matchedPositiveRows = matchedTrainRows.filter((row) => row?.outcomeHitTarget === true)
  const matchedNegativeRows = matchedTrainRows.filter((row) => row?.outcomeHitTarget !== true)
  return {
    ruleTokens,
    matchedTrainRows,
    matchedPositiveRows,
    matchedNegativeRows,
    positiveSummary: summarizeRows(matchedPositiveRows),
    negativeSummary: summarizeRows(matchedNegativeRows),
    ok:
      matchedPositiveRows.length === 0 &&
      new Set(matchedNegativeRows.map((row) => row?.dateKey).filter(Boolean)).size >= Number(minNegativeMatchedDates),
  }
}

const compareCandidates = (left, right) => {
  const leftQualified = left?.ok === true ? 1 : 0
  const rightQualified = right?.ok === true ? 1 : 0
  if (rightQualified !== leftQualified) return rightQualified - leftQualified
  if (Number(right?.negativeSummary?.matchedDateCount ?? 0) !== Number(left?.negativeSummary?.matchedDateCount ?? 0)) {
    return Number(right?.negativeSummary?.matchedDateCount ?? 0) - Number(left?.negativeSummary?.matchedDateCount ?? 0)
  }
  if (Number(right?.negativeSummary?.rowCount ?? 0) !== Number(left?.negativeSummary?.rowCount ?? 0)) {
    return Number(right?.negativeSummary?.rowCount ?? 0) - Number(left?.negativeSummary?.rowCount ?? 0)
  }
  return Number(left?.ruleTokens?.length ?? 0) - Number(right?.ruleTokens?.length ?? 0)
}

export const matchesPerfectPrototypeOverlayFailureRule = (row, rule) => {
  const tokenSet = row?.tokenSet instanceof Set ? row.tokenSet : new Set(row?.categoricalTokens ?? [])
  return Array.isArray(rule?.ruleTokens) && rule.ruleTokens.every((token) => tokenSet.has(token))
}

export const buildPerfectPrototypeOverlayFailureBank = ({
  dataset,
  maxSeedTokens = 18,
  maxRuleTokens = 3,
  maxQualifiedRules = 8,
  minNegativeMatchedDates = 2,
} = {}) => {
  const negativeRows = dataset?.trainNegativeRows ?? []
  const positiveRows = dataset?.trainPositiveRows ?? []
  const negativeSupport = buildDateSupport(negativeRows)
  const positiveSupport = buildDateSupport(positiveRows)
  const negativeDateCount = new Set(negativeRows.map((row) => row?.dateKey).filter(Boolean)).size
  const positiveDateCount = new Set(positiveRows.map((row) => row?.dateKey).filter(Boolean)).size
  const candidateTokens = uniqueStrings([...negativeSupport.keys()])
    .map((token) => ({
      token,
      negativeDateSupport: negativeSupport.get(token)?.size ?? 0,
      positiveDateSupport: positiveSupport.get(token)?.size ?? 0,
      lift:
        (negativeSupport.get(token)?.size ?? 0) / Math.max(1, negativeDateCount) -
        (positiveSupport.get(token)?.size ?? 0) / Math.max(1, positiveDateCount),
    }))
    .filter((entry) => entry.negativeDateSupport >= 2)
    .sort(
      (left, right) =>
        right.lift - left.lift ||
        right.negativeDateSupport - left.negativeDateSupport ||
        left.token.localeCompare(right.token),
    )
    .slice(0, Math.max(4, Math.floor(Number(maxSeedTokens) || 18)))

  const candidates = []
  const seen = new Set()
  const walk = (ruleTokens, startIndex, usedFamilies) => {
    const normalizedTokens = uniqueStrings(ruleTokens)
    const key = normalizedTokens.join("||")
    if (!key || seen.has(key)) return
    seen.add(key)
    const candidate = evaluateRule({
      dataset,
      ruleTokens: normalizedTokens,
      minNegativeMatchedDates,
    })
    candidates.push(candidate)
    if (normalizedTokens.length >= Math.max(1, Math.floor(Number(maxRuleTokens) || 3))) return
    for (let index = startIndex; index < candidateTokens.length; index += 1) {
      const token = candidateTokens[index]?.token
      const familyKey = tokenFamily(token)
      if (!token || normalizedTokens.includes(token)) continue
      if (usedFamilies.filter((entry) => entry === familyKey).length >= 2) continue
      walk([...normalizedTokens, token], index + 1, [...usedFamilies, familyKey])
    }
  }

  for (let index = 0; index < candidateTokens.length; index += 1) {
    const token = candidateTokens[index]?.token
    if (!token) continue
    walk([token], index + 1, [tokenFamily(token)])
  }

  candidates.sort(compareCandidates)
  const qualifiedRules = candidates.filter((candidate) => candidate?.ok === true).slice(0, Math.max(1, Math.floor(Number(maxQualifiedRules) || 8)))
  return {
    ok: qualifiedRules.length > 0,
    reason: qualifiedRules.length > 0 ? null : "unsat_no_failure_bank_rules",
    candidateCount: candidates.length,
    qualifiedRuleCount: qualifiedRules.length,
    qualifiedRules,
    bestCandidate: candidates[0] ?? null,
  }
}
