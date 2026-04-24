import { PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID } from "./perfect_prototype_support_case.mjs"

const num = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const toText = (value) => {
  const text = String(value ?? "").trim()
  return text || null
}

const uniqueSortedStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))

const average = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite)
  if (filtered.length < 1) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

const median = (values) => {
  const filtered = (Array.isArray(values) ? values : []).map((value) => num(value)).filter(Number.isFinite).sort((a, b) => a - b)
  if (filtered.length < 1) return null
  const middle = Math.floor(filtered.length / 2)
  if (filtered.length % 2 === 1) return filtered[middle]
  return (filtered[middle - 1] + filtered[middle]) / 2
}

const buildMonthKey = (dateKey) => {
  const text = toText(dateKey)
  return text && text.length >= 7 ? text.slice(0, 7) : null
}

const buildTermId = (term) =>
  [
    "SCORETERM",
    term.role,
    term.kind,
    term.featureKey ?? term.token ?? "unknown",
    term.operator ?? "present",
    term.threshold ?? "na",
  ]
    .map((part) => String(part ?? "").replace(/[^a-zA-Z0-9_.:-]+/g, "_"))
    .join("__")

export const evaluatePerfectPrototypeSupportScorecardTerm = (term, row) => {
  if (!term || !row) return false
  if (term.kind === "categorical_present") {
    return row?.tokenSet?.has(term.token) === true
  }
  const value = num(row?.numericFeatureMap?.[term.featureKey])
  const threshold = num(term.threshold)
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false
  if (term.operator === ">=") return value >= threshold
  if (term.operator === "<=") return value <= threshold
  return false
}

const evaluateTermRows = (term, rows) =>
  (Array.isArray(rows) ? rows : []).filter((row) => evaluatePerfectPrototypeSupportScorecardTerm(term, row))

const buildWindowStats = (rows, minWindowSupport) => {
  const positiveByWindow = new Map()
  const negativeWindows = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const windowId = Number(row?.windowId ?? 0)
    if (windowId < 1) continue
    if (row?.outcomeHitTarget === true) {
      positiveByWindow.set(windowId, Number(positiveByWindow.get(windowId) ?? 0) + 1)
    } else {
      negativeWindows.add(windowId)
    }
  }
  const minSupport = Math.max(1, Math.floor(Number(minWindowSupport) || 1))
  let positiveWindowCount = 0
  for (const count of positiveByWindow.values()) {
    if (count >= minSupport) positiveWindowCount += 1
  }
  return {
    crossfitPositiveWindowCount: positiveWindowCount,
    crossfitNegativeWindowCount: negativeWindows.size,
  }
}

const isCandidateCategoricalTerm = (token) => {
  const normalized = toText(token) ?? ""
  return (
    normalized.startsWith("sig:support.") ||
    normalized.startsWith("sig:supportMetric.") ||
    normalized.startsWith("tag:lowGapTop.") ||
    normalized.startsWith("tag:event.") ||
    normalized.startsWith("tag:xsec.") ||
    normalized.startsWith("tag:market.") ||
    normalized.startsWith("macro:lowGapTop:")
  )
}

const buildSupportCaseMatches = (term, supportCaseViews) =>
  (Array.isArray(supportCaseViews) ? supportCaseViews : [])
    .filter((view) => evaluatePerfectPrototypeSupportScorecardTerm(term, view))
    .map((view) => view.caseId)
    .filter(Boolean)

const classifyRole = ({
  supportCaseIds = [],
  positiveDateCount = 0,
  positiveCount = 0,
  negativeCount = 0,
  hardNegativeCount = 0,
}) => {
  if (supportCaseIds.length > 0) return "support_anchor"
  if (hardNegativeCount >= Math.max(2, positiveCount) && negativeCount > positiveCount) return "risk_killer"
  if (positiveDateCount > 0) return "breadth_extender"
  return "other"
}

