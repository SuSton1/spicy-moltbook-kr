import { buildPerfectPrototypeDailySequenceShapeletHypothesisCatalog } from "./perfect_prototype_feature_bank_contract.mjs"

const uniqueStrings = (values = []) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  )

const rowTokens = (row) =>
  uniqueStrings([...(row?.categoricalTokens ?? []), ...Array.from(row?.tokenSet ?? [])].filter((token) => String(token).startsWith("sig.")))

const rowScore = (row, tokenLiftMap = new Map()) =>
  rowTokens(row).reduce((sum, token) => sum + Number(tokenLiftMap.get(token) ?? 0), 0)

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
  for (const row of rows) {
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

const belongsToPrototypeCard = (row, prototypeCard) => {
  const cardTokens = Array.isArray(prototypeCard?.seedTokens) ? prototypeCard.seedTokens : []
  if (cardTokens.length < 1) return false
  const tokenSet = new Set(rowTokens(row))
  return cardTokens.every((token) => tokenSet.has(token))
}

const pickTop1ByDate = (rows = [], tokenLiftMap = new Map()) =>
  Array.from(groupRowsByDate(rows).values()).map((bucket) =>
    bucket
      .slice()
      .sort(
        (left, right) =>
          rowScore(right, tokenLiftMap) - rowScore(left, tokenLiftMap) ||
          rowTokens(right).length - rowTokens(left).length ||
          String(left?.rowKey ?? "").localeCompare(String(right?.rowKey ?? "")),
      )[0],
  )

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
  if (Number(trainSummary?.selectedRowCount ?? 0) < 1) return "unsat_shapelet_exact_bank_no_selections"
  if (Number(trainSummary?.precision ?? 0) < 1) return "unsat_shapelet_exact_bank_train_precision"
  if (Number(trainSummary?.trainMatchedDateCount ?? 0) < Number(minTrainMatchedDates ?? 10)) return "unsat_top1_query_train_breadth"
  if (Number(trainSummary?.trainMatchedMonthCount ?? 0) < Number(minTrainMatchedMonths ?? 6)) return "unsat_top1_query_train_breadth"
  if (Number(trainSummary?.trainMatchedFoldCount ?? 0) < Number(minTrainMatchedFolds ?? 4)) return "unsat_top1_query_train_breadth"
  if (Number(trainSummary?.crossfitNegativeWindowCount ?? 0) > Number(maxCrossfitNegativeWindows ?? 0)) {
    return "unsat_shapelet_exact_bank_crossfit_negative"
  }
  if (supportLeaveOneOutRecovered !== true) return "unsat_shapelet_exact_bank_support_recovery"
  if (Number(oosSummary?.openOosPrecision ?? 0) < 1) return "unsat_shapelet_exact_bank_oos_precision"
  if (Number(oosSummary?.openOosMatchCount ?? 0) < Number(minOosMatchCount ?? 3)) return "unsat_shapelet_exact_bank_oos_breadth"
  return null
}

const evaluateRule = ({
  family,
  prototypeCard,
  ruleTokens = [],
  tokenLiftMap = new Map(),
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  minOosMatchCount,
} = {}) => {
  const trainCandidates = (family?.gatedTrainRows ?? []).filter((row) => belongsToPrototypeCard(row, prototypeCard))
  const matchedTrainRows = pickTop1ByDate(
    trainCandidates.filter((row) => ruleTokens.every((token) => rowTokens(row).includes(token))),
    tokenLiftMap,
  )
  const trainSummary = summarizeSelectedRows(matchedTrainRows)
  const supportMatchedRows = pickTop1ByDate(
    (family?.supportCaseViews ?? []).filter((row) => belongsToPrototypeCard(row, prototypeCard) && ruleTokens.every((token) => rowTokens(row).includes(token))),
    tokenLiftMap,
  )
  const oosMatchedRows = pickTop1ByDate(
    (family?.oosRows ?? []).filter((row) => belongsToPrototypeCard(row, prototypeCard) && ruleTokens.every((token) => rowTokens(row).includes(token))),
    tokenLiftMap,
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
    prototypeCardId: prototypeCard?.prototypeCardId ?? null,
    prototypeSignature: prototypeCard?.signature ?? null,
    trainSummary,
    oosSummary,
    supportLeaveOneOutRecovered,
    supportMatchedRows,
    matchedTrainRows,
  }
}

const tokenFamily = (token) => String(token ?? "").split(".").slice(0, 3).join(".")

const hypothesisTokenFilter = (hypothesis, prototypeCard) => {
  const prefixes = Array.isArray(hypothesis?.featurePrefixes) ? hypothesis.featurePrefixes : []
  const prototypeSeedTokens = Array.isArray(prototypeCard?.seedTokens) ? prototypeCard.seedTokens : []
  return (token) =>
    prototypeSeedTokens.includes(token) ||
    prefixes.some((prefix) => String(token ?? "").startsWith(prefix))
}

