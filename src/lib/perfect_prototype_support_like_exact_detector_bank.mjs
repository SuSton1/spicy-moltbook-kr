import { buildPerfectPrototypeSupportLikeDetectorHypothesisCatalog } from "./perfect_prototype_feature_bank_contract.mjs"

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const rowTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token ?? "").startsWith("sig.")))

const groupRowsByDate = (rows = []) => {
  const grouped = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    const bucket = grouped.get(dateKey) ?? []
    bucket.push(row)
    grouped.set(dateKey, bucket)
  }
  return grouped
}

const uniqueDateSupport = (rows = [], tokenFilter = null) => {
  const support = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String(row?.dateKey ?? "").trim()
    if (!dateKey) continue
    for (const token of rowTokens(row)) {
      if (typeof tokenFilter === "function" && tokenFilter(token) !== true) continue
      const bucket = support.get(token) ?? new Set()
      bucket.add(dateKey)
      support.set(token, bucket)
    }
  }
  return support
}

const belongsToArchetype = (row, archetype) => {
  const seedTokens = Array.isArray(archetype?.seedTokens) ? archetype.seedTokens : []
  if (seedTokens.length < 1) return false
  const tokenSet = new Set(rowTokens(row))
  return seedTokens.every((token) => tokenSet.has(token))
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
    trainMatchedMonthCount: new Set(positives.map((row) => row?.monthKey).filter(Boolean)).size,
    trainMatchedFoldCount: new Set(positives.map((row) => Number(row?.foldId ?? 0)).filter((value) => value > 0)).size,
    crossfitNegativeWindowCount: new Set(negatives.map((row) => Number(row?.windowId ?? 0)).filter((value) => value > 0)).size,
  }
}

const compareCandidates = (left, right) => {
  const leftQualified = left?.ok === true ? 1 : 0
  const rightQualified = right?.ok === true ? 1 : 0
  if (rightQualified !== leftQualified) return rightQualified - leftQualified
  const leftPrecision = Number(left?.trainSummary?.precision ?? 0)
  const rightPrecision = Number(right?.trainSummary?.precision ?? 0)
  if (rightPrecision !== leftPrecision) return rightPrecision - leftPrecision
  const leftDates = Number(left?.trainSummary?.trainMatchedDateCount ?? 0)
  const rightDates = Number(right?.trainSummary?.trainMatchedDateCount ?? 0)
  if (rightDates !== leftDates) return rightDates - leftDates
  const leftOos = Number(left?.oosSummary?.openOosMatchCount ?? 0)
  const rightOos = Number(right?.oosSummary?.openOosMatchCount ?? 0)
  if (rightOos !== leftOos) return rightOos - leftOos
  return Number(left?.ruleTokens?.length ?? 0) - Number(right?.ruleTokens?.length ?? 0)
}

const primaryReasonFor = ({
  trainSummary,
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  supportLeaveOneOutRecovered,
  oosSummary,
  minOosMatchCount,
} = {}) => {
  if (Number(trainSummary?.selectedRowCount ?? 0) < 1) return "unsat_support_like_detector_no_selections"
  if (Number(trainSummary?.precision ?? 0) < 1) return "unsat_support_like_detector_train_precision"
  if (Number(trainSummary?.trainMatchedDateCount ?? 0) < Number(minTrainMatchedDates ?? 10)) return "unsat_support_like_detector_train_breadth"
  if (Number(trainSummary?.trainMatchedMonthCount ?? 0) < Number(minTrainMatchedMonths ?? 6)) return "unsat_support_like_detector_train_breadth"
  if (Number(trainSummary?.trainMatchedFoldCount ?? 0) < Number(minTrainMatchedFolds ?? 4)) return "unsat_support_like_detector_train_breadth"
  if (Number(trainSummary?.crossfitNegativeWindowCount ?? 0) > Number(maxCrossfitNegativeWindows ?? 0)) {
    return "unsat_support_like_detector_crossfit_negative"
  }
  if (supportLeaveOneOutRecovered !== true) return "unsat_support_like_detector_support_recovery"
  if (Number(oosSummary?.openOosSelectedRowCount ?? 0) > 0 && Number(oosSummary?.openOosPrecision ?? 0) < 1) {
    return "unsat_support_like_detector_oos_precision"
  }
  if (Number(oosSummary?.openOosMatchCount ?? 0) < Number(minOosMatchCount ?? 3)) return "unsat_support_like_detector_oos_breadth"
  return null
}