const resolveRoleWeight = (role, hardNegativeCount, positiveDateCount) => {
  if (role === "support_anchor") return 3
  if (role === "risk_killer") return hardNegativeCount >= 4 ? -2 : -1
  if (role === "breadth_extender") return positiveDateCount >= 6 ? 2 : 1
  return 1
}

const buildTermScore = (entry) =>
  entry.supportCaseIds.length * 240 +
  entry.positiveDateCount * 18 +
  entry.positiveMonthCount * 12 +
  entry.positiveCount * 2 +
  entry.hardNegativeCount * (entry.role === "risk_killer" ? 10 : -1) -
  entry.negativeCount * 14 -
  entry.crossfitNegativeWindowCount * 35

const compareTerms = (left, right) => {
  if (right.termScore !== left.termScore) return right.termScore - left.termScore
  if (right.positiveDateCount !== left.positiveDateCount) return right.positiveDateCount - left.positiveDateCount
  if (left.negativeCount !== right.negativeCount) return left.negativeCount - right.negativeCount
  return String(left.termId).localeCompare(String(right.termId))
}

const qualifyTerm = (term) => {
  if (term.role === "support_anchor") {
    return term.supportCaseIds.length > 0 && term.positiveCount > 0
  }
  if (term.role === "breadth_extender") {
    return term.positiveDateCount >= 2 && term.positiveCount >= 2
  }
  if (term.role === "risk_killer") {
    return term.hardNegativeCount >= 2
  }
  return false
}