const searchTokenRules = ({
  family,
  prototypeCard,
  positiveRows = [],
  negativeRows = [],
  tokenLiftMap = new Map(),
  hypothesis,
  minTrainMatchedDates,
  minTrainMatchedMonths,
  minTrainMatchedFolds,
  maxCrossfitNegativeWindows,
  minOosMatchCount,
} = {}) => {
  const filterToken = hypothesisTokenFilter(hypothesis, prototypeCard)
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
    .filter((entry) => entry.positiveDateSupport >= 2)
    .sort(
      (left, right) =>
        right.lift - left.lift ||
        right.positiveDateSupport - left.positiveDateSupport ||
        left.token.localeCompare(right.token),
    )
    .slice(0, 14)

  const candidates = []
  const evaluateAndMaybeRecurse = (ruleTokens, startIndex, usedFamilies = new Set()) => {
    const candidate = evaluateRule({
      family,
      prototypeCard,
      ruleTokens,
      tokenLiftMap,
      minTrainMatchedDates,
      minTrainMatchedMonths,
      minTrainMatchedFolds,
      maxCrossfitNegativeWindows,
      minOosMatchCount,
    })
    candidates.push(candidate)
    if (ruleTokens.length >= 6) return
    if (candidate.trainSummary?.precision === 1 && candidate.trainSummary?.trainMatchedDateCount >= minTrainMatchedDates) return
    for (let index = startIndex; index < candidateTokens.length; index += 1) {
      const token = candidateTokens[index]?.token
      const familyKey = tokenFamily(token)
      if (!token || ruleTokens.includes(token)) continue
      if ([...usedFamilies].filter((entry) => entry === familyKey).length >= 2) continue
      const nextTokens = uniqueStrings([...ruleTokens, token])
      const nextCandidate = evaluateRule({
        family,
        prototypeCard,
        ruleTokens: nextTokens,
        tokenLiftMap,
        minTrainMatchedDates,
        minTrainMatchedMonths,
        minTrainMatchedFolds,
        maxCrossfitNegativeWindows,
        minOosMatchCount,
      })
      candidates.push(nextCandidate)
      if (
        Number(nextCandidate?.trainSummary?.selectedRowCount ?? 0) > 0 &&
        Number(nextCandidate?.trainSummary?.negativeRowCount ?? 0) < Number(candidate?.trainSummary?.negativeRowCount ?? Infinity)
      ) {
        const nextFamilies = new Set([...usedFamilies, familyKey])
        evaluateAndMaybeRecurse(nextTokens, index + 1, nextFamilies)
      }
    }
  }

  for (let index = 0; index < Math.min(6, candidateTokens.length); index += 1) {
    const token = candidateTokens[index]?.token
    if (!token) continue
    evaluateAndMaybeRecurse([token], index + 1, new Set([tokenFamily(token)]))
  }
  candidates.sort(compareCandidates)
  return candidates
}

export const buildPerfectPrototypeDailyShapeletExactBank = ({
  family,
  minTrainMatchedDates = 10,
  minTrainMatchedMonths = 6,
  minTrainMatchedFolds = 4,
  maxCrossfitNegativeWindows = 0,
  minOosMatchCount = 3,
} = {}) => {
  const hypotheses = buildPerfectPrototypeDailySequenceShapeletHypothesisCatalog()
  const tokenLiftMap = family?.sequenceWitnessTokenLiftMap instanceof Map ? family.sequenceWitnessTokenLiftMap : new Map()
  const hypothesisResults = []

  for (const hypothesis of hypotheses) {
    const perCard = []
    for (const prototypeCard of Array.isArray(family?.prototypeCards) ? family.prototypeCards : []) {
      const positiveRows = (family?.witnessRows ?? []).filter((row) => belongsToPrototypeCard(row, prototypeCard))
      const negativeRows = (family?.witnessNegativeRows ?? []).filter((row) => belongsToPrototypeCard(row, prototypeCard))
      const candidates = searchTokenRules({
        family,
        prototypeCard,
        positiveRows,
        negativeRows,
        tokenLiftMap,
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
        prototypeCardId: prototypeCard.prototypeCardId,
        prototypeSignature: prototypeCard.signature,
      }))
      perCard.push({
        hypothesisId: hypothesis.hypothesisId,
        hypothesisName: hypothesis.name,
        prototypeCardId: prototypeCard.prototypeCardId,
        prototypeSignature: prototypeCard.signature,
        candidateCount: candidates.length,
        qualifiedCandidateCount: candidates.filter((candidate) => candidate.ok === true).length,
        bestCandidate: candidates[0] ?? null,
        candidates,
      })
    }
    perCard.sort((left, right) => compareCandidates(left?.bestCandidate ?? {}, right?.bestCandidate ?? {}))
    hypothesisResults.push({
      hypothesisId: hypothesis.hypothesisId,
      hypothesisName: hypothesis.name,
      featurePrefixes: hypothesis.featurePrefixes,
      cards: perCard,
      bestCandidate: perCard[0]?.bestCandidate ?? null,
      ok: perCard.some((entry) => entry?.bestCandidate?.ok === true),
    })
  }

  hypothesisResults.sort((left, right) => compareCandidates(left?.bestCandidate ?? {}, right?.bestCandidate ?? {}))
  const qualified = hypothesisResults
    .flatMap((entry) => entry.cards.flatMap((card) => card.candidates.filter((candidate) => candidate.ok === true)))
    .sort(compareCandidates)
  const bestCandidate = qualified[0] ?? hypothesisResults[0]?.bestCandidate ?? null
  const ok = qualified.length > 0
  return {
    ...family,
    ok,
    reason: ok ? null : bestCandidate?.reason ?? "unsat_no_shapelet_exact_bank",
    shapeletExactRuleBank: qualified,
    summary: {
      ...(family?.summary ?? {}),
      shapeletHypothesisCount: hypothesisResults.length,
      shapeletHypothesisQualifiedCount: hypothesisResults.filter((entry) => entry.ok === true).length,
      shapeletRuleBankCandidateCount: hypothesisResults.reduce(
        (sum, entry) => sum + entry.cards.reduce((cardSum, card) => cardSum + Number(card?.candidateCount ?? 0), 0),
        0,
      ),
      qualifiedRuleCount: qualified.length,
      shapeletBestCandidate: bestCandidate ?? null,
      shapeletHypothesisPreview: hypothesisResults.slice(0, 3).map((entry) => ({
        hypothesisId: entry.hypothesisId,
        hypothesisName: entry.hypothesisName,
        bestCandidate: entry.bestCandidate,
      })),
    },
  }
}