const evaluateRule = ({
  family,
  archetype,
  ruleTokens = [],
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  minOosMatchCount,
} = {}) => {
  const trainCandidates = [...(family?.detectorPositiveRows ?? []), ...(family?.detectorNegativeRows ?? [])].filter((row) =>
    belongsToArchetype(row, archetype),
  )
  const matchedTrainRows = trainCandidates.filter((row) => ruleTokens.every((token) => rowTokens(row).includes(token)))
  const trainSummary = summarizeSelectedRows(matchedTrainRows)
  const supportMatchedRows = (family?.supportCaseViews ?? []).filter(
    (row) => belongsToArchetype(row, archetype) && ruleTokens.every((token) => rowTokens(row).includes(token)),
  )
  const oosMatchedRows = (family?.detectorOosRows ?? []).filter(
    (row) => belongsToArchetype(row, archetype) && ruleTokens.every((token) => rowTokens(row).includes(token)),
  )
  const oosHits = oosMatchedRows.filter((row) => row?.outcomeHitTarget === true)
  const oosSummary = {
    openOosSelectedRowCount: oosMatchedRows.length,
    openOosHitCount: oosHits.length,
    openOosMatchCount: oosHits.length,
    openOosPrecision: oosMatchedRows.length > 0 ? oosHits.length / oosMatchedRows.length : 0,
    openOosUniqueMatchedDates: new Set(oosHits.map((row) => row?.dateKey).filter(Boolean)).size,
  }
  const supportLeaveOneOutRecovered = supportMatchedRows.length > 0
  const reason = primaryReasonFor({
    trainSummary,
    minTrainMatchedDates,
    minTrainMatchedMonths,
    minTrainMatchedFolds,
    maxCrossfitNegativeWindows,
    supportLeaveOneOutRecovered,
    oosSummary,
    minOosMatchCount,
  })
  return {
    ok: reason === null,
    reason,
    ruleTokens,
    archetypeId: archetype?.archetypeId ?? null,
    archetypeSignature: archetype?.signature ?? null,
    trainSummary,
    oosSummary,
    supportLeaveOneOutRecovered,
    supportMatchedRows,
    matchedTrainRows,
  }
}

const tokenFamily = (token) => String(token ?? "").split(".").slice(0, 3).join(".")

const hypothesisTokenFilter = (hypothesis, archetype) => {
  const prefixes = Array.isArray(hypothesis?.featurePrefixes) ? hypothesis.featurePrefixes : []
  const seedTokens = Array.isArray(archetype?.seedTokens) ? archetype.seedTokens : []
  return (token) => seedTokens.includes(token) || prefixes.some((prefix) => String(token ?? "").startsWith(prefix))
}

const searchTokenRules = ({
  family,
  archetype,
  positiveRows = [],
  negativeRows = [],
  hypothesis,
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  minOosMatchCount,
} = {}) => {
  const filterToken = hypothesisTokenFilter(hypothesis, archetype)
  const positiveSupport = uniqueDateSupport(positiveRows, filterToken)
  const negativeSupport = uniqueDateSupport(negativeRows, filterToken)
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
    .slice(0, 16)

  const candidates = []
  const evaluateAndMaybeRecurse = (ruleTokens, startIndex, usedFamilies = []) => {
    const candidate = evaluateRule({
      family,
      archetype,
      ruleTokens,
      minTrainMatchedDates,
      minTrainMatchedMonths,
      minTrainMatchedFolds,
      maxCrossfitNegativeWindows,
      minOosMatchCount,
    })
    candidates.push(candidate)
    if (ruleTokens.length >= 5) return
    if (candidate.trainSummary?.precision === 1 && candidate.trainSummary?.trainMatchedDateCount >= minTrainMatchedDates) return
    for (let index = startIndex; index < candidateTokens.length; index += 1) {
      const token = candidateTokens[index]?.token
      const familyKey = tokenFamily(token)
      if (!token || ruleTokens.includes(token)) continue
      if (usedFamilies.filter((entry) => entry === familyKey).length >= 2) continue
      const nextTokens = uniqueStrings([...ruleTokens, token])
      const nextCandidate = evaluateRule({
        family,
        archetype,
        ruleTokens: nextTokens,
        minTrainMatchedDates,
        minTrainMatchedMonths,
        minTrainMatchedFolds,
        maxCrossfitNegativeWindows,
        minOosMatchCount,
      })
      candidates.push(nextCandidate)
      if (
        Number(nextCandidate?.trainSummary?.selectedRowCount ?? 0) > 0 &&
        Number(nextCandidate?.trainSummary?.negativeRowCount ?? 0) <= Number(candidate?.trainSummary?.negativeRowCount ?? Infinity)
      ) {
        evaluateAndMaybeRecurse(nextTokens, index + 1, [...usedFamilies, familyKey])
      }
    }
  }

  for (let index = 0; index < Math.min(8, candidateTokens.length); index += 1) {
    const token = candidateTokens[index]?.token
    if (!token) continue
    evaluateAndMaybeRecurse([token], index + 1, [tokenFamily(token)])
  }
  candidates.sort(compareCandidates)
  return candidates
}