export const buildPerfectPrototypeSupportScorecardTermBank = ({
  cohort,
  maxSupportAnchorTerms = 8,
  maxBreadthExtenderTerms = 12,
  maxRiskKillerTerms = 8,
  minWindowSupport = 2,
} = {}) => {
  const supportCaseViews = Array.isArray(cohort?.supportCaseViews) ? cohort.supportCaseViews : []
  const trainRows = Array.isArray(cohort?.gatedTrainRows)
    ? cohort.gatedTrainRows
    : Array.isArray(cohort?.trainRows)
      ? cohort.trainRows
      : []
  const supportPositiveRows = Array.isArray(cohort?.supportPositiveRows) ? cohort.supportPositiveRows : []
  const hardNegativeRows = Array.isArray(cohort?.hardNegativeRows) ? cohort.hardNegativeRows : []

  const candidateTerms = []
  const seen = new Set()

  const pushTerm = (term) => {
    if (!term) return
    const termId = buildTermId(term)
    if (seen.has(termId)) return
    seen.add(termId)
    const matchedRows = evaluateTermRows(term, trainRows)
    const positiveRows = matchedRows.filter((row) => row.outcomeHitTarget === true)
    const negativeRows = matchedRows.filter((row) => row.outcomeHitTarget !== true)
    const supportMatchedRows = evaluateTermRows(term, supportPositiveRows)
    const hardNegativeMatchedRows = evaluateTermRows(term, hardNegativeRows)
    const supportCaseIds = buildSupportCaseMatches(term, supportCaseViews)
    const role = classifyRole({
      supportCaseIds,
      positiveDateCount: new Set(positiveRows.map((row) => row.dateKey).filter(Boolean)).size,
      positiveCount: positiveRows.length,
      negativeCount: negativeRows.length,
      hardNegativeCount: hardNegativeMatchedRows.length,
    })
    const entry = {
      ...term,
      termId,
      matchedRows,
      positiveCount: positiveRows.length,
      negativeCount: negativeRows.length,
      positiveDateCount: new Set(positiveRows.map((row) => row.dateKey).filter(Boolean)).size,
      positiveMonthCount: new Set(
        positiveRows.map((row) => row.monthKey ?? buildMonthKey(row.dateKey)).filter(Boolean),
      ).size,
      positiveFoldCount: new Set(
        positiveRows.map((row) => Number(row.foldId ?? 0)).filter((value) => value > 0),
      ).size,
      supportPositiveCount: supportMatchedRows.length,
      hardNegativeCount: hardNegativeMatchedRows.length,
      supportCaseIds,
      role,
      weight:
        Number.isFinite(num(term.weight)) ? Number(term.weight) : resolveRoleWeight(role, hardNegativeMatchedRows.length, new Set(positiveRows.map((row) => row.dateKey).filter(Boolean)).size),
      ...buildWindowStats(matchedRows, minWindowSupport),
    }
    entry.termScore = buildTermScore(entry)
    entry.qualified = qualifyTerm(entry)
    candidateTerms.push(entry)
  }

  const categoricalPool = uniqueSortedStrings([
    ...supportCaseViews.flatMap((view) => view.categoricalTokens.filter(isCandidateCategoricalTerm)),
    ...supportPositiveRows.flatMap((row) => row.categoricalTokens.filter(isCandidateCategoricalTerm)),
  ])
  for (const token of categoricalPool) {
    pushTerm({
      kind: "categorical_present",
      token,
      sign: "mixed",
      operator: "present",
    })
  }

  const numericFeatureKeys = uniqueSortedStrings(
    [
      ...supportCaseViews.flatMap((view) =>
        Object.keys(view.numericFeatureMap ?? {}).filter((key) =>
          key.startsWith("sig.support.") || key.startsWith("sig.supportMetric."),
        ),
      ),
      ...supportPositiveRows.flatMap((row) =>
        Object.keys(row.numericFeatureMap ?? {}).filter((key) =>
          key.startsWith("sig.support.") || key.startsWith("sig.supportMetric."),
        ),
      ),
    ].flat(),
  )
  for (const featureKey of numericFeatureKeys) {
    const supportValues = supportPositiveRows.map((row) => row.numericFeatureMap?.[featureKey])
    const hardNegativeValues = hardNegativeRows.map((row) => row.numericFeatureMap?.[featureKey])
    const supportMean = average(supportValues)
    const hardNegativeMean = average(hardNegativeValues)
    const supportMedian = median(supportValues)
    const hardNegativeMedian = median(hardNegativeValues)
    if (!Number.isFinite(num(supportMean)) || !Number.isFinite(num(hardNegativeMean))) continue
    const direction = supportMean >= hardNegativeMean ? ">=" : "<="
    const supportReference = Number.isFinite(num(supportMedian)) ? supportMedian : supportMean
    const hardReference = Number.isFinite(num(hardNegativeMedian)) ? hardNegativeMedian : hardNegativeMean
    const threshold = (supportReference + hardReference) / 2
    pushTerm({
      kind: "numeric_threshold",
      featureKey,
      operator: direction,
      threshold,
      sign: direction === ">=" ? "positive_high" : "positive_low",
    })
  }

  const qualifiedTerms = candidateTerms.filter((entry) => entry.qualified === true).sort(compareTerms)
  const byRole = {
    support_anchor: qualifiedTerms.filter((entry) => entry.role === "support_anchor").slice(0, maxSupportAnchorTerms),
    breadth_extender: qualifiedTerms.filter((entry) => entry.role === "breadth_extender").slice(0, maxBreadthExtenderTerms),
    risk_killer: qualifiedTerms.filter((entry) => entry.role === "risk_killer").slice(0, maxRiskKillerTerms),
  }

  return {
    candidateTerms: qualifiedTerms,
    roleTerms: byRole,
    summary: {
      scorecardTermCandidateCount: candidateTerms.length,
      scorecardTermQualifiedCount: qualifiedTerms.length,
      supportAnchorTermCount: byRole.support_anchor.length,
      breadthExtenderTermCount: byRole.breadth_extender.length,
      riskKillerTermCount: byRole.risk_killer.length,
      haesungSupportAnchorTermCount: byRole.support_anchor.filter((entry) =>
        entry.supportCaseIds.includes(PERFECT_PROTOTYPE_HAESUNG_SUPPORT_CASE_ID),
      ).length,
    },
  }
}