export const buildPerfectPrototypeSupportLikeExactDetectorBank = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
} = {}) => {
  const hypotheses = buildPerfectPrototypeSupportLikeDetectorHypothesisCatalog()
  const hypothesisResults = []

  for (const hypothesis of hypotheses) {
    const perArchetype = []
    for (const archetype of Array.isArray(family?.supportLikeArchetypes) ? family.supportLikeArchetypes : []) {
      const positiveRows = (family?.detectorPositiveRows ?? []).filter((row) => belongsToArchetype(row, archetype))
      const negativeRows = (family?.detectorNegativeRows ?? []).filter((row) => belongsToArchetype(row, archetype))
      const candidates = searchTokenRules({
        family,
        archetype,
        positiveRows,
        negativeRows,
        hypothesis,
        minTrainMatchedDates,
        minTrainMatchedMonths,
        minTrainMatchedFolds,
        maxCrossfitNegativeWindows,
        minOosMatchCount,
      }).map((candidate) => ({
        ...candidate,
        hypothesisId: hypothesis.hypothesisId,
        hypothesisName: hypothesis.name,
      }))
      perArchetype.push({
        hypothesisId: hypothesis.hypothesisId,
        hypothesisName: hypothesis.name,
        archetypeId: archetype.archetypeId,
        archetypeSignature: archetype.signature,
        candidateCount: candidates.length,
        qualifiedCandidateCount: candidates.filter((candidate) => candidate.ok === true).length,
        bestCandidate: candidates[0] ?? null,
        candidates,
      })
    }
    perArchetype.sort((left, right) => compareCandidates(left?.bestCandidate ?? {}, right?.bestCandidate ?? {}))
    hypothesisResults.push({
      hypothesisId: hypothesis.hypothesisId,
      hypothesisName: hypothesis.name,
      archetypeCount: perArchetype.length,
      qualifiedArchetypeCount: perArchetype.filter((entry) => Number(entry?.qualifiedCandidateCount ?? 0) > 0).length,
      bestCandidate: perArchetype[0]?.bestCandidate ?? null,
      archetypes: perArchetype,
    })
  }

  const allCandidates = hypothesisResults.flatMap((entry) => entry.archetypes.flatMap((card) => card.candidates))
  allCandidates.sort(compareCandidates)
  const qualified = allCandidates.filter((candidate) => candidate.ok === true)
  const bestCandidate = allCandidates[0] ?? null
  const ok = qualified.length > 0
  const reason = ok ? null : bestCandidate?.reason ?? "unsat_no_support_like_detector_rule"

  return {
    ...family,
    ok,
    reason,
    supportLikeDetectorRuleBank: qualified,
    summary: {
      ...(family?.summary ?? {}),
      supportLikeHypothesisCount: hypotheses.length,
      supportLikeHypothesisQualifiedCount: hypothesisResults.filter((entry) => entry.bestCandidate?.ok === true).length,
      supportLikeDetectorCandidateCount: allCandidates.length,
      qualifiedRuleCount: qualified.length,
      supportLikeBestCandidate: bestCandidate,
      supportLikeHypothesisPreview: hypothesisResults.slice(0, 3).map((entry) => ({
        hypothesisId: entry.hypothesisId,
        hypothesisName: entry.hypothesisName,
        qualifiedArchetypeCount: entry.qualifiedArchetypeCount,
        bestCandidate: entry.bestCandidate,
      })),
    },
  }
}
